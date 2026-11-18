import '../apps/api/src/config/load-environment.js';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword } from 'better-auth/crypto';
import { AppModule } from '../apps/api/src/app.module.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { Role, Store, SyncStatus } from '../apps/api/src/generated/prisma/client.js';

process.env.BETTER_AUTH_SECRET ||= 'local-product-refresh-smoke-secret-at-least-32-characters';

const runId = randomUUID();
const tokenProvider = `SIIGO_REFRESH_${runId}`;
const externalRequests = new Map<string, number>();

function recordRequest(sku: string | null) {
  if (sku) externalRequests.set(sku, (externalRequests.get(sku) ?? 0) + 1);
}

type SiigoProductOptions = {
  missingCop?: boolean;
  stock?: number;
};

function siigoProduct(sku: string, options: SiigoProductOptions = {}) {
  const priceList = [
    { position: 1, name: 'PESOS', value: 100 },
    { position: 2, name: 'DOLAR', value: 10 },
    { position: 3, name: 'MXN', value: 50 },
    { position: 4, name: 'EUR', value: 5 },
  ].filter((entry) => !(options.missingCop && entry.name === 'PESOS'));

  return {
    id: `siigo-${sku}`,
    code: sku,
    name: `Producto ${sku}`,
    available_quantity: options.stock ?? 7,
    prices: [{ currency_code: 'COP', price_list: priceList }],
    warehouses: [
      { id: -1, name: 'Sin asignar', quantity: 1 },
      { id: 177, name: 'PALI', quantity: 2 },
      { id: 178, name: 'SERATUS', quantity: 3 },
      { id: 185, name: 'SERATUS BOGOTA PORTAL 80', quantity: 1 },
      // Siigo puede devolver cantidades negativas; el CRM debe descartarlas.
      { id: 188, name: 'SERATUS BOGOTA FLORENCIA', quantity: -4 },
    ],
  };
}

function send(request: IncomingMessage, response: ServerResponse, payload: unknown) {
  request.resume();
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

const upstream = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/siigo/v1/products') {
    request.resume();
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'not found' }));
    return;
  }

  const sku = url.searchParams.get('code');
  recordRequest(sku);
  if (!sku) return send(request, response, { results: [] });

  if (sku === 'REFRESH-NOTFOUND') return send(request, response, { results: [] });
  if (sku === 'REFRESH-MISSING-PRICES') {
    return send(request, response, { results: [siigoProduct(sku, { missingCop: true })] });
  }
  if (sku === 'REFRESH-DECIMAL-STOCK') {
    return send(request, response, { results: [siigoProduct(sku, { stock: 7.5 })] });
  }
  if (sku === 'REFRESH-NEGATIVE-STOCK') {
    return send(request, response, { results: [siigoProduct(sku, { stock: -1 })] });
  }
  return send(request, response, { results: [siigoProduct(sku)] });
});

await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const address = upstream.address();
if (!address || typeof address === 'string') throw new Error('No se inició Siigo simulado.');
const upstreamUrl = `http://127.0.0.1:${address.port}`;
process.env.SIIGO_API_URL = `${upstreamUrl}/siigo/v1`;
process.env.SIIGO_USERNAME = 'refresh-smoke-user';
process.env.SIIGO_ACCESS_KEY = 'refresh-smoke-key';
process.env.SIIGO_PARTNER_ID = 'SevaleRefreshSmoke';
process.env.SIIGO_TOKEN_PROVIDER = tokenProvider;

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
  logger: false,
});
app.setGlobalPrefix('api');
await app.listen(0, '127.0.0.1');

const prisma = app.get(PrismaService);
const baseUrl = await app.getUrl();
const origin = process.env.FRONTEND_URL || 'http://localhost:5173';
const userIds = [randomUUID(), randomUUID()] as const;
const emails = [
  `refresh-admin-${runId}@example.invalid`,
  `refresh-commercial-${runId}@example.invalid`,
] as const;
const password = `S-${randomUUID()}-9a!`;
const createdProductIds: number[] = [];

type ProductResponse = {
  id: number;
  siigoId: string;
  sku: string;
  siigoPriceCop: number;
  siigoPriceUsd: number;
  siigoPriceMxn: number | null;
  siigoPriceEur: number | null;
  siigoStock: number;
  siigoWarehouses: { id: number; name: string; quantity: number }[] | null;
  siigoWarehousesUpdatedAt: string | null;
  wooPriceCop: number;
  wooPriceUsd: number;
  wooPriceMxn: number | null;
  wooPriceEur: number | null;
  wooStock: number;
  syncStatus: string;
  lastSyncAt: string | null;
  lastCheckAt: string | null;
  productName: string;
  updatedAt: string;
};

type ErrorBody = { error?: { code?: string; message?: string } };

function expectStatus(response: Response, status: number, context: string) {
  if (response.status !== status) {
    throw new Error(`${context}: se esperaba ${status} y se recibió ${response.status}.`);
  }
}

async function expectErrorCode(response: Response, status: number, code: string, context: string) {
  expectStatus(response, status, context);
  const body = (await response.json()) as ErrorBody;
  if (body.error?.code !== code) {
    throw new Error(
      `${context}: se esperaba el código ${code} y se recibió ${body.error?.code ?? 'sin código'}.`,
    );
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

async function api(path: string, cookie?: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      origin,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...init?.headers,
    },
  });
}

async function createProduct(sku: string, woo: { priceEur: number; stock: number }) {
  const product = await prisma.product.create({
    data: {
      siigoId: `siigo-${sku}`,
      sku,
      siigoPriceCop: 1,
      siigoPriceUsd: 1,
      siigoPriceMxn: 1,
      siigoPriceEur: 1,
      siigoStock: 1,
      store: Store.SERATUS,
      wooParentId: 9000n,
      wooVariationId: 9001n,
      wooSku: sku,
      wooPriceCop: 100,
      wooPriceUsd: 10,
      wooPriceMxn: 50,
      wooPriceEur: woo.priceEur,
      wooStock: woo.stock,
      syncStatus: SyncStatus.PENDING,
      lastSyncAt: new Date('2026-01-01T00:00:00.000Z'),
      productName: `Producto ${sku}`,
    },
  });
  createdProductIds.push(product.id);
  return product;
}

try {
  await prisma.integrationToken.create({
    data: {
      provider: tokenProvider,
      accessToken: 'siigo-refresh-smoke-token',
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });

  const passwordHash = await hashPassword(password);
  const users = [
    { id: userIds[0], email: emails[0], role: Role.ADMIN, name: 'Refresh Smoke Admin' },
    {
      id: userIds[1],
      email: emails[1],
      role: Role.COMMERCIAL,
      name: 'Refresh Smoke Commercial',
    },
  ] as const;
  for (const user of users) {
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

  const adminCookie = await login(emails[0]);
  const commercialCookie = await login(emails[1]);

  const matchProduct = await createProduct('REFRESH-MATCH', { priceEur: 5, stock: 7 });
  const matchPath = `/api/products/${matchProduct.id}/refresh-from-siigo`;

  expectStatus(await api(matchPath, undefined, { method: 'POST' }), 401, 'Actualización anónima');
  expectStatus(
    await api(matchPath, commercialCookie, { method: 'POST' }),
    403,
    'Actualización comercial',
  );

  const beforeMatch = await prisma.product.findUniqueOrThrow({ where: { id: matchProduct.id } });
  const matchResponse = await api(matchPath, adminCookie, { method: 'POST' });
  expectStatus(matchResponse, 200, 'Actualización administrativa');
  const updated = (await matchResponse.json()) as ProductResponse;
  if (
    updated.syncStatus !== 'SYNCED' ||
    updated.siigoPriceCop !== 100 ||
    updated.siigoPriceUsd !== 10 ||
    updated.siigoPriceMxn !== 50 ||
    updated.siigoPriceEur !== 5 ||
    updated.siigoStock !== 7 ||
    updated.siigoWarehouses?.length !== 3 ||
    updated.siigoWarehouses[0]?.id !== -1 ||
    updated.siigoWarehouses[0]?.name !== 'Sin asignar' ||
    updated.siigoWarehouses[0]?.quantity !== 1 ||
    updated.siigoWarehouses[1]?.id !== 178 ||
    updated.siigoWarehouses[1]?.name !== 'Bodega' ||
    updated.siigoWarehouses[1]?.quantity !== 5 ||
    updated.siigoWarehouses[2]?.id !== 185 ||
    updated.siigoWarehouses[2]?.name !== 'Portal 80' ||
    updated.siigoWarehouses[2]?.quantity !== 1 ||
    !updated.siigoWarehousesUpdatedAt ||
    !updated.lastCheckAt ||
    updated.lastSyncAt !== beforeMatch.lastSyncAt?.toISOString() ||
    updated.wooPriceCop !== 100 ||
    updated.wooPriceUsd !== 10 ||
    updated.wooPriceMxn !== 50 ||
    updated.wooPriceEur !== 5 ||
    updated.wooStock !== 7 ||
    updated.siigoId !== beforeMatch.siigoId ||
    updated.productName !== beforeMatch.productName
  ) {
    throw new Error('La actualización no devolvió el producto con los valores esperados.');
  }

  const afterMatch = await prisma.product.findUniqueOrThrow({ where: { id: matchProduct.id } });
  const rawMatchWarehouses = afterMatch.siigoWarehouses as
    | {
        id: number;
        name: string;
        quantity: number;
      }[]
    | null;
  if (
    !Array.isArray(rawMatchWarehouses) ||
    rawMatchWarehouses.length !== 4 ||
    rawMatchWarehouses[0]?.id !== -1 ||
    rawMatchWarehouses[0]?.quantity !== 1 ||
    rawMatchWarehouses[1]?.id !== 177 ||
    rawMatchWarehouses[1]?.quantity !== 2 ||
    rawMatchWarehouses[2]?.id !== 178 ||
    rawMatchWarehouses[2]?.quantity !== 3 ||
    rawMatchWarehouses[3]?.id !== 185 ||
    rawMatchWarehouses[3]?.quantity !== 1 ||
    !afterMatch.siigoWarehousesUpdatedAt ||
    !afterMatch.lastCheckAt ||
    afterMatch.lastSyncAt?.getTime() !== beforeMatch.lastSyncAt?.getTime() ||
    afterMatch.updatedAt.getTime() === beforeMatch.updatedAt.getTime()
  ) {
    throw new Error('La actualización no persistió los campos esperados o alteró WooCommerce.');
  }
  if ((externalRequests.get('REFRESH-MATCH') ?? 0) === 0) {
    throw new Error('La actualización no consultó Siigo por el SKU.');
  }
  if ((await prisma.notification.count({ where: { productId: matchProduct.id } })) !== 0) {
    throw new Error('La actualización manual creó una notificación persistente.');
  }

  const diffProduct = await createProduct('REFRESH-DIFF', { priceEur: 4, stock: 6 });
  const beforeDiff = await prisma.product.findUniqueOrThrow({ where: { id: diffProduct.id } });
  const diffResponse = await api(
    `/api/products/${diffProduct.id}/refresh-from-siigo`,
    adminCookie,
    { method: 'POST' },
  );
  expectStatus(diffResponse, 200, 'Actualización con diferencias');
  const diff = (await diffResponse.json()) as ProductResponse;
  if (
    diff.syncStatus !== 'OUT_OF_SYNC' ||
    diff.siigoPriceEur !== 5 ||
    diff.siigoStock !== 7 ||
    diff.wooPriceEur !== 4 ||
    diff.wooStock !== 6 ||
    !diff.lastCheckAt ||
    !diff.siigoWarehousesUpdatedAt
  ) {
    throw new Error('La comparación no dejó el producto desactualizado ni conservó WooCommerce.');
  }
  const afterDiff = await prisma.product.findUniqueOrThrow({ where: { id: diffProduct.id } });
  if (
    afterDiff.syncStatus !== SyncStatus.OUT_OF_SYNC ||
    Number(afterDiff.wooPriceEur) !== 4 ||
    afterDiff.wooStock !== 6 ||
    afterDiff.lastSyncAt?.getTime() !== beforeDiff.lastSyncAt?.getTime()
  ) {
    throw new Error('La actualización con diferencias alteró el espejo de WooCommerce.');
  }

  const missingProduct = await createProduct('REFRESH-MISSING-PRICES', {
    priceEur: 5,
    stock: 7,
  });
  const beforeMissing = await prisma.product.findUniqueOrThrow({
    where: { id: missingProduct.id },
  });
  await expectErrorCode(
    await api(`/api/products/${missingProduct.id}/refresh-from-siigo`, adminCookie, {
      method: 'POST',
    }),
    422,
    'SIIGO_PRICES_INCOMPLETE',
    'Precios incompletos',
  );
  const afterMissing = await prisma.product.findUniqueOrThrow({
    where: { id: missingProduct.id },
  });
  if (
    Number(afterMissing.siigoPriceCop) !== Number(beforeMissing.siigoPriceCop) ||
    afterMissing.siigoStock !== beforeMissing.siigoStock ||
    afterMissing.syncStatus !== beforeMissing.syncStatus ||
    afterMissing.lastCheckAt?.getTime() !== beforeMissing.lastCheckAt?.getTime() ||
    afterMissing.updatedAt.getTime() !== beforeMissing.updatedAt.getTime()
  ) {
    throw new Error('El rechazo de precios incompletos modificó el producto.');
  }

  for (const [sku, context] of [
    ['REFRESH-DECIMAL-STOCK', 'Stock decimal'],
    ['REFRESH-NEGATIVE-STOCK', 'Stock negativo'],
  ] as const) {
    const product = await createProduct(sku, { priceEur: 5, stock: 7 });
    const before = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    await expectErrorCode(
      await api(`/api/products/${product.id}/refresh-from-siigo`, adminCookie, {
        method: 'POST',
      }),
      422,
      'SIIGO_STOCK_INVALID',
      context,
    );
    const after = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
    if (
      after.siigoStock !== before.siigoStock ||
      after.lastCheckAt?.getTime() !== before.lastCheckAt?.getTime() ||
      after.updatedAt.getTime() !== before.updatedAt.getTime()
    ) {
      throw new Error(`${context}: el rechazo modificó el producto.`);
    }
  }

  const notFoundProduct = await createProduct('REFRESH-NOTFOUND', { priceEur: 5, stock: 7 });
  const beforeNotFound = await prisma.product.findUniqueOrThrow({
    where: { id: notFoundProduct.id },
  });
  await expectErrorCode(
    await api(`/api/products/${notFoundProduct.id}/refresh-from-siigo`, adminCookie, {
      method: 'POST',
    }),
    404,
    'PRODUCT_NOT_FOUND_IN_SIIGO',
    'SKU ausente en Siigo',
  );
  const afterNotFound = await prisma.product.findUniqueOrThrow({
    where: { id: notFoundProduct.id },
  });
  if (
    Number(afterNotFound.siigoPriceCop) !== Number(beforeNotFound.siigoPriceCop) ||
    afterNotFound.updatedAt.getTime() !== beforeNotFound.updatedAt.getTime()
  ) {
    throw new Error('El SKU ausente en Siigo modificó el producto.');
  }

  await expectErrorCode(
    await api('/api/products/2147483647/refresh-from-siigo', adminCookie, { method: 'POST' }),
    404,
    'PRODUCT_NOT_FOUND',
    'Producto local inexistente',
  );

  if (
    (externalRequests.get('REFRESH-DIFF') ?? 0) === 0 ||
    (externalRequests.get('REFRESH-MISSING-PRICES') ?? 0) === 0 ||
    (externalRequests.get('REFRESH-DECIMAL-STOCK') ?? 0) === 0 ||
    (externalRequests.get('REFRESH-NEGATIVE-STOCK') ?? 0) === 0 ||
    (externalRequests.get('REFRESH-NOTFOUND') ?? 0) === 0
  ) {
    throw new Error('No se consultó Siigo en todos los SKU de prueba.');
  }

  process.stdout.write(
    'Product refresh smoke: auth, RBAC, Siigo GET, local update, four-currency/stock comparison, warehouses, timestamp and error checks passed.\n',
  );
} finally {
  if (createdProductIds.length > 0) {
    await prisma.notification.deleteMany({ where: { productId: { in: createdProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  }
  await prisma.integrationToken.deleteMany({ where: { provider: tokenProvider } });
  await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
  await app.close();
  await new Promise<void>((resolve, reject) =>
    upstream.close((error) => (error ? reject(error) : resolve())),
  );
}
