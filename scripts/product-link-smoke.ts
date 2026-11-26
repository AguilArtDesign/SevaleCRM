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

let warehouseVersion = 0;

/** Cambia la distribución entre la creación y el refresco para probar que se consulta Siigo. */
function siigoWarehouses() {
  return warehouseVersion === 0
    ? [
        { id: -1, name: 'Sin asignar', quantity: 2 },
        { id: 177, name: 'PALI', quantity: 2 },
        { id: 178, name: 'SERATUS', quantity: 5 },
        { id: 185, name: 'SERATUS BOGOTA PORTAL 80', quantity: 3 },
        { id: 999, name: 'VACIA', quantity: 0 },
      ]
    : [
        { id: -1, name: 'Sin asignar', quantity: 1 },
        { id: 177, name: 'PALI', quantity: 1 },
        { id: 178, name: 'SERATUS', quantity: 7 },
        { id: 185, name: 'SERATUS BOGOTA PORTAL 80', quantity: 3 },
      ];
}

function siigoProduct(sku: string) {
  // Un proveedor puede separar un grupo por moneda en lugar de mezclar las listas en el de pesos:
  // el segundo formato cubre ese caso, sin nombres ISO en las listas.
  const separated = sku.startsWith('LINK-GROUPS-');
  return {
    id: `siigo-${sku}`,
    code: sku,
    name: `Producto ${sku}`,
    available_quantity: 12,
    warehouses: siigoWarehouses(),
    // Forma real de Siigo: todas las listas conviven en el grupo de pesos y cada una se llama por
    // su código ISO o por un nombre propio. Era el caso que dejaba MXN y EUR en «sin dato».
    prices: separated
      ? [
          { currency_code: 'COP', price_list: [{ position: 1, name: 'PESOS', value: 87500 }] },
          { currency_code: 'USD', price_list: [{ position: 1, name: 'DOLAR', value: 21.75 }] },
          {
            currency_code: 'MXN',
            price_list: [{ position: 1, name: 'PRECIO MEXICO', value: 847 }],
          },
          { currency_code: 'EUR', price_list: [{ position: 1, name: 'PRECIO EUROPA', value: 45 }] },
        ]
      : [
          {
            currency_code: 'COP',
            price_list: [
              { position: 1, name: 'PESOS', value: 87500 },
              { position: 2, name: 'DOLAR', value: 21.75 },
              { position: 3, name: 'MAYORISTA', value: 70000 },
              { position: 4, name: 'EUR', value: 45 },
              { position: 5, name: 'MXN', value: 847 },
            ],
          },
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
    meta_data: [
      {
        key: 'yay_currency_custom_fixed_prices',
        value: {
          USD: { regular_price: '21.75', sale_price: '', price: '21.75' },
          MXN: { regular_price: '847', sale_price: '', price: '847' },
          EUR: { regular_price: '45', sale_price: '', price: '45' },
        },
      },
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
  if (
    (sku === 'LINK-OK' ||
      sku === 'LINK-CAFÉ' ||
      sku?.startsWith('LINK-DUP-') ||
      sku?.startsWith('LINK-GROUPS-')) &&
    store === 'pali'
  ) {
    const product = wooProduct(sku, store);
    if (sku?.startsWith('LINK-DUP-')) product.stock_quantity = 11;
    products = [product];
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
    syncStatus: string;
    siigoWarehouses: { id: number; name: string; quantity: number }[] | null;
    siigoWarehousesUpdatedAt: string | null;
  };
  if (
    updatedExisting.id !== duplicate.id ||
    updatedExisting.sku !== duplicateSku ||
    updatedExisting.siigoPriceCop !== 87500 ||
    updatedExisting.wooVariationId !== '9102' ||
    updatedExisting.syncStatus !== 'OUT_OF_SYNC' ||
    updatedExisting.siigoWarehouses?.length !== 3 ||
    updatedExisting.siigoWarehouses[0]?.id !== -1 ||
    updatedExisting.siigoWarehouses[0]?.name !== 'Sin asignar' ||
    updatedExisting.siigoWarehouses[0]?.quantity !== 2 ||
    updatedExisting.siigoWarehouses[1]?.id !== 178 ||
    updatedExisting.siigoWarehouses[1]?.name !== 'Bodega' ||
    updatedExisting.siigoWarehouses[1]?.quantity !== 7 ||
    updatedExisting.siigoWarehouses[2]?.id !== 185 ||
    updatedExisting.siigoWarehouses[2]?.name !== 'Portal 80' ||
    !updatedExisting.siigoWarehousesUpdatedAt
  ) {
    throw new Error('La actualización no reemplazó los datos del enlace existente.');
  }
  const linkUpdateNotifications = await prisma.notification.findMany({
    where: { productId: duplicate.id },
  });
  if (
    linkUpdateNotifications.length !== 1 ||
    linkUpdateNotifications[0]?.type !== 'PRODUCT_LINK_UPDATED' ||
    linkUpdateNotifications[0].title !== 'Producto actualizado' ||
    linkUpdateNotifications[0].message !==
      `Producto ${duplicateSku}\nStock 1 ➝ 12\nPrecio COP $1 ➝ $87.500\nPrecio USD $1 ➝ $21,75\nPrecio MXN sin dato ➝ $847\nPrecio EUR sin dato ➝ $45\nEstado Sincronizado ➝ Desactualizado`
  ) {
    throw new Error('La actualización del enlace no creó una única notificación consolidada.');
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
    siigo: { warehouses: { id: number; name: string; quantity: number }[] | null };
  };
  if (
    preview.sku !== 'LINK-OK' ||
    preview.isLinked ||
    preview.store.store !== 'PALI' ||
    preview.store.variationId !== '9102' ||
    preview.syncStatus !== 'SYNCED' ||
    !preview.canLink ||
    preview.siigo.warehouses?.length !== 4 ||
    preview.siigo.warehouses[0]?.id !== -1 ||
    preview.siigo.warehouses[0]?.quantity !== 2 ||
    preview.siigo.warehouses[1]?.id !== 177 ||
    preview.siigo.warehouses[1]?.quantity !== 2 ||
    preview.siigo.warehouses[2]?.id !== 178 ||
    preview.siigo.warehouses[2]?.quantity !== 5 ||
    preview.siigo.warehouses[3]?.id !== 185
  ) {
    throw new Error('La vista previa normalizada no contiene los valores esperados.');
  }

  const unicodePreviewResponse = await api(
    `/api/products/link-preview?sku=${encodeURIComponent('LINK-CAFE\u0301')}`,
    commercialCookie,
  );
  expectStatus(unicodePreviewResponse, 200, 'Vista previa con SKU acentuado');
  const unicodePreview = (await unicodePreviewResponse.json()) as { sku: string; canLink: boolean };
  if (unicodePreview.sku !== 'LINK-CAFÉ' || !unicodePreview.canLink) {
    throw new Error('El SKU acentuado no se normalizó a Unicode NFC.');
  }
  expectStatus(
    await api(
      `/api/products/link-preview?sku=${encodeURIComponent('LINK CON ESPACIO')}`,
      adminCookie,
    ),
    400,
    'SKU con espacios',
  );
  for (const [invalidSku, context] of [
    ['LINK.CON.PUNTOS', 'SKU con puntos'],
    ['LINK-CAÑE', 'SKU con eñe'],
    ['LINK-А', 'SKU con alfabeto no latino'],
  ] as const) {
    expectStatus(
      await api(`/api/products/link-preview?sku=${encodeURIComponent(invalidSku)}`, adminCookie),
      400,
      context,
    );
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
    siigoWarehouses: { id: number; name: string; quantity: number }[] | null;
    siigoWarehousesUpdatedAt: string | null;
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
    created.lastSyncAt !== null ||
    created.siigoWarehouses?.length !== 3 ||
    created.siigoWarehouses[0]?.id !== -1 ||
    created.siigoWarehouses[0]?.name !== 'Sin asignar' ||
    created.siigoWarehouses[0]?.quantity !== 2 ||
    created.siigoWarehouses[1]?.id !== 178 ||
    created.siigoWarehouses[1]?.name !== 'Bodega' ||
    created.siigoWarehouses[1]?.quantity !== 7 ||
    created.siigoWarehouses[2]?.id !== 185 ||
    created.siigoWarehouses[2]?.name !== 'Portal 80' ||
    !created.siigoWarehousesUpdatedAt
  ) {
    throw new Error('El producto vinculado no se guardó con datos normalizados.');
  }
  const stored = await prisma.product.findUnique({ where: { id: created.id } });
  if (!stored || stored.siigoId !== 'siigo-LINK-OK' || stored.wooSku !== 'LINK-OK') {
    throw new Error('La base de datos no contiene el enlace normalizado esperado.');
  }
  // Las monedas nuevas se leen de Siigo por código de moneda y del meta serializado de la tienda.
  if (
    Number(stored.siigoPriceMxn) !== 847 ||
    Number(stored.siigoPriceEur) !== 45 ||
    Number(stored.wooPriceMxn) !== 847 ||
    Number(stored.wooPriceEur) !== 45
  ) {
    throw new Error('El enlace no guardó los precios MXN y EUR de Siigo y WooCommerce.');
  }
  const storedWarehouses = stored.siigoWarehouses as
    | {
        id: number;
        name: string;
        quantity: number;
      }[]
    | null;
  if (
    !Array.isArray(storedWarehouses) ||
    storedWarehouses.length !== 4 ||
    storedWarehouses[0]?.id !== -1 ||
    storedWarehouses[0]?.quantity !== 2 ||
    storedWarehouses[1]?.id !== 177 ||
    storedWarehouses[1]?.quantity !== 2 ||
    storedWarehouses[2]?.id !== 178 ||
    storedWarehouses[2]?.quantity !== 5 ||
    storedWarehouses[3]?.id !== 185 ||
    !stored.siigoWarehousesUpdatedAt
  ) {
    throw new Error('El enlace no guardó el snapshot de bodegas.');
  }

  const beforeCached = await prisma.product.findUniqueOrThrow({ where: { id: created.id } });
  expectStatus(
    await api(`/api/products/${created.id}/warehouses/refresh`, undefined, { method: 'POST' }),
    401,
    'Carga de bodegas anónima',
  );
  warehouseVersion = 1;
  const requestsBeforeCached = externalRequests.get('LINK-OK') ?? 0;
  const cachedResponse = await api(
    `/api/products/${created.id}/warehouses/refresh`,
    commercialCookie,
    { method: 'POST' },
  );
  expectStatus(cachedResponse, 200, 'Carga de bodegas con snapshot existente');
  const cached = (await cachedResponse.json()) as {
    success: boolean;
    productId: number;
    warehouses: { id: number; name: string; quantity: number }[];
    updatedAt: string;
  };
  if (
    !cached.success ||
    cached.productId !== created.id ||
    cached.warehouses.length !== 3 ||
    cached.warehouses[0]?.quantity !== 2 ||
    cached.warehouses[1]?.quantity !== 7 ||
    cached.warehouses[2]?.quantity !== 3 ||
    !cached.updatedAt
  ) {
    throw new Error('La carga no devolvió el snapshot guardado del producto.');
  }
  if ((externalRequests.get('LINK-OK') ?? 0) !== requestsBeforeCached) {
    throw new Error('Se consultó Siigo aunque el producto ya tenía el snapshot guardado.');
  }
  const afterCached = await prisma.product.findUniqueOrThrow({ where: { id: created.id } });
  if (afterCached.updatedAt.getTime() !== beforeCached.updatedAt.getTime()) {
    throw new Error('Consultar el snapshot guardado modificó updatedAt.');
  }

  // Un producto que nunca cargó bodegas: la primera consulta va a Siigo y queda persistida.
  const firstLoadSku = `LINK-FIRST-${runId}`;
  const firstLoadProduct = await prisma.product.create({
    data: {
      siigoId: `siigo-${firstLoadSku}`,
      sku: firstLoadSku,
      siigoPriceCop: 87500,
      siigoPriceUsd: 21.75,
      siigoStock: 12,
      store: Store.PALI,
      wooParentId: 9100n,
      wooVariationId: 9102n,
      wooSku: firstLoadSku,
      wooPriceCop: 87500,
      wooPriceUsd: 21.75,
      wooStock: 12,
      syncStatus: SyncStatus.SYNCED,
      productName: `Producto ${firstLoadSku}`,
    },
  });
  createdProductIds.push(firstLoadProduct.id);

  const beforeFirstLoad = await prisma.product.findUniqueOrThrow({
    where: { id: firstLoadProduct.id },
  });
  const requestsBeforeFirstLoad = externalRequests.get(firstLoadSku) ?? 0;
  const firstLoadResponse = await api(
    `/api/products/${firstLoadProduct.id}/warehouses/refresh`,
    commercialCookie,
    { method: 'POST' },
  );
  expectStatus(firstLoadResponse, 200, 'Primera carga de bodegas');
  const firstLoad = (await firstLoadResponse.json()) as {
    success: boolean;
    productId: number;
    warehouses: { id: number; name: string; quantity: number }[];
    updatedAt: string;
  };
  if (
    !firstLoad.success ||
    firstLoad.productId !== firstLoadProduct.id ||
    firstLoad.warehouses.length !== 3 ||
    firstLoad.warehouses[0]?.id !== -1 ||
    firstLoad.warehouses[0]?.name !== 'Sin asignar' ||
    firstLoad.warehouses[0]?.quantity !== 1 ||
    firstLoad.warehouses[1]?.id !== 178 ||
    firstLoad.warehouses[1]?.name !== 'Bodega' ||
    firstLoad.warehouses[1]?.quantity !== 8 ||
    firstLoad.warehouses[2]?.id !== 185 ||
    firstLoad.warehouses[2]?.name !== 'Portal 80' ||
    !firstLoad.updatedAt
  ) {
    throw new Error('La primera carga no devolvió el desglose de Siigo.');
  }
  if ((externalRequests.get(firstLoadSku) ?? 0) <= requestsBeforeFirstLoad) {
    throw new Error('La primera carga de bodegas no consultó Siigo.');
  }
  const afterFirstLoad = await prisma.product.findUniqueOrThrow({
    where: { id: firstLoadProduct.id },
  });
  const afterFirstLoadWarehouses = afterFirstLoad.siigoWarehouses as
    | {
        id: number;
        quantity: number;
      }[]
    | null;
  if (
    !Array.isArray(afterFirstLoadWarehouses) ||
    afterFirstLoadWarehouses.length !== 4 ||
    afterFirstLoadWarehouses[0]?.quantity !== 1 ||
    afterFirstLoadWarehouses[1]?.quantity !== 1 ||
    afterFirstLoadWarehouses[2]?.quantity !== 7 ||
    afterFirstLoadWarehouses[3]?.quantity !== 3 ||
    afterFirstLoad.siigoStock !== beforeFirstLoad.siigoStock ||
    afterFirstLoad.syncStatus !== beforeFirstLoad.syncStatus ||
    afterFirstLoad.lastCheckAt?.getTime() !== beforeFirstLoad.lastCheckAt?.getTime() ||
    afterFirstLoad.lastSyncAt?.getTime() !== beforeFirstLoad.lastSyncAt?.getTime() ||
    afterFirstLoad.updatedAt.getTime() !== beforeFirstLoad.updatedAt.getTime() ||
    !afterFirstLoad.siigoWarehousesUpdatedAt
  ) {
    throw new Error('La primera carga alteró datos fuera del snapshot de bodegas.');
  }

  // Ya persistido: una segunda apertura no debe volver a Siigo, aunque el proveedor cambie.
  warehouseVersion = 0;
  const requestsBeforeSecondLoad = externalRequests.get(firstLoadSku) ?? 0;
  const secondLoadResponse = await api(
    `/api/products/${firstLoadProduct.id}/warehouses/refresh`,
    commercialCookie,
    { method: 'POST' },
  );
  expectStatus(secondLoadResponse, 200, 'Segunda carga de bodegas');
  const secondLoad = (await secondLoadResponse.json()) as {
    productId: number;
    warehouses: { id: number; quantity: number }[];
  };
  if (
    secondLoad.productId !== firstLoadProduct.id ||
    secondLoad.warehouses.length !== 3 ||
    secondLoad.warehouses[0]?.quantity !== 1 ||
    secondLoad.warehouses[1]?.quantity !== 8
  ) {
    throw new Error('La segunda carga no devolvió el snapshot persistido.');
  }
  if ((externalRequests.get(firstLoadSku) ?? 0) !== requestsBeforeSecondLoad) {
    throw new Error('La segunda carga volvió a consultar Siigo.');
  }

  // El otro formato de Siigo: un grupo de precio por moneda, con nombres que no son el código ISO.
  const groupedResponse = await api('/api/products/link-preview?sku=LINK-GROUPS-1', adminCookie);
  expectStatus(groupedResponse, 200, 'Vista previa con grupos por moneda');
  const grouped = (await groupedResponse.json()) as {
    siigo: {
      priceCop: number | null;
      priceUsd: number | null;
      priceMxn: number | null;
      priceEur: number | null;
    };
  };
  if (
    grouped.siigo.priceCop !== 87500 ||
    grouped.siigo.priceUsd !== 21.75 ||
    grouped.siigo.priceMxn !== 847 ||
    grouped.siigo.priceEur !== 45
  ) {
    throw new Error('Las monedas no se resolvieron cuando Siigo separa un grupo por moneda.');
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
    'Product link smoke: auth, RBAC, linked-product refresh, early duplicate creation stop, three-source validation, mismatches, per-currency price resolution in both Siigo shapes, normalized preview and safe creation checks passed.\n',
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
