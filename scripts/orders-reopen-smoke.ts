import '../apps/api/src/config/load-environment.js';
import { randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword } from 'better-auth/crypto';
import { AppModule } from '../apps/api/src/app.module.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { Role, Store } from '../apps/api/src/generated/prisma/client.js';

process.env.BETTER_AUTH_SECRET ||= 'local-orders-reopen-secret-at-least-32-characters';

/**
 * Cubre el ciclo de un pedido de la tienda que llega cancelado o fallido y el comercial retoma: no
 * se puede completar cuando la tienda lo cerró, se reabre una sola vez, y al completarlo se
 * actualiza el pedido que ya existe en WooCommerce en vez de crear otro.
 */

type CapturedOrder = Record<string, unknown> & {
  id: number;
  status: string;
  line_items: Array<Record<string, unknown>>;
  shipping_lines: Array<Record<string, unknown>>;
};

const orders = new Map<number, CapturedOrder>();
const updates: Array<Record<string, unknown>> = [];
let sequence = 0;

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
  const orderPath = url.pathname.match(/\/orders\/(\d+)$/);

  if (request.method === 'GET' && !url.pathname.endsWith('/orders')) {
    if (!orderPath) return json(response, 404, { message: 'Not found' });
    const order = orders.get(Number(orderPath[1]));
    if (!order) return json(response, 404, { message: 'Order not found' });
    return json(response, 200, order);
  }

  if (request.method === 'PUT' && orderPath) {
    const order = orders.get(Number(orderPath[1]));
    if (!order) return json(response, 404, { message: 'Order not found' });
    const payload = await body(request);
    updates.push(payload);
    order.status = typeof payload.status === 'string' ? payload.status : order.status;
    /**
     * WooCommerce real: recorre las líneas que llegan y, para cada una, borra (quantity 0), actualiza
     * (trae `id`) o agrega (trae `product_id`). Lo que no llega no se toca. Reemplazar el arreglo
     * entero, como hacía antes este mock, escondía justo el fallo de las líneas que quedaban vivas.
     */
    if (Array.isArray(payload.line_items)) {
      for (const incoming of payload.line_items as Array<Record<string, unknown>>) {
        const lineId = typeof incoming.id === 'number' ? incoming.id : null;
        if (lineId !== null && incoming.quantity === 0) {
          const index = order.line_items.findIndex((line) => line.id === lineId);
          if (index < 0) return json(response, 400, { code: 'woocommerce_rest_invalid_item_id' });
          order.line_items.splice(index, 1);
          continue;
        }
        if (lineId !== null) {
          const index = order.line_items.findIndex((line) => line.id === lineId);
          if (index < 0) return json(response, 400, { code: 'woocommerce_rest_invalid_item_id' });
          order.line_items[index] = {
            ...order.line_items[index],
            ...incoming,
            id: lineId,
            quantity: incoming.quantity ?? 1,
          };
          continue;
        }
        order.line_items.push({
          ...incoming,
          id: 9000 + sequence++,
          quantity: incoming.quantity ?? 1,
        });
      }
    }
    if (Array.isArray(payload.shipping_lines)) {
      order.shipping_lines = (payload.shipping_lines as Array<Record<string, unknown>>).map(
        (line) => ({ ...line, id: typeof line.id === 'number' ? line.id : 5500 + sequence++ }),
      );
    }
    order.date_modified = '2026-11-05T09:00:00-05:00';
    return json(response, 200, order);
  }

  if (!url.pathname.endsWith('/orders')) return json(response, 404, { message: 'Not found' });
  if (request.method === 'GET') return json(response, 200, [...orders.values()]);
  if (request.method !== 'POST') return json(response, 405, { message: 'Method not allowed' });

  const payload = await body(request);
  const created: CapturedOrder = {
    ...payload,
    id: 96001 + sequence++,
    status: typeof payload.status === 'string' ? payload.status : 'processing',
    line_items: (Array.isArray(payload.line_items) ? payload.line_items : []).map((line) => ({
      ...(line as Record<string, unknown>),
      id: 7000 + sequence++,
    })),
    // Igual que WooCommerce: cada envío del alta nace con su propio id.
    shipping_lines: (Array.isArray(payload.shipping_lines) ? payload.shipping_lines : []).map(
      (line) => ({
        ...(line as Record<string, unknown>),
        id: 5000 + sequence++,
      }),
    ),
    date_created: '2026-11-05T08:00:00-05:00',
    date_modified: '2026-11-05T08:00:00-05:00',
  };
  orders.set(created.id, created);
  return json(response, 201, created);
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

process.env.SERATUS_API_URL = wooUrl;
process.env.WOOCOMMERCE_SERATUS_CK = 'seratus-key';
process.env.WOOCOMMERCE_SERATUS_CS = 'seratus-secret';

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
const password = `R-${randomUUID()}-9a!`;
const userIds: string[] = [];
const productIds: number[] = [];
const webhookDeliveryIds: string[] = [];
let customerId: number | null = null;

function expectStatus(response: Response, status: number, context: string) {
  if (response.status !== status) {
    throw new Error(`${context}: se esperaba ${status}, se recibió ${response.status}.`);
  }
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function createUser(role: Role) {
  const id = randomUUID();
  const email = `reopen-${role.toLowerCase()}-${runId}@example.invalid`;
  userIds.push(id);
  await prisma.user.create({
    data: {
      id,
      name: `Reopen ${role}`,
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
  const cookie = await createUser(Role.COMMERCIAL);
  const customer = await prisma.customer.create({
    data: {
      personType: 'PERSON',
      firstName: 'Cliente',
      lastName: 'Reopen',
      displayName: `Cliente Reopen ${runId}`,
      documentType: '13',
      documentNumber: String(Date.now()),
      email: `reopen-${runId}@example.invalid`,
      fiscalResponsibilities: ['R-99-PN'],
      integrations: {
        create: [
          { provider: 'SERATUS', externalId: '501', status: 'SYNCED' },
          { provider: 'SIIGO', status: 'PENDING' },
        ],
      },
    },
  });
  customerId = customer.id;

  const product = (parentId: bigint | null, variationId: bigint, name: string) =>
    prisma.product.create({
      data: {
        siigoId: `siigo-reopen-${name}-${runId}`,
        sku: `OPEN-${name}-${runId}`,
        productName: `Producto ${name} reopen`,
        store: Store.SERATUS,
        siigoPriceCop: 100000,
        siigoPriceUsd: 25,
        siigoStock: 10,
        wooParentId: parentId,
        wooVariationId: variationId,
        wooSku: `OPEN-${name}-${runId}`,
        wooPriceCop: 100000,
        wooPriceUsd: 25,
        wooStock: 10,
        syncStatus: 'SYNCED',
      },
    });
  const first = await product(7000n, 7001n, 'A');
  const second = await product(null, 8001n, 'B');
  const third = await product(null, 8101n, 'C');
  productIds.push(first.id, second.id, third.id);

  const addressSnapshot = {
    firstName: 'Cliente',
    lastName: 'Reopen',
    company: null,
    address1: 'Cra 1 # 2-3',
    address2: null,
    city: 'Medellín',
    state: 'ANT',
    postcode: '050001',
    country: 'CO',
    phone: '+573001234567',
  };
  const payload = {
    customerId: customer.id,
    currency: 'COP',
    paymentMethod: 'cod',
    // Envío cobrado, para comprobar que el PUT reemplaza el importe del envío existente en vez de
    // agregar otro cuando el comercial lo cambia.
    shippingMethod: 'custom',
    customShippingTotal: '12000',
    couponId: null,
    customerNote: 'Pedido reabierto.',
    billing: { ...addressSnapshot, email: customer.email },
    shipping: addressSnapshot,
    items: [{ productId: first.id, quantity: 2 }],
  };

  const createResponse = await api('/api/orders', cookie, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  expectStatus(createResponse, 201, 'Crear operación');
  const local = (await createResponse.json()) as { id: number };

  expectStatus(
    await api(`/api/orders/${local.id}/complete`, cookie, { method: 'POST' }),
    201,
    'Completar por primera vez',
  );
  const createdInWoo = [...orders.values()][0];
  assert(createdInWoo, 'La tienda simulada no recibió el pedido.');
  assert(createdInWoo.line_items.length === 1, 'El alta debía crear una sola línea.');
  const existingLineId = Number(createdInWoo.line_items[0]?.id);
  assert(createdInWoo.shipping_lines.length === 1, 'El alta debía crear un solo envío.');
  const existingShippingLineId = Number(createdInWoo.shipping_lines[0]?.id);
  assert(
    createdInWoo.shipping_lines[0]?.total === '12000.00',
    `El alta debía cobrar 12000.00 de envío, cobró ${String(createdInWoo.shipping_lines[0]?.total)}.`,
  );

  /**
   * Alguien agrega una línea en WooCommerce que el CRM no tiene. Al completar hay que borrarla: si
   * el PUT la omite, WooCommerce la deja viva y el pedido acaba con los productos viejos y los
   * nuevos. Es lo que pasó en producción con un pedido reabierto al que le cambiaron las referencias.
   */
  const orphanLineId = 8888;
  createdInWoo.line_items.push({
    id: orphanLineId,
    product_id: 999,
    variation_id: 0,
    quantity: 1,
    subtotal: '50000.00',
    total: '50000.00',
  });

  // La tienda cierra el pedido por un pago abandonado: así llega al CRM. Se reproduce el estado que
  // deja el webhook de WooCommerce para no depender de la firma del webhook en esta prueba.
  await prisma.orderOperation.update({
    where: { id: local.id },
    data: { source: 'WOOCOMMERCE', status: 'CANCELLED' },
  });
  await prisma.order.updateMany({
    where: { operationId: local.id },
    data: { wooStatus: 'failed' },
  });

  const blocked = await api(`/api/orders/${local.id}/complete`, cookie, { method: 'POST' });
  expectStatus(blocked, 409, 'Completar un pedido cancelado de la tienda');
  const blockedBody = (await blocked.json()) as { error?: { code?: string } };
  assert(
    blockedBody.error?.code === 'ORDER_NOT_COMPLETABLE',
    `Se esperaba ORDER_NOT_COMPLETABLE, llegó ${blockedBody.error?.code}.`,
  );

  const reopened = await api(`/api/orders/${local.id}/reopen`, cookie, { method: 'POST' });
  expectStatus(reopened, 201, 'Reabrir');
  const reopenedBody = (await reopened.json()) as { status?: string; reopenedAt?: string | null };
  assert(
    reopenedBody.status === 'PENDING',
    `Reabrir debía dejar PENDING, quedó ${reopenedBody.status}.`,
  );
  assert(reopenedBody.reopenedAt, 'Reabrir debía dejar la marca de reapertura.');

  const twice = await api(`/api/orders/${local.id}/reopen`, cookie, { method: 'POST' });
  expectStatus(twice, 409, 'Reabrir dos veces');
  const twiceBody = (await twice.json()) as { error?: { code?: string } };
  assert(
    twiceBody.error?.code === 'ORDER_NOT_REOPENABLE',
    `Se esperaba ORDER_NOT_REOPENABLE, llegó ${twiceBody.error?.code}.`,
  );

  /**
   * El webhook de WooCommerce manda `order.updated` por cualquier cambio que no sea el estado (una
   * nota, el tracking). Ninguno de esos puede deshacer la reapertura: si lo hiciera, el pedido
   * volvería a cancelado sin que nadie entienda por qué.
   */
  process.env.N8N_API_KEY ||= 'local-reopen-webhook-key';
  const webhook = (status: string, modified: string) => {
    // La entrega se guarda en el CRM y, si no se borra, queda apuntando a un pedido que ya no
    // existe. Se recuerda el identificador para limpiarla al final.
    const deliveryId = randomUUID();
    webhookDeliveryIds.push(deliveryId);
    return fetch(`${baseUrl}/api/integrations/woocommerce/orders`, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${process.env.N8N_API_KEY}`,
      },
      body: JSON.stringify({
        provider: 'SERATUS',
        event: 'order.updated',
        deliveryId,
        order: {
          id: String(createdInWoo.id),
          status,
          currency: 'COP',
          date_created: '2026-11-05T08:00:00',
          date_modified: modified,
          customer_id: 0,
          discount_total: '0.00',
          shipping_total: '0.00',
          total: '200000.00',
          payment_method: 'cod',
          payment_method_title: 'Pago contra entrega',
          customer_note: 'Pedido reabierto.',
          billing: {
            first_name: 'Cliente',
            last_name: 'Reopen',
            company: '',
            address_1: 'Cra 1 # 2-3',
            address_2: '',
            city: 'Medellín',
            state: 'ANT',
            postcode: '050001',
            country: 'CO',
            email: customer.email ?? '',
            phone: '+57 300 1234567',
          },
          shipping: {
            first_name: 'Cliente',
            last_name: 'Reopen',
            company: '',
            address_1: 'Cra 1 # 2-3',
            address_2: '',
            city: 'Medellín',
            state: 'ANT',
            postcode: '050001',
            country: 'CO',
            email: '',
            phone: '+57 300 1234567',
          },
          meta_data: [
            { key: 'billing_type_document', value: '13' },
            { key: 'billing_identification', value: customer.documentNumber },
          ],
          line_items: [
            {
              id: 1,
              product_id: 7000,
              variation_id: 7001,
              name: 'Producto A reopen',
              sku: first.sku,
              quantity: 2,
              price: '100000.00',
              subtotal: '200000.00',
              total: '200000.00',
              tax_class: '',
            },
          ],
          coupon_lines: [],
          shipping_lines: [],
        },
      }),
    });
  };

  // La tienda sigue en fallido: es un cambio que no toca el estado, así que no revierte la reapertura.
  expectStatus(
    await webhook('failed', '2026-11-05T08:30:00'),
    200,
    'Webhook de un pedido reabierto',
  );
  const stillReopened = await prisma.orderOperation.findUniqueOrThrow({
    where: { id: local.id },
    select: { status: true, reopenedAt: true },
  });
  assert(
    stillReopened.status === 'PENDING',
    `El webhook no debía revertir la reapertura, dejó ${stillReopened.status}.`,
  );
  assert(stillReopened.reopenedAt, 'El webhook no debía borrar la marca de reapertura.');

  // El comercial agrega un producto antes de cerrar: la línea que ya existía debe conservar su `id`
  // y la nueva debe viajar con `product_id`.
  const patched = await api(`/api/orders/${local.id}`, cookie, {
    method: 'PATCH',
    body: JSON.stringify({
      ...payload,
      items: [
        { productId: first.id, quantity: 3 },
        { productId: third.id, quantity: 1 },
      ],
    }),
  });
  expectStatus(patched, 200, 'Editar el pedido reabierto');

  const completed = await api(`/api/orders/${local.id}/complete`, cookie, { method: 'POST' });
  expectStatus(completed, 201, 'Completar el pedido reabierto');
  const completedBody = (await completed.json()) as { status?: string };
  assert(completedBody.status === 'COMPLETED', 'Completar debía dejar la operación en COMPLETED.');

  assert(updates.length === 1, `Se esperaba un PUT a WooCommerce, llegaron ${updates.length}.`);
  const sent = updates[0]!;
  assert(
    sent.status === 'completed',
    `El PUT debía cerrar el pedido, envió ${String(sent.status)}.`,
  );
  assert(sent.set_paid === true, 'El PUT debía marcar el pedido como pagado.');
  const lines = sent.line_items as Array<Record<string, unknown>>;
  // Dos productos y el borrado de la línea que sobraba.
  assert(lines.length === 3, `El PUT debía enviar tres entradas, envió ${lines.length}.`);
  const matched = lines.find((line) => line.id !== undefined);
  assert(
    matched?.id === existingLineId,
    `La línea existente debía conservar su id ${existingLineId}, envió ${String(matched?.id)}.`,
  );
  assert(matched?.quantity === 3, 'La línea existente debía actualizar su cantidad a 3.');
  const added = lines.find((line) => line.id === undefined);
  assert(
    added?.product_id === Number(third.wooVariationId),
    `La línea nueva debía viajar con product_id ${String(third.wooVariationId)}.`,
  );
  assert(!(added && 'variation_id' in added), 'Un producto simple no debe enviar variation_id.');

  /**
   * Y la línea que la tienda tenía de más viaja para borrarse. Sin esto el pedido se queda con las
   * referencias viejas: WooCommerce solo toca las líneas que llegan en el arreglo.
   */
  const removed = lines.find((line) => line.id === orphanLineId);
  assert(removed, `El PUT debía incluir el borrado de la línea ${orphanLineId}.`);
  assert(
    removed?.quantity === 0,
    `El borrado debía viajar con quantity 0, envió ${String(removed?.quantity)}.`,
  );
  assert(
    !('product_id' in removed) && !('subtotal' in removed),
    'Una línea de borrado solo lleva su id y la cantidad en cero.',
  );

  // La tienda queda con las líneas que el CRM tiene, ni una más.
  const storeLineCount: number = createdInWoo.line_items.length;
  assert(
    storeLineCount === 2,
    `La tienda debía quedar con dos líneas, quedó con ${storeLineCount}.`,
  );
  assert(
    !createdInWoo.line_items.some((line) => line.id === orphanLineId),
    'La línea que sobraba debía haberse borrado en la tienda.',
  );

  /**
   * El envío también se reemplaza. Si el pedido venía cobrando envío y el comercial lo pasó a gratis
   * (o al revés), reenviar el `id` del envío existente cambia su importe en vez de agregar otro: si
   * se agregara, el pedido cobraría dos envíos y el cliente reclamaría.
   */
  const shipping = sent.shipping_lines as Array<Record<string, unknown>> | undefined;
  assert(shipping?.length === 1, `El PUT debía enviar un envío, envió ${shipping?.length ?? 0}.`);
  assert(
    shipping[0]?.id === existingShippingLineId,
    `El envío debía conservar su id ${existingShippingLineId}, envió ${String(shipping[0]?.id)}.`,
  );
  assert(
    shipping[0]?.total === '12000.00',
    `El envío debía reemplazar el importe con 12000.00, envió ${String(shipping[0]?.total)}.`,
  );
  assert(
    shipping[0]?.method_id === 'custom',
    `El envío debía tomar el método del CRM, envió ${String(shipping[0]?.method_id)}.`,
  );

  /**
   * Un pedido que la tienda dejó esperando. El pago falló en la pasarela, el cliente terminó pagando
   * con el asesor y hay que reemplazar una referencia por otra del mismo valor. Antes la operación
   * quedaba congelada: se editaba en el CRM pero nunca llegaba a la tienda, porque completar solo se
   * ofrecía a los pedidos del CRM o a los reabiertos, y completar es lo que dispara la sincronización.
   */
  const holdPayload = { ...payload, items: [{ productId: third.id, quantity: 1 }] };
  const holdResponse = await api('/api/orders', cookie, {
    method: 'POST',
    body: JSON.stringify(holdPayload),
  });
  expectStatus(holdResponse, 201, 'Crear el pedido que quedará en espera');
  const hold = (await holdResponse.json()) as { id: number };
  expectStatus(
    await api(`/api/orders/${hold.id}/complete`, cookie, { method: 'POST' }),
    201,
    'Cerrar el pedido antes de simular la tienda',
  );

  // La tienda lo deja en espera: la operación sigue pendiente y el pedido dice `on-hold`. Se
  // reproduce el estado que deja el webhook para no depender de su firma en esta prueba.
  await prisma.orderOperation.update({
    where: { id: hold.id },
    data: { source: 'WOOCOMMERCE', status: 'PENDING', reopenedAt: null, reopenedByUserId: null },
  });
  await prisma.order.updateMany({
    where: { operationId: hold.id },
    data: { wooStatus: 'on-hold' },
  });

  const listed = await api('/api/orders?page=1&pageSize=50', cookie);
  expectStatus(listed, 200, 'Listar pedidos');
  const listedBody = (await listed.json()) as {
    data: Array<{ operationId: number; completionAllowed?: boolean }>;
  };
  const holdRow = listedBody.data.find((row) => row.operationId === hold.id);
  assert(holdRow, 'El pedido en espera debía aparecer en el listado.');
  assert(
    holdRow?.completionAllowed === true,
    'El listado debía ofrecer completar el pedido que la tienda dejó en espera.',
  );

  expectStatus(
    await api(`/api/orders/${hold.id}/complete`, cookie, { method: 'POST' }),
    201,
    'Completar el pedido que la tienda dejó en espera',
  );
  const holdUpdate = updates.at(-1)!;
  assert(
    holdUpdate.status === 'completed',
    `El PUT debía cerrar el pedido en espera, envió ${String(holdUpdate.status)}.`,
  );
  assert(holdUpdate.set_paid === true, 'El PUT debía marcar pagado el pedido en espera.');

  // El corte también protege aquí: un pedido anterior a la fecha ya es historial.
  await prisma.orderOperation.update({
    where: { id: hold.id },
    data: { status: 'PENDING' },
  });
  process.env.ORDERS_REOPEN_FROM = '2099-01-01';
  const beforeCutoff = updates.length;
  try {
    const tooOld = await api(`/api/orders/${hold.id}/complete`, cookie, { method: 'POST' });
    expectStatus(tooOld, 409, 'Completar un pedido en espera anterior al corte');
    const tooOldBody = (await tooOld.json()) as { error?: { code?: string } };
    assert(
      tooOldBody.error?.code === 'ORDER_NOT_COMPLETABLE',
      `Se esperaba ORDER_NOT_COMPLETABLE, llegó ${tooOldBody.error?.code}.`,
    );
    assert(
      updates.length === beforeCutoff,
      'Un pedido fuera del corte no debía llegar a WooCommerce.',
    );
  } finally {
    delete process.env.ORDERS_REOPEN_FROM;
  }

  /**
   * El corte de reapertura protege el historial: con la fecha adelantada, un pedido que ya era
   * cancelado no se puede reabrir aunque esté en la tienda.
   */
  await prisma.orderOperation.update({
    where: { id: local.id },
    data: { status: 'CANCELLED', reopenedAt: null, reopenedByUserId: null },
  });
  process.env.ORDERS_REOPEN_FROM = '2099-01-01';
  try {
    const closedResponse = await api(`/api/orders/${local.id}/reopen`, cookie, { method: 'POST' });
    expectStatus(closedResponse, 409, 'Reabrir un pedido anterior al corte');
    const closedBody = (await closedResponse.json()) as {
      error?: { code?: string; message?: string };
    };
    assert(
      closedBody.error?.code === 'ORDER_REOPEN_CLOSED',
      `Se esperaba ORDER_REOPEN_CLOSED, llegó ${closedBody.error?.code}.`,
    );
    assert(
      closedBody.error?.message?.includes('01/01/2099'),
      `El mensaje debía nombrar el corte, dijo: ${closedBody.error?.message}`,
    );
  } finally {
    delete process.env.ORDERS_REOPEN_FROM;
  }

  console.log('orders-reopen-smoke: ok');
} finally {
  // El borrado que hace la app limpia las entregas del webhook; este test borra la operación
  // directamente, así que las quita a mano para no dejar filas apuntando a un pedido inexistente.
  if (webhookDeliveryIds.length > 0) {
    await prisma.wooOrderDelivery.deleteMany({ where: { deliveryId: { in: webhookDeliveryIds } } });
  }
  if (customerId !== null) {
    await prisma.orderOperation.deleteMany({ where: { customerId } });
  }
  await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  await prisma.customer.deleteMany({ where: { id: customerId ?? -1 } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await app.close();
  wooServer.close();
}
