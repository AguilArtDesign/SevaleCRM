import '../apps/api/src/config/load-environment.js';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword } from 'better-auth/crypto';
import { AppModule } from '../apps/api/src/app.module.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { Role } from '../apps/api/src/generated/prisma/client.js';

process.env.BETTER_AUTH_SECRET ||= 'local-integrations-smoke-secret-at-least-32-characters';
const tokenProvider = `SIIGO_SMOKE_${randomUUID()}`;

const requests: Array<{
  method: string | undefined;
  path: string;
  authorization: string | undefined;
  partnerId: string | undefined;
}> = [];

function respond(request: IncomingMessage, status: number, payload: unknown) {
  request.resume();
  return { status, body: JSON.stringify(payload) };
}

const upstream = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  requests.push({
    method: request.method,
    path: url.pathname + url.search,
    authorization: request.headers.authorization,
    partnerId: request.headers['partner-id'] as string | undefined,
  });

  let result: { status: number; body: string };
  if (url.searchParams.get('sku') === 'AUTH-FAIL') {
    result = respond(request, 401, { message: 'private upstream detail' });
  } else if (url.pathname === '/siigo/v1/products') {
    const sku = url.searchParams.get('code');
    result = respond(request, 200, {
      results:
        sku === 'READ-001'
          ? [
              {
                id: 'siigo-product-1',
                code: 'READ-001',
                name: 'Producto de lectura',
                available_quantity: 14,
                prices: [
                  {
                    currency_code: 'COP',
                    price_list: [{ name: 'PESOS', value: 85000 }],
                  },
                  {
                    currency_code: 'USD',
                    price_list: [{ name: 'DOLAR', value: 22.5 }],
                  },
                ],
              },
            ]
          : [],
    });
  } else if (url.pathname === '/seratus/wc/v3/products') {
    result = respond(request, 200, [
      {
        id: 9102,
        parent_id: 9100,
        sku: url.searchParams.get('sku'),
        name: 'Variación Seratus',
        price: '85000',
        stock_quantity: 14,
        image: { src: 'https://example.invalid/product.jpg' },
        meta_data: [{ key: '_regular_price_wmcp', value: '{"USD":"22.5"}' }],
      },
    ]);
  } else if (url.pathname === '/pali/wc/v3/products') {
    result = respond(request, 200, [
      {
        id: 9202,
        parent_id: 9200,
        sku: url.searchParams.get('sku'),
        name: 'Variación Pali',
        regular_price: '92000',
        stock_quantity: null,
        images: [{ src: 'https://example.invalid/pali.jpg' }],
        meta_data: [{ key: '_regular_price_wmcp', value: '{invalid-json' }],
      },
    ]);
  } else {
    result = respond(request, 404, { message: 'not found' });
  }
  response.writeHead(result.status, { 'content-type': 'application/json' });
  response.end(result.body);
});
await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const address = upstream.address();
if (!address || typeof address === 'string') throw new Error('No se inició el servidor simulado.');
const upstreamUrl = `http://127.0.0.1:${address.port}`;

process.env.SIIGO_API_URL = `${upstreamUrl}/siigo/v1`;
process.env.SIIGO_USERNAME = 'siigo-smoke-user';
process.env.SIIGO_ACCESS_KEY = 'siigo-smoke-access-key';
process.env.SIIGO_PARTNER_ID = 'SevaleSmoke';
process.env.SIIGO_TOKEN_PROVIDER = tokenProvider;
process.env.SERATUS_API_URL = `${upstreamUrl}/seratus/wc/v3`;
process.env.WOOCOMMERCE_SERATUS_CK = 'seratus-key';
process.env.WOOCOMMERCE_SERATUS_CS = 'seratus-secret';
process.env.PALI_API_URL = `${upstreamUrl}/pali/wc/v3`;
process.env.WOOCOMMERCE_PALI_CK = 'pali-key';
process.env.WOOCOMMERCE_PALI_CS = 'pali-secret';

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
  logger: false,
});
app.setGlobalPrefix('api');
await app.listen(0, '127.0.0.1');

const prisma = app.get(PrismaService);
const baseUrl = await app.getUrl();
const userId = randomUUID();
const email = `integrations-${userId}@example.invalid`;
const password = `S-${randomUUID()}-9a!`;

function expectStatus(response: Response, status: number, context: string) {
  if (response.status !== status) {
    throw new Error(`${context}: se esperaba ${status} y se recibió ${response.status}.`);
  }
}

async function api(path: string, cookie?: string) {
  return fetch(`${baseUrl}${path}`, { headers: cookie ? { cookie } : undefined });
}

try {
  await prisma.integrationToken.create({
    data: {
      provider: tokenProvider,
      accessToken: 'siigo-smoke-token',
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  await prisma.user.create({
    data: {
      id: userId,
      name: 'Integrations Smoke User',
      email,
      emailVerified: true,
      role: Role.COMMERCIAL,
      active: true,
      accounts: {
        create: {
          id: randomUUID(),
          accountId: userId,
          providerId: 'credential',
          issuer: 'local:credential',
          password: await hashPassword(password),
        },
      },
    },
  });

  expectStatus(await api('/api/integrations/siigo/products?sku=READ-001'), 401, 'Consulta anónima');
  const login = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      'x-captcha-response': 'XXXX.DUMMY.TOKEN.XXXX',
    },
    body: JSON.stringify({ email, password }),
  });
  expectStatus(login, 200, 'Inicio de sesión');
  const cookie = login.headers.getSetCookie()[0]?.split(';')[0];
  if (!cookie) throw new Error('Better Auth no creó la cookie de sesión.');

  const siigoResponse = await api('/api/integrations/siigo/products?sku=READ-001', cookie);
  expectStatus(siigoResponse, 200, 'Lectura de Siigo');
  const siigo = (await siigoResponse.json()) as {
    id: string;
    priceCop: number;
    priceUsd: number;
    stock: number;
  };
  if (
    siigo.id !== 'siigo-product-1' ||
    siigo.priceCop !== 85000 ||
    siigo.priceUsd !== 22.5 ||
    siigo.stock !== 14
  ) {
    throw new Error('La normalización de Siigo no devolvió los valores esperados.');
  }

  const seratusResponse = await api(
    '/api/integrations/woocommerce/seratus/products?sku=READ-001',
    cookie,
  );
  expectStatus(seratusResponse, 200, 'Lectura de Seratus');
  const seratus = (await seratusResponse.json()) as {
    store: string;
    parentId: string;
    variationId: string;
    priceUsd: number;
    dataWarnings: string[];
  };
  if (
    seratus.store !== 'SERATUS' ||
    seratus.parentId !== '9100' ||
    seratus.variationId !== '9102' ||
    seratus.priceUsd !== 22.5 ||
    seratus.dataWarnings.length !== 0
  ) {
    throw new Error('La normalización de Seratus no devolvió los valores esperados.');
  }

  const paliResponse = await api(
    '/api/integrations/woocommerce/pali/products?sku=READ-001',
    cookie,
  );
  expectStatus(paliResponse, 200, 'Lectura de Pali');
  const pali = (await paliResponse.json()) as {
    store: string;
    priceUsd: number | null;
    stock: number | null;
    dataWarnings: string[];
  };
  if (
    pali.store !== 'PALI' ||
    pali.priceUsd !== null ||
    pali.stock !== null ||
    pali.dataWarnings[0] !== 'INVALID_USD_PRICE'
  ) {
    throw new Error('El parser tolerante de Pali no manejó los datos incompletos.');
  }

  const missingResponse = await api('/api/integrations/siigo/products?sku=NOT-FOUND', cookie);
  expectStatus(missingResponse, 200, 'Producto externo inexistente');
  if ((await missingResponse.json()) !== null) {
    throw new Error('Un producto inexistente debe devolver null.');
  }

  expectStatus(
    await api('/api/integrations/siigo/products?sku=SKU%20INVALIDO', cookie),
    400,
    'SKU inválido',
  );
  const authenticationFailure = await api(
    '/api/integrations/woocommerce/seratus/products?sku=AUTH-FAIL',
    cookie,
  );
  expectStatus(authenticationFailure, 502, 'Credenciales externas rechazadas');
  const failureText = await authenticationFailure.text();
  if (failureText.includes('private upstream detail') || failureText.includes('seratus-secret')) {
    throw new Error('La respuesta expuso información sensible del proveedor.');
  }

  const originalPaliSecret = process.env.WOOCOMMERCE_PALI_CS;
  delete process.env.WOOCOMMERCE_PALI_CS;
  expectStatus(
    await api('/api/integrations/woocommerce/pali/products?sku=READ-001', cookie),
    503,
    'Integración no configurada',
  );
  process.env.WOOCOMMERCE_PALI_CS = originalPaliSecret;

  if (requests.some((request) => request.method !== 'GET')) {
    throw new Error('Se detectó una operación externa distinta de GET.');
  }
  const siigoRequest = requests.find((request) => request.path.startsWith('/siigo/'));
  if (
    siigoRequest?.authorization !== 'Bearer siigo-smoke-token' ||
    siigoRequest.partnerId !== 'SevaleSmoke'
  ) {
    throw new Error('Siigo no recibió los encabezados de autenticación esperados.');
  }
  const wooRequest = requests.find((request) => request.path.startsWith('/seratus/'));
  if (!wooRequest?.authorization?.startsWith('Basic ') || wooRequest.path.includes('consumer_')) {
    throw new Error('WooCommerce no recibió autenticación HTTP Basic segura.');
  }

  process.stdout.write(
    'Integrations smoke: auth, Siigo, Seratus, Pali, normalization, invalid data, safe errors and GET-only checks passed.\n',
  );
} finally {
  await prisma.integrationToken.deleteMany({ where: { provider: tokenProvider } });
  await prisma.user.deleteMany({ where: { id: userId } });
  await app.close();
  await new Promise<void>((resolve, reject) =>
    upstream.close((error) => (error ? reject(error) : resolve())),
  );
}
