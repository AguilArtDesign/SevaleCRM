import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import '../apps/api/src/config/load-environment.js';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword } from 'better-auth/crypto';
import { AppModule } from '../apps/api/src/app.module.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { Role, Store, SyncStatus } from '../apps/api/src/generated/prisma/client.js';

process.env.BETTER_AUTH_SECRET ||= 'local-product-sync-smoke-secret-at-least-32-characters';

type CapturedRequest = {
  method: string;
  path: string;
  authorization: string;
  body: unknown;
};

const requests: CapturedRequest[] = [];
let variationAttempts = 0;

async function readJson(request: IncomingMessage): Promise<unknown> {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(Buffer.from(chunk as Uint8Array));
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
}

function send(response: ServerResponse, status: number, payload: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

const upstream = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', 'http://127.0.0.1');
    const body = await readJson(request);
    requests.push({
      method: request.method ?? '',
      path: url.pathname,
      authorization: request.headers.authorization ?? '',
      body,
    });
    if (url.pathname.endsWith('/products/1100/variations/1102')) {
      variationAttempts += 1;
      if (variationAttempts === 1) {
        send(response, 503, { message: 'temporary upstream failure' });
        return;
      }
    }
    if (url.pathname.endsWith('/products/999')) {
      send(response, 500, { message: 'upstream failure' });
      return;
    }
    if (url.pathname.endsWith('/batch')) {
      const update =
        typeof body === 'object' && body !== null && 'update' in body && Array.isArray(body.update)
          ? body.update
          : [];
      send(response, 200, { update });
      return;
    }
    const id = Number(url.pathname.split('/').at(-1));
    send(response, 200, { id });
  })().catch((error: unknown) => {
    send(response, 500, { message: error instanceof Error ? error.message : 'unknown error' });
  });
});

await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const address = upstream.address();
if (!address || typeof address === 'string') throw new Error('No se inició WooCommerce simulado.');
const upstreamUrl = `http://127.0.0.1:${address.port}`;

process.env.SERATUS_API_URL = `${upstreamUrl}/seratus/wc/v3`;
process.env.WOOCOMMERCE_SERATUS_CK = 'seratus-key';
process.env.WOOCOMMERCE_SERATUS_CS = 'seratus-secret';
process.env.PALI_API_URL = `${upstreamUrl}/pali/wc/v3`;
process.env.WOOCOMMERCE_PALI_CK = 'pali-key';
process.env.WOOCOMMERCE_PALI_CS = 'pali-secret';

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
  logger: false,
  abortOnError: false,
});
app.setGlobalPrefix('api');
await app.listen(0, '127.0.0.1');

const prisma = app.get(PrismaService);
const baseUrl = await app.getUrl();
const origin = process.env.FRONTEND_URL || 'http://localhost:5173';
const runId = randomUUID();
const userIds = [randomUUID(), randomUUID()] as const;
const emails = [
  `sync-admin-${runId}@example.invalid`,
  `sync-commercial-${runId}@example.invalid`,
] as const;
const password = `S-${randomUUID()}-9a!`;
const productIds: number[] = [];
const jobIds: string[] = [];

function expectStatus(response: Response, status: number, context: string) {
  if (response.status !== status) {
    throw new Error(`${context}: se esperaba ${status} y se recibió ${response.status}.`);
  }
}

async function login(email: string) {
  const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      'x-captcha-response': 'XXXX.DUMMY.TOKEN.XXXX',
    },
    body: JSON.stringify({ email, password }),
  });
  expectStatus(response, 200, `Inicio de sesión de ${email}`);
  const cookie = response.headers.getSetCookie()[0]?.split(';')[0];
  if (!cookie) throw new Error('Better Auth no creó la cookie de sesión.');
  return cookie;
}

function api(path: string, cookie?: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method: 'POST',
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

async function createProduct({
  suffix,
  store,
  parentId,
  productId,
}: {
  suffix: string;
  store: Store;
  parentId: bigint | null;
  productId: bigint;
}) {
  const sku = `SYNC-${suffix}-${runId}`;
  const product = await prisma.product.create({
    data: {
      siigoId: `siigo-${sku}`,
      sku,
      siigoPriceCop: 45_000,
      siigoPriceUsd: 23,
      siigoStock: 27,
      store,
      wooParentId: parentId,
      wooVariationId: productId,
      wooSku: sku,
      wooPriceCop: 40_000,
      wooPriceUsd: 20,
      wooStock: 10,
      syncStatus: SyncStatus.OUT_OF_SYNC,
      productName: `Producto ${suffix}`,
    },
  });
  productIds.push(product.id);
  return product;
}

try {
  const passwordHash = await hashPassword(password);
  for (const user of [
    { id: userIds[0], email: emails[0], role: Role.ADMIN, name: 'Sync Smoke Admin' },
    {
      id: userIds[1],
      email: emails[1],
      role: Role.COMMERCIAL,
      name: 'Sync Smoke Commercial',
    },
  ] as const) {
    await prisma.user.create({
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: true,
        role: user.role,
        active: true,
        accounts: {
          create: {
            id: randomUUID(),
            accountId: user.id,
            providerId: 'credential',
            issuer: 'local:credential',
            password: passwordHash,
          },
        },
      },
    });
  }

  const variation = await createProduct({
    suffix: 'VARIATION',
    store: Store.PALI,
    parentId: 1100n,
    productId: 1102n,
  });
  const simple = await createProduct({
    suffix: 'SIMPLE',
    store: Store.SERATUS,
    parentId: null,
    productId: 2202n,
  });
  const failing = await createProduct({
    suffix: 'FAIL',
    store: Store.PALI,
    parentId: null,
    productId: 999n,
  });

  expectStatus(await api(`/api/products/${variation.id}/sync`), 401, 'Sincronización anónima');
  const adminCookie = await login(emails[0]);
  const commercialCookie = await login(emails[1]);
  expectStatus(
    await api(`/api/products/${variation.id}/sync`, commercialCookie),
    403,
    'Sincronización comercial',
  );

  const variationResponse = await api(`/api/products/${variation.id}/sync`, adminCookie);
  expectStatus(variationResponse, 201, 'Sincronización de variante');
  const synchronizedVariation = (await variationResponse.json()) as {
    syncStatus: string;
    wooPriceCop: number;
    wooPriceUsd: number;
    wooStock: number;
    lastSyncAt: string | null;
  };
  if (
    synchronizedVariation.syncStatus !== 'SYNCED' ||
    synchronizedVariation.wooPriceCop !== 45_000 ||
    synchronizedVariation.wooPriceUsd !== 23 ||
    synchronizedVariation.wooStock !== 27 ||
    !synchronizedVariation.lastSyncAt
  ) {
    throw new Error('La variante no guardó el resultado sincronizado esperado.');
  }
  if (variationAttempts !== 2) {
    throw new Error('La sincronización no reintentó el fallo transitorio de WooCommerce.');
  }

  const simpleResponse = await api(`/api/products/${simple.id}/sync`, adminCookie);
  expectStatus(simpleResponse, 201, 'Sincronización de producto simple');
  const synchronizedSimple = (await simpleResponse.json()) as { syncStatus: string };
  if (synchronizedSimple.syncStatus !== 'SYNCED') {
    throw new Error('El producto simple no quedó sincronizado.');
  }

  const bulkResponse = await api('/api/products/sync-jobs', adminCookie, {
    ids: [variation.id, simple.id],
  });
  expectStatus(bulkResponse, 202, 'Creación de sincronización masiva');
  let bulkJob = (await bulkResponse.json()) as {
    id: string;
    status: string;
    succeeded: number;
    failed: number;
  };
  jobIds.push(bulkJob.id);
  for (let attempt = 0; attempt < 50 && !bulkJob.status.startsWith('COMPLETED'); attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 50));
    const response = await fetch(`${baseUrl}/api/products/sync-jobs/${bulkJob.id}`, {
      headers: { origin, cookie: adminCookie },
    });
    expectStatus(response, 200, 'Consulta de sincronización masiva');
    bulkJob = (await response.json()) as typeof bulkJob;
  }
  if (bulkJob.status !== 'COMPLETED' || bulkJob.succeeded !== 2 || bulkJob.failed !== 0) {
    throw new Error('La sincronización masiva no terminó con el resumen esperado.');
  }
  if (
    !requests.some(
      (request) =>
        request.method === 'POST' && request.path === '/pali/wc/v3/products/1100/variations/batch',
    ) ||
    !requests.some(
      (request) => request.method === 'POST' && request.path === '/seratus/wc/v3/products/batch',
    )
  ) {
    throw new Error('La sincronización masiva no agrupó productos y variaciones correctamente.');
  }

  const expectedBody = {
    regular_price: '45000',
    stock_quantity: 27,
    manage_stock: true,
    meta_data: [{ key: '_regular_price_wmcp', value: '{"USD":"23"}' }],
  };
  const variationRequest = requests
    .filter((item) => item.path.endsWith('/products/1100/variations/1102'))
    .at(-1);
  const simpleRequest = requests.find((item) => item.path.endsWith('/products/2202'));
  if (
    variationRequest?.method !== 'PUT' ||
    variationRequest.path !== '/pali/wc/v3/products/1100/variations/1102' ||
    JSON.stringify(variationRequest.body) !== JSON.stringify(expectedBody) ||
    variationRequest.authorization !==
      `Basic ${Buffer.from('pali-key:pali-secret').toString('base64')}`
  ) {
    throw new Error('La petición de la variante no coincide con el contrato de WooCommerce.');
  }
  if (
    simpleRequest?.method !== 'PUT' ||
    simpleRequest.path !== '/seratus/wc/v3/products/2202' ||
    JSON.stringify(simpleRequest.body) !== JSON.stringify(expectedBody)
  ) {
    throw new Error('La petición del producto simple no coincide con el contrato esperado.');
  }

  const failureResponse = await api(`/api/products/${failing.id}/sync`, adminCookie);
  expectStatus(failureResponse, 502, 'Fallo de WooCommerce');
  const storedFailure = await prisma.product.findUnique({ where: { id: failing.id } });
  if (storedFailure?.syncStatus !== SyncStatus.ERROR || storedFailure.lastSyncAt !== null) {
    throw new Error('El fallo no conservó la fecha ni registró el estado de error.');
  }

  process.stdout.write(
    'Product sync smoke: auth, RBAC, transient retry, individual and durable batch synchronization, WooCommerce payload, local persistence and failure state checks passed.\n',
  );
} finally {
  if (productIds.length > 0) {
    await prisma.notification.deleteMany({ where: { productId: { in: productIds } } });
    if (jobIds.length > 0)
      await prisma.productSyncJob.deleteMany({ where: { id: { in: jobIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  }
  await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
  await app.close();
  await new Promise<void>((resolve, reject) =>
    upstream.close((error) => (error ? reject(error) : resolve())),
  );
}
