import '../apps/api/src/config/load-environment.js';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword } from 'better-auth/crypto';
import { AppModule } from '../apps/api/src/app.module.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { Role, Store } from '../apps/api/src/generated/prisma/client.js';
import { OrdersRepository } from '../apps/api/src/orders/orders.repository.js';

process.env.BETTER_AUTH_SECRET ||= 'local-orders-smoke-secret-at-least-32-characters';

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
  logger: false,
});
app.setGlobalPrefix('api');
const origin = process.env.FRONTEND_URL || 'http://localhost:5173';
app.enableCors({ origin, credentials: true });
await app.listen(0, '127.0.0.1');

const prisma = app.get(PrismaService);
const ordersRepository = app.get(OrdersRepository);
const baseUrl = await app.getUrl();
const runId = randomUUID();
const password = `O-${randomUUID()}-9a!`;
const userIds: string[] = [];
const operationIds: number[] = [];
let customerId: number | null = null;
const productIds: number[] = [];

function expectStatus(response: Response, status: number, context: string) {
  if (response.status !== status) {
    throw new Error(`${context}: se esperaba ${status} y se recibió ${response.status}.`);
  }
}

async function createUser(role: Role) {
  const id = randomUUID();
  const email = `orders-${role.toLowerCase()}-${runId}@example.invalid`;
  userIds.push(id);
  await prisma.user.create({
    data: {
      id,
      name: `Orders Smoke ${role}`,
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
  if (!cookie) throw new Error(`No se creó la sesión ${role}.`);
  return cookie;
}

function api(path: string, cookie?: string, init?: RequestInit) {
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
  const [adminCookie, commercialCookie, logisticsCookie] = await Promise.all([
    createUser(Role.ADMIN),
    createUser(Role.COMMERCIAL),
    createUser(Role.LOGISTICS),
  ]);

  const customer = await prisma.customer.create({
    data: {
      personType: 'PERSON',
      firstName: 'Cliente',
      lastName: 'Pedidos API',
      displayName: `Cliente Pedidos API ${runId}`,
      documentType: '13',
      documentNumber: Date.now().toString(),
      email: `customer-${runId}@example.invalid`,
      fiscalResponsibilities: ['R-99-PN'],
    },
  });
  customerId = customer.id;

  const seratus = await prisma.product.create({
    data: {
      siigoId: `siigo-seratus-${runId}`,
      sku: `SERATUS-${runId}`,
      siigoPriceCop: 127000,
      siigoPriceUsd: 50,
      siigoStock: 10,
      store: Store.SERATUS,
      wooParentId: BigInt(8000),
      wooVariationId: BigInt(8001),
      wooSku: `SERATUS-${runId}`,
      wooPriceCop: 127000,
      wooPriceUsd: 50,
      wooStock: 10,
      syncStatus: 'SYNCED',
      productName: 'Producto Seratus Pedidos',
    },
  });
  productIds.push(seratus.id);
  const pali = await prisma.product.create({
    data: {
      siigoId: `siigo-pali-${runId}`,
      sku: `PALI-${runId}`,
      siigoPriceCop: 80000,
      siigoPriceUsd: 30,
      siigoStock: 8,
      store: Store.PALI,
      wooParentId: BigInt(8100),
      wooVariationId: BigInt(8101),
      wooSku: `PALI-${runId}`,
      wooPriceCop: 80000,
      wooPriceUsd: 30,
      wooStock: 8,
      syncStatus: 'SYNCED',
      productName: 'Producto Pali Pedidos',
    },
  });
  productIds.push(pali.id);

  const address = {
    firstName: 'Cliente',
    lastName: 'Pedidos API',
    company: null,
    address1: 'CRA 1 # 2-3',
    address2: null,
    city: 'Medellín',
    state: 'CO-ANT',
    postcode: '050001',
    country: 'CO',
    phone: '+573001234567',
  };
  const basePayload = {
    customerId: customer.id,
    currency: 'COP',
    paymentMethod: 'cash',
    paymentMethodTitle: 'Efectivo',
    shippingMethod: 'flat_rate',
    shippingMethodTitle: 'Envío nacional',
    billing: { ...address, email: customer.email },
    shipping: address,
    items: [
      {
        productId: seratus.id,
        quantity: 2,
        unitPrice: '120000',
        discountTotal: '10000',
      },
    ],
    coupons: [{ store: 'SERATUS', code: 'PROMO', discountTotal: '10000' }],
    shippingTotals: [{ store: 'SERATUS', total: '15000' }],
  };

  expectStatus(
    await api('/api/orders', commercialCookie, {
      method: 'POST',
      body: JSON.stringify({ ...basePayload, customerId: 2_147_483_647 }),
    }),
    404,
    'Cliente inexistente',
  );
  expectStatus(
    await api('/api/orders', commercialCookie, {
      method: 'POST',
      body: JSON.stringify({
        ...basePayload,
        items: [{ productId: 2_147_483_647, quantity: 1, discountTotal: '0' }],
        coupons: [],
        shippingTotals: [],
      }),
    }),
    404,
    'Producto inexistente',
  );

  expectStatus(await api('/api/orders'), 401, 'Listado anónimo');
  expectStatus(await api('/api/orders', logisticsCookie), 200, 'Listado logística');
  expectStatus(
    await api('/api/orders', logisticsCookie, {
      method: 'POST',
      body: JSON.stringify(basePayload),
    }),
    403,
    'Creación logística',
  );

  const createResponse = await api('/api/orders', commercialCookie, {
    method: 'POST',
    body: JSON.stringify(basePayload),
  });
  expectStatus(createResponse, 201, 'Creación comercial');
  const created = (await createResponse.json()) as {
    id: number;
    operationCode: string;
    source: string;
    status: string;
    subtotal: string;
    discountTotal: string;
    shippingTotal: string;
    total: string;
    orders: Array<{ store: string; items: Array<{ priceModified: boolean }> }>;
  };
  operationIds.push(created.id);
  if (
    !/^OP\d{12}[A-Z2-9]{4}$/.test(created.operationCode) ||
    created.source !== 'CRM' ||
    created.status !== 'PENDING' ||
    created.subtotal !== '240000.00' ||
    created.discountTotal !== '10000.00' ||
    created.shippingTotal !== '15000.00' ||
    created.total !== '245000.00' ||
    created.orders[0]?.store !== 'SERATUS' ||
    created.orders[0].items[0]?.priceModified !== true
  ) {
    throw new Error('La creación no calculó o agrupó correctamente la operación local.');
  }

  const usdResponse = await api('/api/orders', commercialCookie, {
    method: 'POST',
    body: JSON.stringify({
      ...basePayload,
      currency: 'USD',
      items: [
        { productId: seratus.id, quantity: 2, discountTotal: 0 },
        { productId: pali.id, quantity: 3, unitPrice: 12.346, discountTotal: 0.006 },
      ],
      coupons: [{ store: 'PALI', code: 'USD-ROUND', discountTotal: 0.006 }],
      shippingTotals: [{ store: 'PALI', total: 1.006 }],
    }),
  });
  expectStatus(usdResponse, 201, 'Creación USD con redondeo');
  const usd = (await usdResponse.json()) as {
    id: number;
    currency: string;
    subtotal: string;
    discountTotal: string;
    shippingTotal: string;
    total: string;
    orders: Array<{
      store: string;
      items: Array<{
        originalPrice: string | null;
        unitPrice: string;
        discountTotal: string;
        priceModified: boolean;
      }>;
    }>;
  };
  operationIds.push(usd.id);
  const usdSeratusItem = usd.orders.find(({ store }) => store === 'SERATUS')?.items[0];
  const usdPaliItem = usd.orders.find(({ store }) => store === 'PALI')?.items[0];
  if (
    usd.currency !== 'USD' ||
    usd.subtotal !== '137.05' ||
    usd.discountTotal !== '0.01' ||
    usd.shippingTotal !== '1.01' ||
    usd.total !== '138.05' ||
    usdSeratusItem?.originalPrice !== '50.00' ||
    usdSeratusItem.unitPrice !== '50.00' ||
    usdSeratusItem.priceModified ||
    usdPaliItem?.originalPrice !== '30.00' ||
    usdPaliItem.unitPrice !== '12.35' ||
    usdPaliItem.discountTotal !== '0.01' ||
    !usdPaliItem.priceModified
  ) {
    throw new Error('La operación USD no respetó precios, precisión o redondeo monetario.');
  }

  expectStatus(await api(`/api/orders/${created.id}`, commercialCookie), 200, 'Detalle comercial');
  const searchResponse = await api(
    `/api/orders?search=${encodeURIComponent(seratus.sku)}&store=SERATUS&status=PENDING&page=1&pageSize=20`,
    commercialCookie,
  );
  expectStatus(searchResponse, 200, 'Búsqueda por SKU y tienda');
  const search = (await searchResponse.json()) as { pagination: { total: number } };
  if (search.pagination.total !== 2) {
    throw new Error('El listado no encontró la operación por SKU y tienda.');
  }

  const mixedPayload = {
    ...basePayload,
    items: [
      { productId: seratus.id, quantity: 1, discountTotal: '0' },
      { productId: pali.id, quantity: 1, unitPrice: '75000', discountTotal: '0' },
    ],
    coupons: [],
    shippingTotals: [
      { store: 'SERATUS', total: '5000' },
      { store: 'PALI', total: '8000' },
    ],
  };
  const mixedResponse = await api(`/api/orders/${created.id}`, commercialCookie, {
    method: 'PATCH',
    body: JSON.stringify(mixedPayload),
  });
  expectStatus(mixedResponse, 200, 'Agregar segunda tienda');
  const mixed = (await mixedResponse.json()) as {
    operationCode: string;
    orders: Array<{ id: number; store: string; total: string }>;
  };
  if (
    mixed.orders
      .map(({ store }) => store)
      .sort()
      .join(',') !== 'PALI,SERATUS'
  ) {
    throw new Error('La edición no creó el Order correspondiente a la segunda tienda.');
  }
  const rowListResponse = await api(
    `/api/orders?search=${encodeURIComponent(created.operationCode)}&page=1&pageSize=20`,
    commercialCookie,
  );
  expectStatus(rowListResponse, 200, 'Listado por filas de tienda');
  const rowList = (await rowListResponse.json()) as {
    data: Array<{
      id: number;
      operationId: number;
      operationCode: string;
      store: string;
      total: string;
    }>;
    pagination: { total: number };
  };
  if (
    rowList.pagination.total !== 2 ||
    rowList.data.some(
      (row) =>
        row.operationId !== created.id ||
        row.operationCode !== created.operationCode ||
        row.total !== mixed.orders.find(({ store }) => store === row.store)?.total,
    ) ||
    rowList.data
      .map(({ store }) => store)
      .sort()
      .join(',') !== 'PALI,SERATUS'
  ) {
    throw new Error('El listado no devolvió una fila independiente por Order y tienda.');
  }

  const paliOnlyPayload = {
    ...basePayload,
    items: [{ productId: pali.id, quantity: 2, discountTotal: '0' }],
    coupons: [],
    shippingTotals: [{ store: 'PALI', total: '8000' }],
  };
  const paliOnlyResponse = await api(`/api/orders/${created.id}`, commercialCookie, {
    method: 'PATCH',
    body: JSON.stringify(paliOnlyPayload),
  });
  expectStatus(paliOnlyResponse, 200, 'Eliminar tienda sin productos');
  const paliOnly = (await paliOnlyResponse.json()) as {
    total: string;
    orders: Array<{ store: string }>;
  };
  if (paliOnly.orders.length !== 1 || paliOnly.orders[0]?.store !== 'PALI') {
    throw new Error('La reconciliación no eliminó el Order local que quedó sin productos.');
  }
  if (paliOnly.total !== '168000.00') {
    throw new Error('La edición no recalculó el total consolidado de la operación.');
  }

  const mismatchPayload = {
    ...basePayload,
    items: [{ productId: seratus.id, quantity: 1, discountTotal: '5000' }],
    coupons: [],
    shippingTotals: [],
  };
  expectStatus(
    await api(`/api/orders/${created.id}`, commercialCookie, {
      method: 'PATCH',
      body: JSON.stringify(mismatchPayload),
    }),
    400,
    'Descuento inconsistente',
  );

  expectStatus(
    await api(`/api/orders/${created.id}`, commercialCookie, { method: 'DELETE' }),
    403,
    'Eliminación comercial',
  );
  expectStatus(
    await api(`/api/orders/${created.id}`, adminCookie, { method: 'DELETE' }),
    200,
    'Eliminación lógica administrativa',
  );
  expectStatus(
    await api(`/api/orders/${created.id}`, adminCookie),
    404,
    'Detalle después de eliminar',
  );
  const deletedRow = await prisma.orderOperation.findUnique({ where: { id: created.id } });
  const deletedListResponse = await api(
    `/api/orders?search=${encodeURIComponent(created.operationCode)}&page=1&pageSize=20`,
    adminCookie,
  );
  expectStatus(deletedListResponse, 200, 'Listado después de eliminar');
  const deletedList = (await deletedListResponse.json()) as { pagination: { total: number } };
  if (!deletedRow?.deletedAt || deletedList.pagination.total !== 0) {
    throw new Error('El borrado lógico no conservó el registro o todavía lo expone en consultas.');
  }

  const completedResponse = await api('/api/orders', adminCookie, {
    method: 'POST',
    body: JSON.stringify(basePayload),
  });
  expectStatus(completedResponse, 201, 'Creación para bloqueo de estado');
  const completed = (await completedResponse.json()) as { id: number };
  operationIds.push(completed.id);
  await prisma.orderOperation.update({
    where: { id: completed.id },
    data: { status: 'COMPLETED' },
  });
  expectStatus(
    await api(`/api/orders/${completed.id}`, commercialCookie, {
      method: 'PATCH',
      body: JSON.stringify(basePayload),
    }),
    409,
    'Edición de operación completada',
  );
  expectStatus(
    await api(`/api/orders/${completed.id}/siigo-quotation`, logisticsCookie, {
      method: 'POST',
      body: JSON.stringify({}),
    }),
    403,
    'Cotización Siigo sin permiso de logística',
  );
  const initialQuotationClaim = await ordersRepository.claimSiigoQuotation(completed.id);
  if (initialQuotationClaim.outcome !== 'CLAIMED') {
    throw new Error('No se reservó la primera cotización Siigo.');
  }
  await ordersRepository.markSiigoQuotationError(
    initialQuotationClaim.quotationId,
    'SIIGO_QUOTATION_CREATE_FAILED',
    'Fallo controlado para probar el reintento.',
  );
  const retryQuotationClaim = await ordersRepository.claimSiigoQuotation(completed.id);
  if (retryQuotationClaim.outcome !== 'CLAIMED') {
    throw new Error('La cotización con error no quedó disponible para reintento.');
  }
  await ordersRepository.markSiigoQuotationSynced(retryQuotationClaim.quotationId, {
    id: randomUUID(),
    number: '999',
    name: 'C-1-999',
    publicUrl: 'https://publicview.siigo.com/document?data=smoke',
    sellerId: '629',
    exchangeRate: null,
  });
  const duplicateQuotationClaim = await ordersRepository.claimSiigoQuotation(completed.id);
  if (duplicateQuotationClaim.outcome !== 'ALREADY_SYNCED') {
    throw new Error('La operación permitió duplicar una cotización ya sincronizada.');
  }
  const shipmentResponse = await api(`/api/orders/${completed.id}/shipment`, logisticsCookie, {
    method: 'PUT',
    body: JSON.stringify({
      carrier: 'Transportadora Smoke',
      trackingNumber: `TRACK-${runId}`,
      status: 'Preparando envío',
      note: 'Guía asignada por logística.',
    }),
  });
  expectStatus(shipmentResponse, 200, 'Asignación de envío por logística');
  const withShipment = (await shipmentResponse.json()) as {
    shipment: {
      trackingNumber: string;
      events: Array<{ status: string; createdBy: { id: string } | null }>;
      storeSyncs: Array<{ syncStatus: string; lastSyncErrorCode: string | null }>;
    };
  };
  if (
    withShipment.shipment.trackingNumber !== `TRACK-${runId}` ||
    withShipment.shipment.events.length !== 1 ||
    !withShipment.shipment.events[0]?.createdBy?.id ||
    withShipment.shipment.storeSyncs[0]?.syncStatus !== 'ERROR' ||
    withShipment.shipment.storeSyncs[0]?.lastSyncErrorCode !== 'WOO_ORDER_NOT_CREATED'
  ) {
    throw new Error('El envío local no guardó guía, autor, historial o estado por tienda.');
  }
  const shipmentUpdateResponse = await api(
    `/api/orders/${completed.id}/shipment`,
    commercialCookie,
    {
      method: 'PUT',
      body: JSON.stringify({
        carrier: 'Transportadora Smoke',
        trackingNumber: `TRACK-${runId}`,
        status: 'En tránsito',
        note: 'Paquete entregado a la transportadora.',
      }),
    },
  );
  expectStatus(shipmentUpdateResponse, 200, 'Actualización de envío comercial');
  const shipmentUpdated = (await shipmentUpdateResponse.json()) as {
    shipment: { status: string; events: Array<{ status: string }> };
  };
  if (
    shipmentUpdated.shipment.status !== 'En tránsito' ||
    shipmentUpdated.shipment.events.length !== 2
  ) {
    throw new Error('La actualización logística no conservó el historial del envío.');
  }
  expectStatus(
    await api(`/api/customers/${customer.id}`, adminCookie, { method: 'DELETE' }),
    409,
    'Eliminación de cliente con operaciones',
  );
  expectStatus(
    await api(`/api/orders/${completed.id}`, commercialCookie, { method: 'DELETE' }),
    403,
    'Eliminación comercial de operación completada',
  );
  expectStatus(
    await api(`/api/orders/${completed.id}`, adminCookie, { method: 'DELETE' }),
    200,
    'Eliminación administrativa de operación completada',
  );
  expectStatus(
    await api(`/api/orders/${completed.id}`, adminCookie),
    404,
    'Detalle de operación completada eliminada',
  );
  const deletedCompleted = await prisma.orderOperation.findUnique({
    where: { id: completed.id },
  });
  if (!deletedCompleted?.deletedAt || deletedCompleted.status !== 'COMPLETED') {
    throw new Error('La eliminación administrativa no conservó el historial completado.');
  }

  process.stdout.write(
    'Orders smoke: authentication, RBAC, COP/USD rounding, list, search, detail, create, pending-only edit, admin-only soft-delete for any state, shipment history, Siigo quotation claims/retry, customer/product protection and store reconciliation checks passed.\n',
  );
} finally {
  if (operationIds.length > 0) {
    await prisma.notification.deleteMany({ where: { orderOperationId: { in: operationIds } } });
    await prisma.orderOperation.deleteMany({ where: { id: { in: operationIds } } });
  }
  if (productIds.length > 0) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  if (customerId !== null) await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await app.close();
}
