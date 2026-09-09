import { randomUUID } from 'node:crypto';
import '../apps/api/src/config/load-environment.js';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword } from 'better-auth/crypto';
import { AppModule } from '../apps/api/src/app.module.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { Role, Store, SyncStatus } from '../apps/api/src/generated/prisma/client.js';

process.env.BETTER_AUTH_SECRET ||= 'local-product-import-smoke-secret-at-least-32-characters';
process.env.PRODUCT_IMPORT_ENABLED = 'true';

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
  `import-admin-${runId}@example.invalid`,
  `import-commercial-${runId}@example.invalid`,
] as const;
const password = `I-${randomUUID()}-9a!`;
const existingSku = `IMPORT-EXISTING-${runId}`;
const newSku = `IMPORT-NEW-${runId}`;
const existingSiigoId = `siigo-${existingSku}`;
const newSiigoId = `siigo-${newSku}`;
const simpleSku = `IMPORT-SIMPLE-${runId}`;
const simpleSiigoId = `siigo-${simpleSku}`;
const productIds: number[] = [];

const headers = [
  'siigo_id',
  'sku',
  'siigo_price_cop',
  'siigo_price_usd',
  'siigo_stock',
  'store',
  'woo_parent_id',
  'woo_variation_id',
  'woo_sku',
  'woo_price_cop',
  'woo_price_usd',
  'woo_stock',
  'product_name',
  'image_url',
].join(',');

const row = ({
  siigoId,
  sku,
  store,
  variationId,
  parentId = 9000,
  wooStock = 27,
}: {
  siigoId: string;
  sku: string;
  store: Store;
  variationId: number;
  parentId?: number;
  wooStock?: number;
}) =>
  [
    siigoId,
    sku,
    '45000',
    '23',
    '27',
    store,
    String(parentId),
    String(variationId),
    sku,
    '45000',
    '23',
    String(wooStock),
    `"Producto importado, ${store}"`,
    `https://example.invalid/${sku}.webp`,
  ].join(',');

const csv = [
  headers,
  row({ siigoId: existingSiigoId, sku: existingSku, store: Store.PALI, variationId: 9001 }),
  row({
    siigoId: newSiigoId,
    sku: newSku,
    store: Store.SERATUS,
    variationId: 9002,
    wooStock: 20,
  }),
  row({
    siigoId: simpleSiigoId,
    sku: simpleSku,
    store: Store.PALI,
    parentId: 9010,
    variationId: 0,
  }),
].join('\r\n');

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

function api(path: string, method: 'GET' | 'POST', cookie?: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

try {
  const passwordHash = await hashPassword(password);
  for (const user of [
    { id: userIds[0], email: emails[0], role: Role.ADMIN, name: 'Import Smoke Admin' },
    {
      id: userIds[1],
      email: emails[1],
      role: Role.COMMERCIAL,
      name: 'Import Smoke Commercial',
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

  const existing = await prisma.product.create({
    data: {
      siigoId: existingSiigoId,
      sku: existingSku,
      siigoPriceCop: 45_000,
      siigoPriceUsd: 23,
      siigoStock: 27,
      store: Store.PALI,
      wooParentId: 9000n,
      wooVariationId: 9001n,
      wooSku: existingSku,
      wooPriceCop: 45_000,
      wooPriceUsd: 23,
      wooStock: 27,
      syncStatus: SyncStatus.SYNCED,
      productName: 'Producto existente',
    },
  });
  productIds.push(existing.id);

  expectStatus(await api('/api/products/import/status', 'GET'), 401, 'Estado anónimo');
  const adminCookie = await login(emails[0]);
  const commercialCookie = await login(emails[1]);
  expectStatus(
    await api('/api/products/import/status', 'GET', commercialCookie),
    403,
    'Estado comercial',
  );

  const statusResponse = await api('/api/products/import/status', 'GET', adminCookie);
  expectStatus(statusResponse, 200, 'Estado administrador');
  if (!((await statusResponse.json()) as { enabled: boolean }).enabled) {
    throw new Error('La API no informó que la importación está habilitada.');
  }

  const previewResponse = await api('/api/products/import/preview', 'POST', adminCookie, { csv });
  expectStatus(previewResponse, 201, 'Vista previa');
  const preview = (await previewResponse.json()) as {
    totalRows: number;
    newProducts: number;
    existingProducts: number;
    canImport: boolean;
  };
  if (
    preview.totalRows !== 3 ||
    preview.newProducts !== 2 ||
    preview.existingProducts !== 1 ||
    !preview.canImport
  ) {
    throw new Error('La vista previa no clasificó filas nuevas y existentes correctamente.');
  }

  const conflictCsv = [
    headers,
    row({
      siigoId: existingSiigoId,
      sku: `IMPORT-CONFLICT-${runId}`,
      store: Store.PALI,
      variationId: 9003,
    }),
  ].join('\n');
  const conflictResponse = await api('/api/products/import/preview', 'POST', adminCookie, {
    csv: conflictCsv,
  });
  expectStatus(conflictResponse, 201, 'Vista previa con conflicto');
  const conflict = (await conflictResponse.json()) as { conflictCount: number; canImport: boolean };
  if (conflict.conflictCount !== 1 || conflict.canImport) {
    throw new Error('La vista previa no bloqueó el conflicto con un producto existente.');
  }

  const importResponse = await api('/api/products/import', 'POST', adminCookie, { csv });
  expectStatus(importResponse, 201, 'Importación');
  const imported = (await importResponse.json()) as { imported: number; skipped: number };
  if (imported.imported !== 2 || imported.skipped !== 1) {
    throw new Error('La importación no devolvió el resumen esperado.');
  }
  const stored = await prisma.product.findUnique({ where: { sku: newSku } });
  if (
    !stored ||
    stored.store !== Store.SERATUS ||
    stored.syncStatus !== SyncStatus.OUT_OF_SYNC ||
    stored.lastCheckAt !== null ||
    stored.lastSyncAt !== null ||
    stored.productName !== 'Producto importado, SERATUS'
  ) {
    throw new Error('El producto importado no conservó el mapeo esperado.');
  }
  productIds.push(stored.id);

  const storedSimple = await prisma.product.findUnique({ where: { sku: simpleSku } });
  if (!storedSimple || storedSimple.wooParentId !== null || storedSimple.wooVariationId !== 9010n) {
    throw new Error('El producto simple no convirtió el cero en su identificador de WooCommerce.');
  }
  productIds.push(storedSimple.id);

  const repeatedResponse = await api('/api/products/import', 'POST', adminCookie, { csv });
  expectStatus(repeatedResponse, 201, 'Importación repetida');
  const repeated = (await repeatedResponse.json()) as { imported: number; skipped: number };
  if (repeated.imported !== 0 || repeated.skipped !== 3) {
    throw new Error('La segunda importación no fue idempotente.');
  }

  process.env.PRODUCT_IMPORT_ENABLED = 'false';
  expectStatus(
    await api('/api/products/import/preview', 'POST', adminCookie, { csv }),
    404,
    'Importación deshabilitada',
  );

  process.stdout.write(
    'Product import smoke: feature flag, auth, RBAC, CSV parsing, preview, conflicts, mapping, idempotency and disabled state checks passed.\n',
  );
} finally {
  process.env.PRODUCT_IMPORT_ENABLED = 'true';
  if (productIds.length > 0) {
    await prisma.notification.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  }
  await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
  await app.close();
}
