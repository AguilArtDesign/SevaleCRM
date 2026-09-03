import '../apps/api/src/config/load-environment.js';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword } from 'better-auth/crypto';
import { AppModule } from '../apps/api/src/app.module.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { Role, Store, SyncStatus } from '../apps/api/src/generated/prisma/client.js';

process.env.BETTER_AUTH_SECRET ||= 'local-products-smoke-secret-at-least-32-characters';

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
  logger: false,
});
app.setGlobalPrefix('api');
app.enableCors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
});
await app.listen(0, '127.0.0.1');

const prisma = app.get(PrismaService);
const origin = process.env.FRONTEND_URL || 'http://localhost:5173';
const baseUrl = await app.getUrl();
const runId = randomUUID();
const userId = randomUUID();
const email = `products-commercial-${runId}@example.invalid`;
const password = `S-${randomUUID()}-9a!`;
const productIds: number[] = [];

function expectStatus(response: Response, status: number, context: string) {
  if (response.status !== status) {
    throw new Error(`${context}: se esperaba ${status} y se recibió ${response.status}.`);
  }
}

async function api(path: string, cookie?: string) {
  return fetch(`${baseUrl}${path}`, {
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
    },
  });
}

try {
  const passwordHash = await hashPassword(password);
  await prisma.user.create({
    data: {
      id: userId,
      name: 'Products Smoke Commercial',
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
          password: passwordHash,
        },
      },
    },
  });

  const fixtures = [
    { store: Store.SERATUS, syncStatus: SyncStatus.SYNCED, name: 'Producto Alfa' },
    { store: Store.PALI, syncStatus: SyncStatus.PENDING, name: 'Producto Beta' },
    { store: Store.SERATUS, syncStatus: SyncStatus.ERROR, name: 'Producto Gamma' },
  ];
  for (const [index, fixture] of fixtures.entries()) {
    const product = await prisma.product.create({
      data: {
        siigoId: `smoke-${runId}-${index}`,
        sku: `S7-${runId}-${index}`,
        siigoPriceCop: 150000 + index,
        siigoPriceUsd: 40 + index,
        siigoStock: 8 + index,
        store: fixture.store,
        wooParentId: BigInt(9_000_000 + index),
        wooVariationId: BigInt(9_100_000 + index),
        wooSku: `W7-${runId}-${index}`,
        wooPriceCop: 155000 + index,
        wooPriceUsd: 42 + index,
        wooStock: 7 + index,
        syncStatus: fixture.syncStatus,
        lastCheckAt: new Date(),
        lastSyncAt: fixture.syncStatus === SyncStatus.SYNCED ? new Date() : null,
        productName: `${fixture.name} ${runId}`,
      },
    });
    productIds.push(product.id);
  }

  const anonymousList = await api('/api/products');
  expectStatus(anonymousList, 401, 'Listado anónimo');

  const loginResponse = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      'x-captcha-response': 'XXXX.DUMMY.TOKEN.XXXX',
    },
    body: JSON.stringify({ email, password }),
  });
  expectStatus(loginResponse, 200, 'Inicio de sesión comercial');
  const cookie = loginResponse.headers.getSetCookie()[0]?.split(';')[0];
  if (!cookie) throw new Error('Better Auth no creó la cookie de sesión.');

  const searchResponse = await api(
    `/api/products?search=${encodeURIComponent(`Producto Alfa ${runId}`)}&page=1&pageSize=20`,
    cookie,
  );
  expectStatus(searchResponse, 200, 'Búsqueda de producto');
  const searchBody = (await searchResponse.json()) as {
    data: Array<{ id: number; productName: string }>;
    pagination: { total: number };
  };
  if (searchBody.pagination.total !== 1 || searchBody.data[0]?.id !== productIds[0]) {
    throw new Error('La búsqueda no devolvió el producto esperado.');
  }

  const filteredResponse = await api(
    `/api/products?search=${encodeURIComponent(runId)}&store=SERATUS&syncStatus=ERROR`,
    cookie,
  );
  expectStatus(filteredResponse, 200, 'Filtros por tienda y estado');
  const filteredBody = (await filteredResponse.json()) as { data: Array<{ id: number }> };
  if (filteredBody.data.length !== 1 || filteredBody.data[0]?.id !== productIds[2]) {
    throw new Error('Los filtros no devolvieron el producto esperado.');
  }

  const pageResponse = await api(
    `/api/products?search=${encodeURIComponent(runId)}&page=2&pageSize=1`,
    cookie,
  );
  expectStatus(pageResponse, 200, 'Paginación');
  const pageBody = (await pageResponse.json()) as {
    data: unknown[];
    pagination: { page: number; total: number; totalPages: number };
  };
  if (
    pageBody.data.length !== 1 ||
    pageBody.pagination.page !== 2 ||
    pageBody.pagination.total !== 3 ||
    pageBody.pagination.totalPages !== 3
  ) {
    throw new Error('La paginación no devolvió los metadatos esperados.');
  }

  const detailResponse = await api(`/api/products/${productIds[0]}`, cookie);
  expectStatus(detailResponse, 200, 'Detalle de producto');
  const detail = (await detailResponse.json()) as {
    id: number;
    wooParentId: string | null;
    siigoPriceCop: number;
  };
  if (
    detail.id !== productIds[0] ||
    detail.wooParentId !== '9000000' ||
    typeof detail.siigoPriceCop !== 'number'
  ) {
    throw new Error('El detalle no serializó correctamente el producto.');
  }

  expectStatus(await api('/api/products?store=INVALID', cookie), 400, 'Filtro inválido');
  expectStatus(await api('/api/products/not-a-number', cookie), 400, 'Identificador inválido');
  expectStatus(await api('/api/products/2147483647', cookie), 404, 'Producto inexistente');

  process.stdout.write(
    'Products smoke: authentication, list, search, filters, pagination, detail, serialization and validation checks passed.\n',
  );
} finally {
  if (productIds.length > 0) {
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  }
  await prisma.user.deleteMany({ where: { id: userId } });
  await app.close();
}
