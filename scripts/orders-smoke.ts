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
let couponId: number | null = null;
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
      siigoPriceUsd: 150,
      siigoStock: 10,
      store: Store.SERATUS,
      wooParentId: BigInt(8000),
      wooVariationId: BigInt(8001),
      wooSku: `SERATUS-${runId}`,
      wooPriceCop: 127000,
      wooPriceUsd: 150,
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

  const coupon = await prisma.coupon.create({
    data: {
      coupon: `orders-${runId}`,
      description: 'Cupón porcentual para pruebas de pedidos',
      type: 'percent',
      amount: 20,
    },
  });
  couponId = coupon.id;

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
    paymentMethod: 'avalpay',
    shippingMethod: 'free_shipping',
    customShippingTotal: null,
    couponId: coupon.id,
    billing: { ...address, email: customer.email },
    shipping: address,
    items: [
      {
        productId: seratus.id,
        quantity: 2,
        unitPrice: '120000',
      },
    ],
  };

  async function createOrderCase(
    label: string,
    overrides: Record<string, unknown>,
  ): Promise<{
    id: number;
    subtotal: string;
    discountTotal: string;
    shippingTotal: string;
    total: string;
    paymentMethod: string;
    paymentMethodTitle: string;
  }> {
    const response = await api('/api/orders', commercialCookie, {
      method: 'POST',
      body: JSON.stringify({ ...basePayload, couponId: null, ...overrides }),
    });
    expectStatus(response, 201, label);
    const result = (await response.json()) as {
      id: number;
      subtotal: string;
      discountTotal: string;
      shippingTotal: string;
      total: string;
      paymentMethod: string;
      paymentMethodTitle: string;
    };
    operationIds.push(result.id);
    return result;
  }

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
        items: [{ productId: 2_147_483_647, quantity: 1 }],
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
    paymentMethod: string;
    paymentMethodTitle: string;
    shippingMethod: string;
    shippingMethodTitle: string;
    couponId: number | null;
    couponCode: string | null;
    couponType: string | null;
    couponAmount: string | null;
    orders: Array<{
      store: string;
      discountTotal: string;
      shippingTotal: string;
      items: Array<{ priceModified: boolean }>;
    }>;
  };
  operationIds.push(created.id);
  if (
    !/^OP\d{12}[A-Z2-9]{4}$/.test(created.operationCode) ||
    created.source !== 'CRM' ||
    created.status !== 'PENDING' ||
    created.subtotal !== '240000.00' ||
    created.discountTotal !== '0.00' ||
    created.shippingTotal !== '0.00' ||
    created.total !== '240000.00' ||
    created.paymentMethod !== 'avalpay' ||
    created.paymentMethodTitle !== 'AvalPay' ||
    created.shippingMethod !== 'free_shipping' ||
    created.shippingMethodTitle !== 'Envío Gratis' ||
    created.couponId !== coupon.id ||
    created.couponCode !== coupon.coupon ||
    created.couponType !== 'percent' ||
    created.couponAmount !== '20.00' ||
    created.orders[0]?.store !== 'SERATUS' ||
    created.orders[0].discountTotal !== '0.00' ||
    created.orders[0].shippingTotal !== '0.00' ||
    created.orders[0].items[0]?.priceModified !== true
  ) {
    throw new Error('La creación no calculó o agrupó correctamente la operación local.');
  }

  await prisma.coupon.update({ where: { id: coupon.id }, data: { amount: 15 } });
  const historicalResponse = await api(`/api/orders/${created.id}`, commercialCookie);
  expectStatus(historicalResponse, 200, 'Snapshot histórico del cupón');
  const historical = (await historicalResponse.json()) as {
    couponAmount: string | null;
    discountTotal: string;
  };
  if (historical.couponAmount !== '20.00' || historical.discountTotal !== '0.00') {
    throw new Error('El cambio del catálogo alteró el snapshot histórico del pedido.');
  }
  await prisma.coupon.update({ where: { id: coupon.id }, data: { amount: 20 } });

  // Un cupón ya no se desactiva: o existe o no existe. Un identificador desconocido se rechaza.
  expectStatus(
    await api('/api/orders', commercialCookie, {
      method: 'POST',
      body: JSON.stringify({ ...basePayload, couponId: coupon.id + 1_000_000 }),
    }),
    400,
    'Cupón inexistente',
  );

  const usdResponse = await api('/api/orders', commercialCookie, {
    method: 'POST',
    body: JSON.stringify({
      ...basePayload,
      currency: 'USD',
      shippingMethod: 'custom',
      customShippingTotal: 1.006,
      couponId: null,
      items: [
        { productId: seratus.id, quantity: 2 },
        { productId: pali.id, quantity: 3, unitPrice: 12.346 },
      ],
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
    usd.subtotal !== '337.05' ||
    usd.discountTotal !== '0.00' ||
    usd.shippingTotal !== '1.01' ||
    usd.total !== '338.06' ||
    usdSeratusItem?.originalPrice !== '150.00' ||
    usdSeratusItem.unitPrice !== '150.00' ||
    usdSeratusItem.priceModified ||
    usdPaliItem?.originalPrice !== '30.00' ||
    usdPaliItem.unitPrice !== '12.35' ||
    usdPaliItem.discountTotal !== '0.00' ||
    !usdPaliItem.priceModified
  ) {
    throw new Error('La operación USD no respetó precios, precisión o redondeo monetario.');
  }

  const copFlat = await createOrderCase('COP 99999 con precio fijo', {
    paymentMethod: 'cod',
    shippingMethod: 'flat_rate',
    items: [{ productId: seratus.id, quantity: 1, unitPrice: '99999' }],
  });
  if (
    copFlat.subtotal !== '99999.00' ||
    copFlat.shippingTotal !== '16000.00' ||
    copFlat.total !== '115999.00' ||
    copFlat.paymentMethod !== 'cod' ||
    copFlat.paymentMethodTitle !== 'Pago con Asesor Comercial'
  ) {
    throw new Error('La regla COP por debajo del umbral o el snapshot de pago son incorrectos.');
  }

  const copFree = await createOrderCase('COP 100000 con envío gratis', {
    paymentMethod: 'binance',
    shippingMethod: 'free_shipping',
    items: [{ productId: seratus.id, quantity: 1, unitPrice: '100000' }],
  });
  if (
    copFree.subtotal !== '100000.00' ||
    copFree.shippingTotal !== '0.00' ||
    copFree.paymentMethodTitle !== 'Binance Pay'
  ) {
    throw new Error('El umbral exacto COP no activó el envío gratis.');
  }

  const usdFlat = await createOrderCase('USD 99.99 con precio fijo', {
    currency: 'USD',
    paymentMethod: 'addi',
    shippingMethod: 'flat_rate',
    items: [{ productId: seratus.id, quantity: 1, unitPrice: '99.99' }],
  });
  if (
    usdFlat.subtotal !== '99.99' ||
    usdFlat.shippingTotal !== '20.00' ||
    usdFlat.paymentMethodTitle !== 'Addi'
  ) {
    throw new Error('La regla USD por debajo del umbral es incorrecta.');
  }

  const usdFree = await createOrderCase('USD 100 con envío gratis', {
    currency: 'USD',
    paymentMethod: 'sistecredito',
    shippingMethod: 'free_shipping',
    items: [{ productId: seratus.id, quantity: 1, unitPrice: '100' }],
  });
  if (
    usdFree.subtotal !== '100.00' ||
    usdFree.shippingTotal !== '0.00' ||
    usdFree.paymentMethodTitle !== 'SisteCredito'
  ) {
    throw new Error('El umbral exacto USD no activó el envío gratis.');
  }

  expectStatus(await api(`/api/orders/${created.id}`, commercialCookie), 200, 'Detalle comercial');
  const searchResponse = await api(
    `/api/orders?search=${encodeURIComponent(seratus.sku)}&store=SERATUS&status=PENDING&page=1&pageSize=20`,
    commercialCookie,
  );
  expectStatus(searchResponse, 200, 'Búsqueda por SKU y tienda');
  const search = (await searchResponse.json()) as { pagination: { total: number } };
  if (search.pagination.total !== 6) {
    throw new Error('El listado no encontró la operación por SKU y tienda.');
  }

  const copCustom = await createOrderCase('COP con envío personalizado', {
    paymentMethod: 'cod',
    shippingMethod: 'custom',
    customShippingTotal: '22000',
    items: [{ productId: seratus.id, quantity: 1, unitPrice: '100001' }],
  });
  if (
    copCustom.subtotal !== '100001.00' ||
    copCustom.shippingTotal !== '22000.00' ||
    copCustom.total !== '122001.00'
  ) {
    throw new Error('El envío personalizado COP no conservó el valor indicado.');
  }

  const usdAboveThreshold = await createOrderCase('USD por encima del umbral', {
    currency: 'USD',
    paymentMethod: 'cod',
    shippingMethod: 'free_shipping',
    items: [{ productId: seratus.id, quantity: 1, unitPrice: '100.01' }],
  });
  if (
    usdAboveThreshold.subtotal !== '100.01' ||
    usdAboveThreshold.shippingTotal !== '0.00' ||
    usdAboveThreshold.total !== '100.01'
  ) {
    throw new Error('La regla USD por encima del umbral es incorrecta.');
  }

  const currencyChangeResponse = await api(`/api/orders/${copFlat.id}`, commercialCookie, {
    method: 'PATCH',
    body: JSON.stringify({
      ...basePayload,
      currency: 'USD',
      paymentMethod: 'cod',
      shippingMethod: 'flat_rate',
      couponId: null,
      items: [{ productId: seratus.id, quantity: 1, unitPrice: '99.99' }],
    }),
  });
  expectStatus(currencyChangeResponse, 200, 'Recálculo al cambiar de COP a USD');
  const currencyChanged = (await currencyChangeResponse.json()) as {
    currency: string;
    subtotal: string;
    shippingTotal: string;
    total: string;
  };
  if (
    currencyChanged.currency !== 'USD' ||
    currencyChanged.subtotal !== '99.99' ||
    currencyChanged.shippingTotal !== '20.00' ||
    currencyChanged.total !== '119.99'
  ) {
    throw new Error('Cambiar la moneda no recalculó automáticamente el envío y los totales.');
  }

  const mixedPayload = {
    ...basePayload,
    items: [
      { productId: seratus.id, quantity: 2 },
      { productId: pali.id, quantity: 2, unitPrice: '75000' },
    ],
  };
  const mixedResponse = await api(`/api/orders/${created.id}`, commercialCookie, {
    method: 'PATCH',
    body: JSON.stringify(mixedPayload),
  });
  expectStatus(mixedResponse, 200, 'Agregar segunda tienda');
  const mixed = (await mixedResponse.json()) as {
    operationCode: string;
    subtotal: string;
    discountTotal: string;
    shippingTotal: string;
    total: string;
    orders: Array<{
      id: number;
      store: string;
      discountTotal: string;
      shippingTotal: string;
      total: string;
    }>;
  };
  if (
    mixed.subtotal !== '404000.00' ||
    mixed.discountTotal !== '50800.00' ||
    mixed.shippingTotal !== '0.00' ||
    mixed.total !== '353200.00' ||
    mixed.orders.some(({ shippingTotal }) => shippingTotal !== '0.00') ||
    mixed.orders.find(({ store }) => store === 'SERATUS')?.discountTotal !== '50800.00' ||
    mixed.orders.find(({ store }) => store === 'PALI')?.discountTotal !== '0.00' ||
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
    items: [{ productId: pali.id, quantity: 2 }],
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
  if (paliOnly.total !== '128000.00') {
    throw new Error('La edición no recalculó el total consolidado de la operación.');
  }

  const withoutCouponResponse = await api(`/api/orders/${created.id}`, commercialCookie, {
    method: 'PATCH',
    body: JSON.stringify({ ...paliOnlyPayload, couponId: null }),
  });
  expectStatus(withoutCouponResponse, 200, 'Quitar cupón en operación pendiente');
  const withoutCoupon = (await withoutCouponResponse.json()) as {
    couponId: number | null;
    couponCode: string | null;
    discountTotal: string;
    total: string;
  };
  if (
    withoutCoupon.couponId !== null ||
    withoutCoupon.couponCode !== null ||
    withoutCoupon.discountTotal !== '0.00' ||
    withoutCoupon.total !== '160000.00'
  ) {
    throw new Error('Quitar el cupón no limpió el snapshot o recalculó los totales.');
  }

  const invalidShippingPayload = {
    ...basePayload,
    shippingMethod: 'free_shipping',
    couponId: null,
    items: [{ productId: pali.id, quantity: 1 }],
  };
  expectStatus(
    await api(`/api/orders/${created.id}`, commercialCookie, {
      method: 'PATCH',
      body: JSON.stringify(invalidShippingPayload),
    }),
    400,
    'Envío gratis por debajo del umbral',
  );
  expectStatus(
    await api('/api/orders', commercialCookie, {
      method: 'POST',
      body: JSON.stringify({ ...basePayload, paymentMethod: 'browser_invented_method' }),
    }),
    400,
    'Método de pago fuera del catálogo',
  );
  expectStatus(
    await api('/api/orders', commercialCookie, {
      method: 'POST',
      body: JSON.stringify({
        ...basePayload,
        paymentMethodTitle: 'Título manipulado',
        couponAmount: 99,
      }),
    }),
    400,
    'Campos comerciales manipulados por el navegador',
  );

  // El precio manual solo puede bajar: puede volver a subir hasta igualar el valor
  // original, pero nunca superarlo. Un ítem con precio modificado a la baja queda
  // fuera de la base del cupón; uno sin modificar sí lo recibe.
  const restoredPriceResponse = await api('/api/orders', commercialCookie, {
    method: 'POST',
    body: JSON.stringify({
      ...basePayload,
      items: [{ productId: seratus.id, quantity: 1, unitPrice: '127000' }],
    }),
  });
  expectStatus(restoredPriceResponse, 201, 'Precio manual igual al valor original');
  const restoredPrice = (await restoredPriceResponse.json()) as {
    id: number;
    subtotal: string;
    discountTotal: string;
    orders: Array<{ items: Array<{ priceModified: boolean }> }>;
  };
  operationIds.push(restoredPrice.id);
  if (
    restoredPrice.subtotal !== '127000.00' ||
    restoredPrice.discountTotal !== '25400.00' ||
    restoredPrice.orders[0]?.items[0]?.priceModified !== false
  ) {
    throw new Error(
      'El precio igual al valor original debe conservar el producto dentro de la base del cupón.',
    );
  }

  const aboveOriginalResponse = await api('/api/orders', commercialCookie, {
    method: 'POST',
    body: JSON.stringify({
      ...basePayload,
      items: [{ productId: seratus.id, quantity: 1, unitPrice: '127001' }],
    }),
  });
  expectStatus(aboveOriginalResponse, 400, 'Precio por encima del valor original');
  const aboveOriginalError = (await aboveOriginalResponse.json()) as {
    error?: { code?: string };
  };
  if (aboveOriginalError.error?.code !== 'ORDER_ITEM_PRICE_EXCEEDS_ORIGINAL') {
    throw new Error(
      'El rechazo por precio superior al original no devolvió el código ORDER_ITEM_PRICE_EXCEEDS_ORIGINAL.',
    );
  }

  expectStatus(
    await api(`/api/orders/${created.id}`, commercialCookie, { method: 'DELETE' }),
    403,
    'Eliminación comercial',
  );
  expectStatus(
    await api(`/api/orders/${created.id}`, adminCookie, { method: 'DELETE' }),
    200,
    'Eliminación física administrativa',
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
  const deletedOrders = await prisma.order.count({ where: { operationId: created.id } });
  if (deletedRow !== null || deletedOrders !== 0 || deletedList.pagination.total !== 0) {
    throw new Error('La eliminación no borró físicamente la operación y sus pedidos asociados.');
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
  const [remainingShipment, remainingQuotation] = await Promise.all([
    prisma.shipment.count({ where: { operationId: completed.id } }),
    prisma.siigoQuotation.count({ where: { operationId: completed.id } }),
  ]);
  if (deletedCompleted !== null || remainingShipment !== 0 || remainingQuotation !== 0) {
    throw new Error('La eliminación administrativa no limpió la operación completada.');
  }

  process.stdout.write(
    'Orders smoke: payment catalogs, COP/USD shipping thresholds, custom shipping, coupon snapshots, missing coupon rejection, consolidated and per-store discounts, manual price capped at the original value, authentication, RBAC, list, create, pending edit and store reconciliation checks passed.\n',
  );
} finally {
  if (operationIds.length > 0) {
    await prisma.notification.deleteMany({ where: { orderOperationId: { in: operationIds } } });
    await prisma.orderOperation.deleteMany({ where: { id: { in: operationIds } } });
  }
  if (couponId !== null) await prisma.coupon.deleteMany({ where: { id: couponId } });
  if (productIds.length > 0) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  if (customerId !== null) await prisma.customer.deleteMany({ where: { id: customerId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await app.close();
}
