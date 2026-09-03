import '../apps/api/src/config/load-environment.js';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../apps/api/src/app.module.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { SiigoService } from '../apps/api/src/integrations/siigo/siigo.service.js';

const provider = `SIIGO_TOKEN_SMOKE_${randomUUID()}`;
let authenticationRequests = 0;
const productTokens: string[] = [];
const authenticationCount = () => authenticationRequests;

async function handleUpstream(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  let status = 200;
  let payload: unknown;

  if (url.pathname === '/siigo/auth' && request.method === 'POST') {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
    const body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<string, unknown>;
    if (
      body.username !== 'token-smoke-user' ||
      body.access_key !== 'token-smoke-key' ||
      request.headers['partner-id'] !== 'SevaleTokenSmoke'
    ) {
      status = 401;
      payload = { message: 'invalid private credentials' };
    } else {
      authenticationRequests += 1;
      await new Promise((resolve) => setTimeout(resolve, 60));
      payload = {
        access_token: `renewed-token-${authenticationRequests}`,
        expires_in: 3600,
        token_type: 'Bearer',
      };
    }
  } else if (url.pathname === '/siigo/v1/products' && request.method === 'GET') {
    const token = request.headers.authorization?.replace(/^Bearer\s+/i, '') ?? '';
    productTokens.push(token);
    if (url.searchParams.get('code') === 'RETRY-401' && token === 'rejected-token') {
      status = 401;
      payload = { message: 'expired private token' };
    } else {
      const sku = url.searchParams.get('code') ?? '';
      payload = {
        results: [
          {
            id: `siigo-${sku}`,
            code: sku,
            name: `Producto ${sku}`,
            available_quantity: 5,
            prices: [],
          },
        ],
      };
    }
  } else {
    status = 404;
    payload = { message: 'not found' };
  }

  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

const upstream = createServer((request, response) => {
  void handleUpstream(request, response).catch(() => {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'mock failure' }));
  });
});
await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const address = upstream.address();
if (!address || typeof address === 'string') throw new Error('No se inició el servidor simulado.');

process.env.SIIGO_API_URL = `http://127.0.0.1:${address.port}/siigo/v1`;
process.env.SIIGO_USERNAME = 'token-smoke-user';
process.env.SIIGO_ACCESS_KEY = 'token-smoke-key';
process.env.SIIGO_PARTNER_ID = 'SevaleTokenSmoke';
process.env.SIIGO_TOKEN_PROVIDER = provider;

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
  logger: false,
});
await app.init();
const prisma = app.get(PrismaService);
const siigo = app.get(SiigoService);

try {
  await prisma.integrationToken.create({
    data: {
      provider,
      accessToken: 'stored-valid-token',
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });

  const validProduct = await siigo.searchProductBySku('VALID-TOKEN');
  if (
    validProduct?.sku !== 'VALID-TOKEN' ||
    authenticationCount() !== 0 ||
    productTokens.at(-1) !== 'stored-valid-token'
  ) {
    throw new Error('Un token vigente no fue reutilizado correctamente.');
  }

  await prisma.integrationToken.update({
    where: { provider },
    data: { accessToken: 'expired-token', expiresAt: new Date(Date.now() - 1_000) },
  });
  const expiredProduct = await siigo.searchProductBySku('EXPIRED-TOKEN');
  const storedAfterExpiry = await prisma.integrationToken.findUnique({ where: { provider } });
  if (
    expiredProduct?.sku !== 'EXPIRED-TOKEN' ||
    authenticationCount() !== 1 ||
    productTokens.at(-1) !== 'renewed-token-1' ||
    storedAfterExpiry?.accessToken !== 'renewed-token-1' ||
    !storedAfterExpiry.expiresAt ||
    storedAfterExpiry.expiresAt <= new Date()
  ) {
    throw new Error('El token vencido no fue renovado y persistido correctamente.');
  }

  await prisma.integrationToken.update({
    where: { provider },
    data: { accessToken: 'rejected-token', expiresAt: new Date(Date.now() + 3_600_000) },
  });
  const beforeRetry = productTokens.length;
  const retriedProduct = await siigo.searchProductBySku('RETRY-401');
  const retryTokens = productTokens.slice(beforeRetry);
  if (
    retriedProduct?.sku !== 'RETRY-401' ||
    authenticationCount() !== 2 ||
    retryTokens[0] !== 'rejected-token' ||
    retryTokens[1] !== 'renewed-token-2'
  ) {
    throw new Error('La consulta rechazada no se repitió una sola vez con un token nuevo.');
  }

  await prisma.integrationToken.update({
    where: { provider },
    data: { accessToken: 'concurrent-expired', expiresAt: new Date(Date.now() - 1_000) },
  });
  const concurrentProducts = await Promise.all(
    Array.from({ length: 6 }, (_, index) => siigo.searchProductBySku(`CONCURRENT-${index}`)),
  );
  if (
    authenticationCount() !== 3 ||
    concurrentProducts.some((product, index) => product?.sku !== `CONCURRENT-${index}`) ||
    productTokens.slice(-6).some((token) => token !== 'renewed-token-3')
  ) {
    throw new Error('Las consultas simultáneas generaron más de una renovación de token.');
  }

  process.stdout.write(
    'Siigo token smoke: valid token, expired token, persistence, unauthorized retry and concurrent refresh checks passed.\n',
  );
} finally {
  await prisma.integrationToken.deleteMany({ where: { provider } });
  await app.close();
  await new Promise<void>((resolve, reject) =>
    upstream.close((error) => (error ? reject(error) : resolve())),
  );
}
