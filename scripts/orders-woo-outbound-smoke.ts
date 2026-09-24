import '../apps/api/src/config/load-environment.js';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword } from 'better-auth/crypto';
import { AppModule } from '../apps/api/src/app.module.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { Role, Store } from '../apps/api/src/generated/prisma/client.js';

process.env.BETTER_AUTH_SECRET ||= 'local-orders-outbound-secret-at-least-32-characters';

type CapturedOrder = Record<string, unknown> & { id: number; status: string };
const created = new Map<string, CapturedOrder[]>();
const posts = new Map<string, number>();
let paliUncertainFailure = true;
let paliShipmentFailures = 2;

function storeFrom(request: IncomingMessage): 'SERATUS' | 'PALI' {
  return request.headers['x-test-store'] === 'pali' ? 'PALI' : 'SERATUS';
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let content = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => {
      content += chunk;
    });
    request.on('end', () => {
      try {
        resolve(JSON.parse(content) as Record<string, unknown>);
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Invalid JSON'));
      }
    });
    request.on('error', reject);
  });
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

async function handleWooRequest(request: IncomingMessage, response: ServerResponse) {
  const url = new URL(request.url ?? '/', 'http://localhost');
  const store = storeFrom(request);
  const orderPath = url.pathname.match(/\/orders\/(\d+)$/);
  if (request.method === 'PUT' && orderPath) {
    if (store === 'PALI' && paliShipmentFailures > 0) {
      paliShipmentFailures -= 1;
      return json(response, 502, { message: 'Simulated shipment failure' });
    }
    const orders = created.get(store) ?? [];
    const order = orders.find(({ id }) => id === Number(orderPath[1]));
    if (!order) return json(response, 404, { message: 'Order not found' });
    const payload = await body(request);
    const currentMetadata = Array.isArray(order.meta_data)
      ? (order.meta_data as Array<Record<string, unknown>>)
      : [];
    const incomingMetadata = Array.isArray(payload.meta_data)
      ? (payload.meta_data as Array<Record<string, unknown>>)
      : [];
    const mergedMetadata = new Map(
      currentMetadata.map((item) => [String(item.key), item] as const),
    );
    for (const item of incomingMetadata) mergedMetadata.set(String(item.key), item);
    order.meta_data = [...mergedMetadata.values()];
    order.date_modified = '2026-09-17T17:00:00-05:00';
    return json(response, 200, order);
  }
  if (!url.pathname.endsWith('/orders')) return json(response, 404, { message: 'Not found' });
  if (request.method === 'GET') return json(response, 200, created.get(store) ?? []);
  if (request.method !== 'POST') return json(response, 405, { message: 'Method not allowed' });
  const payload = await body(request);
  posts.set(store, (posts.get(store) ?? 0) + 1);
  const order: CapturedOrder = {
    ...payload,
    id: store === 'SERATUS' ? 97001 : 98001,
    // WooCommerce respeta el estado recibido al crear el pedido y lo devuelve en la respuesta.
    status: typeof payload.status === 'string' ? payload.status : 'processing',
    date_created: '2026-09-17T16:00:00-05:00',
    date_modified: '2026-09-17T16:00:00-05:00',
  };
  created.set(store, [...(created.get(store) ?? []), order]);
  if (store === 'PALI' && paliUncertainFailure) {
    paliUncertainFailure = false;
    return json(response, 502, { message: 'Simulated response loss' });
  }
  return json(response, 201, order);
}

const wooServer = createServer((request, response) => {
  void handleWooRequest(request, response).catch(() => {
    json(response, 500, { message: 'Mock failure' });
  });
});
await new Promise<void>((resolve) => wooServer.listen(0, '127.0.0.1', resolve));
const address = wooServer.address();
if (!address || typeof address === 'string')
  throw new Error('No se inició el servidor Woo simulado.');
const wooUrl = `http://127.0.0.1:${address.port}/wp-json/wc/v3`;

const previousEnvironment = {
  SERATUS_API_URL: process.env.SERATUS_API_URL,
  PALI_API_URL: process.env.PALI_API_URL,
  WOOCOMMERCE_SERATUS_CK: process.env.WOOCOMMERCE_SERATUS_CK,
  WOOCOMMERCE_SERATUS_CS: process.env.WOOCOMMERCE_SERATUS_CS,
  WOOCOMMERCE_PALI_CK: process.env.WOOCOMMERCE_PALI_CK,
  WOOCOMMERCE_PALI_CS: process.env.WOOCOMMERCE_PALI_CS,
};
process.env.SERATUS_API_URL = wooUrl;
process.env.PALI_API_URL = wooUrl;
process.env.WOOCOMMERCE_SERATUS_CK = 'seratus-key';
process.env.WOOCOMMERCE_SERATUS_CS = 'seratus-secret';
process.env.WOOCOMMERCE_PALI_CK = 'pali-key';
process.env.WOOCOMMERCE_PALI_CS = 'pali-secret';

// The mock distinguishes stores without exposing credentials in application logs.
const originalFetch = globalThis.fetch;
globalThis.fetch = (input, init) => {
  const authorization = new Headers(init?.headers).get('authorization') ?? '';
  const headers = new Headers(init?.headers);
  if (authorization === `Basic ${Buffer.from('pali-key:pali-secret').toString('base64')}`) {
    headers.set('x-test-store', 'pali');
  }
  return originalFetch(input, { ...init, headers });
};

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
  logger: false,
});
app.setGlobalPrefix('api');
const origin = process.env.FRONTEND_URL || 'http://localhost:5173';
app.enableCors({ origin, credentials: true });
await app.listen(0, '127.0.0.1');
const prisma = app.get(PrismaService);
const baseUrl = await app.getUrl();
const runId = randomUUID();
const password = `O-${randomUUID()}-9a!`;
const userIds: string[] = [];
const productIds: number[] = [];
let customerId: number | null = null;
let operationId: number | null = null;

function expectStatus(response: Response, status: number, context: string) {
  if (response.status !== status) {
    throw new Error(`${context}: se esperaba ${status}, se recibió ${response.status}.`);
  }
}

async function createUser(role: Role) {
  const id = randomUUID();
  const email = `outbound-${role.toLowerCase()}-${runId}@example.invalid`;
  userIds.push(id);
  await prisma.user.create({
    data: {
      id,
      name: `Outbound ${role}`,
      email,
      emailVerified: true,
      role,
      active: true,
      accounts: {
        create: {
          id: randomUUID(),
          accountId: id,
          providerId: 'credential',
          issuer: 'local:credential',
          password: await hashPassword(password),
        },
      },
    },
  });
  const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      'x-captcha-response': 'XXXX.DUMMY.TOKEN.XXXX',
    },
    body: JSON.stringify({ email, password }),
  });
  expectStatus(response, 200, `Inicio de sesión ${role}`);
  const cookie = response.headers.getSetCookie()[0]?.split(';')[0];
  if (!cookie) throw new Error('No se creó la sesión de prueba.');
  return cookie;
}

function api(path: string, cookie: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      origin,
      cookie,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
}

try {
  const [commercialCookie, logisticsCookie] = await Promise.all([
    createUser(Role.COMMERCIAL),
    createUser(Role.LOGISTICS),
  ]);
  const customer = await prisma.customer.create({
    data: {
      personType: 'PERSON',
      firstName: 'Cliente',
      lastName: 'Outbound',
      displayName: `Cliente Outbound ${runId}`,
      documentType: '13',
      documentNumber: String(Date.now()),
      email: `outbound-${runId}@example.invalid`,
      fiscalResponsibilities: ['R-99-PN'],
      integrations: {
        create: [
          { provider: 'SERATUS', externalId: '501', status: 'SYNCED' },
          { provider: 'PALI', externalId: '601', status: 'SYNCED' },
          { provider: 'SIIGO', status: 'PENDING' },
        ],
      },
    },
  });
  customerId = customer.id;
  const seratus = await prisma.product.create({
    data: {
      siigoId: `siigo-outbound-s-${runId}`,
      sku: `OUT-S-${runId}`,
      productName: 'Producto Seratus outbound',
      store: Store.SERATUS,
      siigoPriceCop: 100000,
      siigoPriceUsd: 25,
      siigoStock: 10,
      wooParentId: 7000n,
      wooVariationId: 7001n,
      wooSku: `OUT-S-${runId}`,
      wooPriceCop: 100000,
      wooPriceUsd: 25,
      wooStock: 10,
      syncStatus: 'SYNCED',
    },
  });
  const pali = await prisma.product.create({
    data: {
      siigoId: `siigo-outbound-p-${runId}`,
      sku: `OUT-P-${runId}`,
      productName: 'Producto Pali outbound',
      store: Store.PALI,
      siigoPriceCop: 80000,
      siigoPriceUsd: 20,
      siigoStock: 10,
      wooParentId: null,
      wooVariationId: 8001n,
      wooSku: `OUT-P-${runId}`,
      wooPriceCop: 80000,
      wooPriceUsd: 20,
      wooStock: 10,
      syncStatus: 'SYNCED',
    },
  });
  productIds.push(seratus.id, pali.id);
  const addressSnapshot = {
    firstName: 'Cliente',
    lastName: 'Outbound',
    company: null,
    address1: 'CRA 1 # 2-3',
    address2: null,
    city: 'Medellín',
    state: 'ANT',
    postcode: '050001',
    country: 'CO',
    phone: '+573001234567',
  };
  const createResponse = await api('/api/orders', commercialCookie, {
    method: 'POST',
    body: JSON.stringify({
      customerId: customer.id,
      currency: 'COP',
      paymentMethod: 'cod',
      shippingMethod: 'free_shipping',
      customShippingTotal: null,
      couponId: null,
      billing: { ...addressSnapshot, email: customer.email },
      shipping: addressSnapshot,
      items: [
        { productId: seratus.id, quantity: 2, unitPrice: '95000' },
        { productId: pali.id, quantity: 1 },
      ],
    }),
  });
  expectStatus(createResponse, 201, 'Crear operación');
  const local = (await createResponse.json()) as { id: number };
  operationId = local.id;

  expectStatus(
    await api(`/api/orders/${local.id}/complete`, logisticsCookie, { method: 'POST' }),
    403,
    'Completar como logística',
  );
  const completeResponse = await api(`/api/orders/${local.id}/complete`, commercialCookie, {
    method: 'POST',
  });
  expectStatus(completeResponse, 201, 'Completar operación');
  const completed = (await completeResponse.json()) as {
    status: string;
    orders: Array<{ id: number; store: string; syncStatus: string; wooOrderId: string | null }>;
  };
  if (
    completed.status !== 'COMPLETED' ||
    completed.orders.find(({ store }) => store === 'SERATUS')?.syncStatus !== 'SYNCED' ||
    completed.orders.find(({ store }) => store === 'PALI')?.syncStatus !== 'ERROR'
  ) {
    throw new Error('La finalización no conservó correctamente el resultado parcial por tienda.');
  }
  if (posts.get('SERATUS') !== 1 || posts.get('PALI') !== 1) {
    throw new Error('La finalización no creó exactamente un pedido por tienda.');
  }

  expectStatus(
    await api(`/api/orders/${local.id}/complete`, commercialCookie, { method: 'POST' }),
    201,
    'Doble complete idempotente',
  );
  if (posts.get('SERATUS') !== 1 || posts.get('PALI') !== 1) {
    throw new Error('El doble complete volvió a crear pedidos WooCommerce.');
  }

  const paliOrderId = completed.orders.find(({ store }) => store === 'PALI')?.id;
  if (!paliOrderId) throw new Error('No se encontró la fila local de Pali para reintentarla.');
  const retryResponse = await api(`/api/orders/rows/${paliOrderId}/sync`, commercialCookie, {
    method: 'POST',
  });
  expectStatus(retryResponse, 201, 'Reintentar sincronización por fila');
  const retried = (await retryResponse.json()) as {
    orders: Array<{ store: string; syncStatus: string; wooOrderId: string | null }>;
  };
  if (
    retried.orders.some(({ syncStatus }) => syncStatus !== 'SYNCED') ||
    retried.orders.find(({ store }) => store === 'PALI')?.wooOrderId !== '98001' ||
    posts.get('PALI') !== 1
  ) {
    throw new Error('El retry no recuperó de forma idempotente el pedido creado en Pali.');
  }

  const shipmentResponse = await api(`/api/orders/${local.id}/shipment`, commercialCookie, {
    method: 'PUT',
    body: JSON.stringify({
      carrier: 'Coordinadora',
      trackingNumber: `TRACK-${runId}`,
      status: 'En tránsito',
      note: 'Recibido por la transportadora.',
    }),
  });
  expectStatus(shipmentResponse, 200, 'Actualizar envío');
  const shipmentPartial = (await shipmentResponse.json()) as {
    shipment: { storeSyncs: Array<{ store: string; syncStatus: string }> };
  };
  if (
    shipmentPartial.shipment.storeSyncs.find(({ store }) => store === 'SERATUS')?.syncStatus !==
      'SYNCED' ||
    shipmentPartial.shipment.storeSyncs.find(({ store }) => store === 'PALI')?.syncStatus !==
      'ERROR'
  ) {
    throw new Error(
      `La actualización de envío no conservó el resultado parcial por tienda: ${JSON.stringify(shipmentPartial.shipment.storeSyncs)}`,
    );
  }
  const shipmentRetryResponse = await api(
    `/api/orders/${local.id}/shipment/sync`,
    commercialCookie,
    { method: 'POST' },
  );
  expectStatus(shipmentRetryResponse, 201, 'Reintentar envío');
  const shipmentRetried = (await shipmentRetryResponse.json()) as {
    shipment: { storeSyncs: Array<{ syncStatus: string }> };
  };
  if (shipmentRetried.shipment.storeSyncs.some(({ syncStatus }) => syncStatus !== 'SYNCED')) {
    throw new Error('El retry de envío no sincronizó las dos tiendas.');
  }

  const seratusPayload = created.get('SERATUS')?.[0];
  const paliPayload = created.get('PALI')?.[0];
  const seratusItems = seratusPayload?.line_items as Array<Record<string, unknown>> | undefined;
  const paliItems = paliPayload?.line_items as Array<Record<string, unknown>> | undefined;
  const metadata = seratusPayload?.meta_data as Array<Record<string, unknown>> | undefined;
  if (
    seratusPayload?.customer_id !== 501 ||
    paliPayload?.customer_id !== 601 ||
    seratusItems?.[0]?.product_id !== 7000 ||
    seratusItems?.[0]?.variation_id !== 7001 ||
    paliItems?.[0]?.product_id !== 8001 ||
    metadata?.find(({ key }) => key === 'billing_identification')?.value !==
      customer.documentNumber ||
    !metadata?.some(({ key }) => key === 'sevale_crm_order_key')
  ) {
    throw new Error('El payload outbound no respetó Customer, Product o metadata canónica.');
  }
  // El pedido viaja completado y con el descuento dentro del total de cada línea, sin `coupon_lines`.
  if (
    seratusPayload?.status !== 'completed' ||
    paliPayload?.status !== 'completed' ||
    seratusPayload?.coupon_lines !== undefined ||
    paliPayload?.coupon_lines !== undefined ||
    typeof seratusItems?.[0]?.total !== 'string' ||
    typeof seratusItems?.[0]?.subtotal !== 'string'
  ) {
    throw new Error('El payload outbound no envió el estado completado o los importes por línea.');
  }
  // WooCommerce identifica la operación con `operation_id`, con el mismo código que envía el CRM.
  const operationCodeMetadata = metadata?.find(
    ({ key }) => key === 'sevale_crm_operation_code',
  )?.value;
  if (
    typeof operationCodeMetadata !== 'string' ||
    metadata?.find(({ key }) => key === 'operation_id')?.value !== operationCodeMetadata
  ) {
    throw new Error('El payload outbound no envió el operation_id con el código de la operación.');
  }
  if (metadata?.find(({ key }) => key === 'origen')?.value !== 'CRM') {
    throw new Error('El payload outbound no envió el origen del pedido como CRM.');
  }
  const shipmentMetadata = seratusPayload?.meta_data as Array<Record<string, unknown>> | undefined;
  if (
    shipmentMetadata?.find(({ key }) => key === '_wot_tracking_carrier')?.value !==
      'Coordinadora' ||
    shipmentMetadata?.find(({ key }) => key === '_wot_tracking_number')?.value !==
      `TRACK-${runId}` ||
    shipmentMetadata?.find(({ key }) => key === '_wot_tracking_status')?.value !== 'En tránsito'
  ) {
    throw new Error('La sincronización del envío no utilizó la metadata real de WooCommerce.');
  }

  console.log(
    'Woo orders outbound smoke: RBAC, complete, mixed stores, customer/product mappings, shipment history/sync, partial failures, double complete and idempotent retries passed.',
  );
} finally {
  if (operationId) {
    await prisma.notification.deleteMany({ where: { orderOperationId: operationId } });
    await prisma.orderOperation.deleteMany({ where: { id: operationId } });
  }
  if (productIds.length) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
  if (userIds.length) await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await app.close();
  await new Promise<void>((resolve, reject) =>
    wooServer.close((error) => (error ? reject(error) : resolve())),
  );
  globalThis.fetch = originalFetch;
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
}
