import '../apps/api/src/config/load-environment.js';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword } from 'better-auth/crypto';
import { AppModule } from '../apps/api/src/app.module.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { Role, Store, SyncStatus } from '../apps/api/src/generated/prisma/client.js';

process.env.BETTER_AUTH_SECRET ||= 'local-product-link-smoke-secret-at-least-32-characters';

const runId = randomUUID();
const tokenProvider = `SIIGO_LINK_${runId}`;
const externalRequests = new Map<string, number>();

function recordRequest(sku: string | null) {
  if (sku) externalRequests.set(sku, (externalRequests.get(sku) ?? 0) + 1);
}

function siigoProduct(sku: string) {
  return {
    id: `siigo-${sku}`,
    code: sku,
    name: `Producto ${sku}`,
    available_quantity: 12,
    prices: [
      { currency_code: 'COP', price_list: [{ name: 'PESOS', value: 87500 }] },
      { currency_code: 'USD', price_list: [{ name: 'DOLAR', value: 21.75 }] },
    ],
  };
}

function wooProduct(sku: string, store: 'seratus' | 'pali') {
  return {
    id: store === 'seratus' ? 8102 : 9102,
    parent_id: store === 'seratus' ? 8100 : 9100,
    sku,
    name: `Producto ${sku}`,
    price: '87500',
    stock_quantity: 12,
    image: { src: `https://example.invalid/${store}-${sku}.jpg` },
    meta_data: [{ key: '_regular_price_wmcp', value: '{"USD":"21.75"}' }],
  };
}

function send(request: IncomingMessage, response: ServerResponse, payload: unknown) {
  request.resume();
  response.writeHead(200, { 'content-type': 'application/json' });
  response.end(JSON.stringify(payload));
}

const upstream = createServer((request, response) => {
  const url = new URL(request.url ?? '/', 'http://127.0.0.1');
  const sku = url.searchParams.get(url.pathname.includes('/siigo/') ? 'code' : 'sku');
  recordRequest(sku);

  if (url.pathname === '/siigo/v1/products') {
    if (sku === 'LINK-NOSIIGO') return send(request, response, { results: [] });
    if (sku === 'LINK-MISMATCH') {
      return send(request, response, { results: [siigoProduct('OTHER-SKU')] });
    }
    return send(request, response, { results: sku ? [siigoProduct(sku)] : [] });
  }

  const store = url.pathname.includes('/seratus/') ? 'seratus' : 'pali';
  let products: unknown[] = [];
  if ((sku === 'LINK-OK' || sku?.startsWith('LINK-DUP-')) && store === 'pali') {
    products = [wooProduct(sku, store)];
  }
  if (sku === 'LINK-INCOMPLETE' && store === 'pali') {
    const product = wooProduct(sku, store);
    product.meta_data = [];
    products = [product];
  }
  if (sku === 'LINK-BOTH') products = [wooProduct(sku, store)];
  if (sku === 'LINK-WOO-MISMATCH' && store === 'seratus') {
    products = [wooProduct('OTHER-SKU', store)];
  }
  return send(request, response, products);
});

await new Promise<void>((resolve) => upstream.listen(0, '127.0.0.1', resolve));
const address = upstream.address();
if (!address || typeof address === 'string') throw new Error('No se inició el proveedor simulado.');
const upstreamUrl = `http://127.0.0.1:${address.port}`;

process.env.SIIGO_API_URL = `${upstreamUrl}/siigo/v1`;
process.env.SIIGO_USERNAME = 'link-smoke-user';
process.env.SIIGO_ACCESS_KEY = 'link-smoke-key';
process.env.SIIGO_PARTNER_ID = 'SevaleLinkSmoke';
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
const origin = process.env.FRONTEND_URL || 'http://localhost:5173';
const userIds = [randomUUID(), randomUUID()] as const;
const emails = [
  `link-admin-${runId}@example.invalid`,
  `link-commercial-${runId}@example.invalid`,
] as const;
const password = `S-${randomUUID()}-9a!`;
const createdProductIds: number[] = [];

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

try {
  await prisma.integrationToken.create({
    data: {
      provider: tokenProvider,
      accessToken: 'siigo-link-smoke-token',
      expiresAt: new Date(Date.now() + 3_600_000),
    },
  });
  const passwordHash = await hashPassword(password);
  const users = [
    { id: userIds[0], email: emails[0], role: Role.ADMIN, name: 'Link Smoke Admin' },
    {
      id: userIds[1],
      email: emails[1],
      role: Role.COMMERCIAL,
      name: 'Link Smoke Commercial',
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

  const duplicateSku = `LINK-DUP-${runId}`;
  const duplicate = await prisma.product.create({
    data: {
      siigoId: `siigo-${duplicateSku}`,
      sku: duplicateSku,
      siigoPriceCop: 1,
      siigoPriceUsd: 1,
      siigoStock: 1,
      store: Store.PALI,
      wooParentId: 1n,
      wooVariationId: 2n,
      wooSku: duplicateSku,
      wooPriceCop: 1,
      wooPriceUsd: 1,
      wooStock: 1,
      syncStatus: SyncStatus.SYNCED,
      productName: 'Producto duplicado',
    },
  });
  createdProductIds.push(duplicate.id);

  expectStatus(await api('/api/products/link-preview?sku=LINK-OK'), 401, 'Vista previa anónima');
  const adminCookie = await login(emails[0]);
  const commercialCookie = await login(emails[1]);

  const beforeDuplicate = externalRequests.get(duplicateSku) ?? 0;
  const duplicatePreviewResponse = await api(
    `/api/products/link-preview?sku=${encodeURIComponent(duplicateSku)}`,
    adminCookie,
  );
  expectStatus(duplicatePreviewResponse, 200, 'Vista previa de SKU ya vinculado');
  const duplicatePreview = (await duplicatePreviewResponse.json()) as {
    isLinked: boolean;
    canLink: boolean;
  };
  if (!duplicatePreview.isLinked || !duplicatePreview.canLink) {
    throw new Error('La vista previa no identificó el enlace existente actualizable.');
  }
  if ((externalRequests.get(duplicateSku) ?? 0) <= beforeDuplicate) {
    throw new Error('La vista previa del SKU vinculado no consultó los proveedores externos.');
  }

  expectStatus(
    await api('/api/products', commercialCookie, {
      method: 'PUT',
      body: JSON.stringify({ sku: duplicateSku }),
    }),
    403,
    'Actualización comercial',
  );

  const updateResponse = await api('/api/products', adminCookie, {
    method: 'PUT',
    body: JSON.stringify({ sku: duplicateSku }),
  });
  expectStatus(updateResponse, 200, 'Actualización administrativa');
  const updatedExisting = (await updateResponse.json()) as {
    id: number;
    sku: string;
    siigoPriceCop: number;
    wooVariationId: string;
  };
  if (
    updatedExisting.id !== duplicate.id ||
    updatedExisting.sku !== duplicateSku ||
    updatedExisting.siigoPriceCop !== 87500 ||
    updatedExisting.wooVariationId !== '9102'
  ) {
    throw new Error('La actualización no reemplazó los datos del enlace existente.');
  }

  expectStatus(
    await api('/api/products/link-preview?sku=LINK-NOSIIGO', adminCookie),
    404,
    'SKU inexistente en Siigo',
  );
  if ((externalRequests.get('LINK-NOSIIGO') ?? 0) !== 1) {
    throw new Error('Se consultaron las tiendas aunque el SKU no existe en Siigo.');
  }
  expectStatus(
    await api('/api/products/link-preview?sku=LINK-NOSTORE', adminCookie),
    404,
    'SKU inexistente en tiendas',
  );
  expectStatus(
    await api('/api/products/link-preview?sku=LINK-BOTH', adminCookie),
    409,
    'SKU presente en ambas tiendas',
  );
  expectStatus(
    await api('/api/products/link-preview?sku=LINK-MISMATCH', adminCookie),
    502,
    'SKU diferente devuelto por Siigo',
  );
  expectStatus(
    await api('/api/products/link-preview?sku=LINK-WOO-MISMATCH', adminCookie),
    502,
    'SKU diferente devuelto por WooCommerce',
  );

  const incompleteResponse = await api(
    '/api/products/link-preview?sku=LINK-INCOMPLETE',
    adminCookie,
  );
  expectStatus(incompleteResponse, 200, 'Vista previa incompleta');
  const incomplete = (await incompleteResponse.json()) as { canLink: boolean; issues: string[] };
  if (incomplete.canLink || !incomplete.issues.some((issue) => issue.includes('USD'))) {
    throw new Error('La vista previa no bloqueó los datos externos incompletos.');
  }
  expectStatus(
    await api('/api/products', adminCookie, {
      method: 'POST',
      body: JSON.stringify({ sku: 'LINK-INCOMPLETE' }),
    }),
    422,
    'Creación con datos incompletos',
  );

  const previewResponse = await api('/api/products/link-preview?sku=LINK-OK', commercialCookie);
  expectStatus(previewResponse, 200, 'Vista previa comercial');
  const preview = (await previewResponse.json()) as {
    sku: string;
    isLinked: boolean;
    store: { store: string; variationId: string };
    syncStatus: string;
    canLink: boolean;
  };
  if (
    preview.sku !== 'LINK-OK' ||
    preview.isLinked ||
    preview.store.store !== 'PALI' ||
    preview.store.variationId !== '9102' ||
    preview.syncStatus !== 'SYNCED' ||
    !preview.canLink
  ) {
    throw new Error('La vista previa normalizada no contiene los valores esperados.');
  }

  expectStatus(
    await api('/api/products', commercialCookie, {
      method: 'POST',
      body: JSON.stringify({ sku: 'LINK-OK' }),
    }),
    403,
    'Creación comercial',
  );

  const createResponse = await api('/api/products', adminCookie, {
    method: 'POST',
    body: JSON.stringify({ sku: 'LINK-OK' }),
  });
  expectStatus(createResponse, 201, 'Creación administrativa');
  const created = (await createResponse.json()) as {
    id: number;
    sku: string;
    store: string;
    wooParentId: string;
    wooVariationId: string;
    lastSyncAt: null;
  };
  createdProductIds.push(created.id);
  if ((await prisma.notification.count({ where: { productId: created.id } })) !== 1) {
    throw new Error('La vinculación no creó su notificación persistente.');
  }
  if (
    created.sku !== 'LINK-OK' ||
    created.store !== 'PALI' ||
    created.wooParentId !== '9100' ||
    created.wooVariationId !== '9102' ||
    created.lastSyncAt !== null
  ) {
    throw new Error('El producto vinculado no se guardó con datos normalizados.');
  }
  const stored = await prisma.product.findUnique({ where: { id: created.id } });
  if (!stored || stored.siigoId !== 'siigo-LINK-OK' || stored.wooSku !== 'LINK-OK') {
    throw new Error('La base de datos no contiene el enlace normalizado esperado.');
  }

  const requestsBeforeConflict = externalRequests.get('LINK-OK') ?? 0;
  expectStatus(
    await api('/api/products', adminCookie, {
      method: 'POST',
      body: JSON.stringify({ sku: 'LINK-OK' }),
    }),
    409,
    'Creación duplicada',
  );
  if ((externalRequests.get('LINK-OK') ?? 0) !== requestsBeforeConflict) {
    throw new Error(
      'La segunda creación consultó proveedores pese a que el SKU ya estaba vinculado.',
    );
  }

  if ([...externalRequests.keys()].some((sku) => sku.includes('private'))) {
    throw new Error('La prueba detectó datos externos no normalizados.');
  }

  process.stdout.write(
    'Product link smoke: auth, RBAC, linked-product refresh, early duplicate creation stop, three-source validation, mismatches, normalized preview and safe creation checks passed.\n',
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
