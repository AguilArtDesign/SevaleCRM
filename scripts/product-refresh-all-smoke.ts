import '../apps/api/src/config/load-environment.js';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword } from 'better-auth/crypto';
import { AppModule } from '../apps/api/src/app.module.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { Role, Store, SyncStatus } from '../apps/api/src/generated/prisma/client.js';

process.env.BETTER_AUTH_SECRET ||= 'local-product-refresh-all-smoke-secret-at-least-32';

const runId = randomUUID();
const tokenProvider = `SIIGO_REFRESH_ALL_${runId}`;
const ghostPrefix = `GHOST-${runId.slice(0, 8)}-`;

type ProductPrices = { cop: number; usd: number; mxn: number; eur: number };

function priceList(values: ProductPrices) {
  return [
    { position: 1, name: 'PESOS', value: values.cop },
    { position: 2, name: 'DOLAR', value: values.usd },
    { position: 3, name: 'MXN', value: values.mxn },
    { position: 4, name: 'EUR', value: values.eur },
  ];
}

function siigoProduct(
  sku: string,
  prices: ProductPrices = { cop: 100, usd: 10, mxn: 50, eur: 5 },
  stock = 7,
) {
  return {
    id: `siigo-${sku}`,
    code: sku,
    name: `Producto ${sku}`,
    available_quantity: stock,
    prices: [{ currency_code: 'COP', price_list: priceList(prices) }],
    warehouses: [
      { id: -1, name: 'Sin asignar', quantity: 1 },
      { id: 178, name: 'SERATUS', quantity: 3 },
    ],
  };
}

function ghostProduct(index: number) {
  return {
    id: `siigo-${ghostPrefix}${index}`,
    code: `${ghostPrefix}${index}`,
    name: `Fantasma ${index}`,
    available_quantity: 1,
    prices: [
      {
        currency_code: 'COP',
        price_list: priceList({ cop: 1, usd: 1, mxn: 1, eur: 1 }),
      },
    ],
    warehouses: [],
  };
}

function send(request: IncomingMessage, response: ServerResponse, payload: unknown) {
  request.resume();
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

const requestedPages: Array<{ page: number; pageSize: number }> = [];

const upstream = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  if (url.pathname !== '/siigo/v1/products') {
    request.resume();
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'not found' }));
    return;
  }

  const page = Number(url.searchParams.get('page') ?? '1');
  const pageSize = Number(url.searchParams.get('page_size') ?? '0');
  requestedPages.push({ page, pageSize });

  // 102 resultados: la primera página llena las cien posiciones y la segunda trae los dos
  // restantes. Así se comprueba que el trabajo avanza de página y se detiene por `total_results`.
  let results: unknown[] = [];
  if (page === 1) {
    results = [
      siigoProduct('BULK-MATCH'),
      siigoProduct('BULK-DIFF'),
      ...Array.from({ length: 98 }, (_, index) => ghostProduct(index)),
    ];
  } else if (page === 2) {
    results = [
      siigoProduct('BULK-SECOND', { cop: 200, usd: 20, mxn: 60, eur: 6 }, 8),
      ghostProduct(98),
    ];
  }

  send(request, response, {
    pagination: { page, page_size: pageSize, total_results: 102 },
    results,
  });
});

await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const address = upstream.address();
if (!address || typeof address === 'string') throw new Error('No se inició Siigo simulado.');
const upstreamUrl = `http://127.0.0.1:${address.port}`;
process.env.SIIGO_API_URL = `${upstreamUrl}/siigo/v1`;
process.env.SIIGO_USERNAME = 'refresh-all-smoke-user';
process.env.SIIGO_ACCESS_KEY = 'refresh-all-smoke-key';
process.env.SIIGO_PARTNER_ID = 'SevaleRefreshAllSmoke';
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
  `refresh-all-admin-${runId}@example.invalid`,
  `refresh-all-commercial-${runId}@example.invalid`,
] as const;
const password = `S-${randomUUID()}-9a!`;
const createdProductIds: number[] = [];

type RefreshJobResponse = {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED';
  pagesProcessed: number;
  totalResults: number | null;
  totalPages: number | null;
  scanned: number;
  matched: number;
  updated: number;
  synced: number;
  outOfSync: number;
  discarded: number;
  failed: number;
  errorMessage: string | null;
  startedAt: string | null;
  completedAt: string | null;
};

type ErrorBody = { error?: { code?: string; message?: string } };

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

async function createProduct(sku: string, woo: { prices: ProductPrices; stock: number }) {
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
      wooPriceCop: woo.prices.cop,
      wooPriceUsd: woo.prices.usd,
      wooPriceMxn: woo.prices.mxn,
      wooPriceEur: woo.prices.eur,
      wooStock: woo.stock,
      syncStatus: SyncStatus.PENDING,
      lastSyncAt: new Date('2026-01-01T00:00:00.000Z'),
      productName: `Producto ${sku}`,
    },
  });
  createdProductIds.push(product.id);
  return product;
}

async function waitForJob(jobId: string, cookie: string): Promise<RefreshJobResponse> {
  const deadline = Date.now() + 20_000;
  while (Date.now() < deadline) {
    const response = await api(`/api/products/refresh-jobs/${jobId}`, cookie);
    expectStatus(response, 200, 'Consulta del barrido');
    const job = (await response.json()) as RefreshJobResponse;
    if (
      job.status === 'COMPLETED' ||
      job.status === 'COMPLETED_WITH_ERRORS' ||
      job.status === 'FAILED'
    ) {
      return job;
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('El barrido completo no terminó en el tiempo esperado.');
}

async function waitForPageLogs() {
  const deadline = Date.now() + 3_000;
  while (Date.now() < deadline) {
    const logs = await prisma.integrationLog.findMany({
      where: {
        integration: 'Siigo',
        operation: 'GET /siigo/v1/products',
        url: { startsWith: upstreamUrl },
      },
      select: { id: true, responseBody: true },
    });
    if (logs.length >= 2) return logs;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error('No se registraron las páginas consultadas a Siigo.');
}

try {
  await prisma.integrationToken.create({
    data: {
      provider: tokenProvider,
      accessToken: 'siigo-refresh-all-smoke-token',
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });

  const passwordHash = await hashPassword(password);
  const users = [
    { id: userIds[0], email: emails[0], role: Role.ADMIN, name: 'Refresh All Admin' },
    {
      id: userIds[1],
      email: emails[1],
      role: Role.COMMERCIAL,
      name: 'Refresh All Commercial',
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

  const matchProduct = await createProduct('BULK-MATCH', {
    prices: { cop: 100, usd: 10, mxn: 50, eur: 5 },
    stock: 7,
  });
  const diffProduct = await createProduct('BULK-DIFF', {
    prices: { cop: 100, usd: 10, mxn: 50, eur: 4 },
    stock: 6,
  });
  const secondProduct = await createProduct('BULK-SECOND', {
    prices: { cop: 200, usd: 20, mxn: 60, eur: 6 },
    stock: 8,
  });
  const beforeMatch = await prisma.product.findUniqueOrThrow({ where: { id: matchProduct.id } });
  const beforeDiff = await prisma.product.findUniqueOrThrow({ where: { id: diffProduct.id } });

  const jobPath = '/api/products/refresh-jobs';
  expectStatus(await api(jobPath, undefined, { method: 'POST' }), 401, 'Barrido anónimo');
  expectStatus(await api(jobPath, commercialCookie, { method: 'POST' }), 403, 'Barrido comercial');
  expectStatus(await api(`${jobPath}/latest`, undefined), 401, 'Último barrido anónimo');
  expectStatus(await api(`${jobPath}/latest`, commercialCookie), 403, 'Último barrido comercial');

  // Un trabajo pendiente ya en la base rechaza otro: dos barridos en paralelo duplicarían el cupo.
  const pending = await prisma.productRefreshJob.create({
    data: { requestedById: userIds[0], status: 'PENDING' },
  });
  const conflict = await api(jobPath, adminCookie, { method: 'POST' });
  expectStatus(conflict, 409, 'Barrido concurrente');
  if (((await conflict.json()) as ErrorBody).error?.code !== 'PRODUCT_REFRESH_IN_PROGRESS') {
    throw new Error('El barrido concurrente no devolvió el código esperado.');
  }
  await prisma.productRefreshJob.delete({ where: { id: pending.id } });

  const createdResponse = await api(jobPath, adminCookie, { method: 'POST' });
  expectStatus(createdResponse, 202, 'Barrido administrativo');
  let job = (await createdResponse.json()) as RefreshJobResponse;
  if (job.status !== 'PENDING' && job.status !== 'RUNNING') {
    throw new Error('El barrido no se creó en un estado activo.');
  }
  job = await waitForJob(job.id, adminCookie);

  if (
    job.status !== 'COMPLETED' ||
    job.pagesProcessed !== 2 ||
    job.totalResults !== 102 ||
    job.totalPages !== 2 ||
    job.scanned !== 102 ||
    job.matched !== 3 ||
    job.updated !== 3 ||
    job.synced !== 2 ||
    job.outOfSync !== 1 ||
    job.discarded !== 99 ||
    job.failed !== 0 ||
    job.errorMessage !== null ||
    !job.startedAt ||
    !job.completedAt
  ) {
    throw new Error(`El resumen del barrido no coincide: ${JSON.stringify(job)}.`);
  }

  if (
    requestedPages.length !== 2 ||
    requestedPages[0]?.page !== 1 ||
    requestedPages[1]?.page !== 2 ||
    requestedPages.some((entry) => entry.pageSize !== 100)
  ) {
    throw new Error(
      `El barrido no recorrió las páginas esperadas: ${JSON.stringify(requestedPages)}.`,
    );
  }

  const latestResponse = await api(`${jobPath}/latest`, adminCookie);
  expectStatus(latestResponse, 200, 'Último barrido');
  const latestBody = (await latestResponse.json()) as { job: RefreshJobResponse | null };
  const latest = latestBody.job;
  if (
    !latest ||
    latest.id !== job.id ||
    latest.status !== 'COMPLETED' ||
    latest.totalResults !== 102 ||
    latest.totalPages !== 2 ||
    latest.updated !== 3
  ) {
    throw new Error(`El último barrido no coincide con el terminado: ${JSON.stringify(latest)}.`);
  }

  const afterMatch = await prisma.product.findUniqueOrThrow({ where: { id: matchProduct.id } });
  const rawWarehouses = afterMatch.siigoWarehouses as
    { id: number; name: string; quantity: number }[] | null;
  if (
    afterMatch.syncStatus !== SyncStatus.SYNCED ||
    Number(afterMatch.siigoPriceCop) !== 100 ||
    Number(afterMatch.siigoPriceUsd) !== 10 ||
    Number(afterMatch.siigoPriceMxn) !== 50 ||
    Number(afterMatch.siigoPriceEur) !== 5 ||
    afterMatch.siigoStock !== 7 ||
    !Array.isArray(rawWarehouses) ||
    rawWarehouses.length !== 2 ||
    rawWarehouses[0]?.id !== -1 ||
    rawWarehouses[1]?.id !== 178 ||
    !afterMatch.siigoWarehousesUpdatedAt ||
    !afterMatch.lastCheckAt ||
    afterMatch.lastSyncAt?.getTime() !== beforeMatch.lastSyncAt?.getTime() ||
    afterMatch.updatedAt.getTime() !== beforeMatch.updatedAt.getTime() ||
    Number(afterMatch.wooPriceEur) !== 5 ||
    afterMatch.wooStock !== 7
  ) {
    throw new Error('El producto coincidente no quedó sincronizado o se alteró WooCommerce.');
  }

  const afterDiff = await prisma.product.findUniqueOrThrow({ where: { id: diffProduct.id } });
  if (
    afterDiff.syncStatus !== SyncStatus.OUT_OF_SYNC ||
    Number(afterDiff.siigoPriceEur) !== 5 ||
    afterDiff.siigoStock !== 7 ||
    Number(afterDiff.wooPriceEur) !== 4 ||
    afterDiff.wooStock !== 6 ||
    afterDiff.lastSyncAt?.getTime() !== beforeDiff.lastSyncAt?.getTime() ||
    afterDiff.updatedAt.getTime() !== beforeDiff.updatedAt.getTime()
  ) {
    throw new Error('El producto con diferencias no quedó desactualizado o se alteró su espejo.');
  }

  const afterSecond = await prisma.product.findUniqueOrThrow({ where: { id: secondProduct.id } });
  if (
    afterSecond.syncStatus !== SyncStatus.SYNCED ||
    Number(afterSecond.siigoPriceCop) !== 200 ||
    Number(afterSecond.siigoPriceUsd) !== 20 ||
    afterSecond.siigoStock !== 8
  ) {
    throw new Error('El producto de la segunda página no se actualizó.');
  }

  if ((await prisma.product.count({ where: { sku: { startsWith: ghostPrefix } } })) !== 0) {
    throw new Error('El barrido creó productos que no existían en el CRM.');
  }
  if (
    (await prisma.notification.count({ where: { productId: { in: createdProductIds } } })) !== 0
  ) {
    throw new Error('El barrido creó notificaciones persistentes.');
  }

  const pageLogs = await waitForPageLogs();
  if (pageLogs.some((log) => log.responseBody !== null)) {
    throw new Error('El barrido volcó las páginas del catálogo al registro de integraciones.');
  }

  process.stdout.write(
    'Product refresh all smoke: auth, RBAC, pagination of 100, match by Siigo id, discarded products, sync status, warehouses, timestamps and log privacy checks passed.\n',
  );
} finally {
  // El puerto del Siigo simulado es único por corrida: borra también los logs de una aserción
  // fallida que no llegó a recolectar sus ids.
  await prisma.integrationLog.deleteMany({ where: { url: { startsWith: upstreamUrl } } });
  if (createdProductIds.length > 0) {
    await prisma.notification.deleteMany({ where: { productId: { in: createdProductIds } } });
    await prisma.product.deleteMany({ where: { id: { in: createdProductIds } } });
  }
  await prisma.productRefreshJob.deleteMany({ where: { requestedById: { in: [...userIds] } } });
  await prisma.integrationToken.deleteMany({ where: { provider: tokenProvider } });
  await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
  await app.close();
  await new Promise<void>((resolve, reject) =>
    upstream.close((error) => (error ? reject(error) : resolve())),
  );
}
