import '../apps/api/src/config/load-environment.js';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../apps/api/src/app.module.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { Store } from '../apps/api/src/generated/prisma/client.js';

process.env.BETTER_AUTH_SECRET ||= 'local-woo-orders-smoke-secret-at-least-32-characters';
const originalApiKey = process.env.N8N_API_KEY;
const apiKey = `woo-orders-${randomUUID()}`;
process.env.N8N_API_KEY = apiKey;

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
  logger: false,
});
app.setGlobalPrefix('api');
await app.listen(0, '127.0.0.1');

const prisma = app.get(PrismaService);
const baseUrl = await app.getUrl();
const runId = randomUUID();
const documentNumber = String(Date.now()).slice(-10);
const wooOrderId = String(Date.now());
const operationIds: number[] = [];
const productIds: number[] = [];
let customerId: number | null = null;

async function expectStatus(response: Response, status: number, context: string) {
  if (response.status !== status) {
    throw new Error(
      `${context}: se esperaba ${status} y se recibió ${response.status}: ${await response.text()}`,
    );
  }
}

function post(payload: unknown, authorization = `Bearer ${apiKey}`) {
  return fetch(`${baseUrl}/api/integrations/woocommerce/orders`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization },
    body: JSON.stringify(payload),
  });
}

function orderPayload({
  provider = 'SERATUS',
  event = 'order.created',
  deliveryId = randomUUID(),
  orderId = wooOrderId,
  customerId: wooCustomerId = 0,
  status = 'processing',
  sku,
  productId,
  variationId,
  total = '195000.00',
  modified = '2026-09-17T15:00:00',
}: {
  provider?: 'SERATUS' | 'PALI';
  event?: 'order.created' | 'order.updated';
  deliveryId?: string;
  orderId?: string;
  customerId?: number;
  status?: string;
  sku: string;
  productId: number;
  variationId: number;
  total?: string;
  modified?: string;
}) {
  return {
    provider,
    event,
    deliveryId,
    order: {
      id: orderId,
      status,
      currency: 'COP',
      date_created: '2026-09-17T14:00:00',
      date_modified: modified,
      customer_id: wooCustomerId,
      discount_total: '10000.00',
      shipping_total: '5000.00',
      total,
      payment_method: 'bacs',
      payment_method_title: 'Transferencia bancaria',
      billing: {
        first_name: 'ÁNGELA MARÍA',
        last_name: 'PÉREZ LÓPEZ',
        company: '',
        address_1: 'Calle 10 # 20-30',
        address_2: 'Apto 4',
        city: 'Medellín',
        state: 'ANT',
        postcode: '050001',
        country: 'CO',
        email: `woo-order-${runId}@example.invalid`,
        phone: '+57 300 1234567',
      },
      shipping: {
        first_name: 'Ángela María',
        last_name: 'Pérez López',
        company: '',
        address_1: 'Carrera 40 # 30-20',
        address_2: '',
        city: 'Medellín',
        state: 'ANT',
        postcode: '050002',
        country: 'CO',
        email: '',
        phone: '+57 300 1234567',
      },
      meta_data: [
        { key: 'billing_type_document', value: '13' },
        { key: 'billing_identification', value: documentNumber },
      ],
      line_items: [
        {
          id: 1,
          product_id: productId,
          variation_id: variationId,
          name: 'Producto Woo inbound',
          sku,
          quantity: 2,
          price: '100000.00',
          subtotal: '200000.00',
          total: status === 'completed' ? '180000.00' : '190000.00',
          tax_class: '',
        },
      ],
      coupon_lines: [{ code: 'WEB10', discount: '10000.00' }],
      shipping_lines: [
        { method_id: 'flat_rate', method_title: 'Envío nacional', total: '5000.00' },
      ],
    },
  };
}

try {
  const seratusSku = `WOO-INBOUND-S-${runId}`;
  const seratus = await prisma.product.create({
    data: {
      siigoId: `siigo-${seratusSku}`,
      sku: seratusSku,
      siigoPriceCop: 100000,
      siigoPriceUsd: 25,
      siigoStock: 5,
      store: Store.SERATUS,
      wooParentId: 9100n,
      wooVariationId: 9101n,
      wooSku: seratusSku,
      wooPriceCop: 100000,
      wooPriceUsd: 25,
      wooStock: 5,
      syncStatus: 'SYNCED',
      productName: 'Producto Woo inbound Seratus',
    },
  });
  productIds.push(seratus.id);

  const deliveryId = randomUUID();
  const createPayload = orderPayload({
    deliveryId,
    sku: seratusSku,
    productId: 9100,
    variationId: 9101,
  });
  await expectStatus(await post(createPayload, ''), 401, 'Webhook sin autenticación');
  await expectStatus(await post({ ...createPayload, arbitrary: true }), 400, 'Payload arbitrario');

  const createResponse = await post(createPayload);
  await expectStatus(createResponse, 200, 'Importación order.created');
  const created = (await createResponse.json()) as {
    success: boolean;
    operationId: number;
    orderId: number;
    created: boolean;
    duplicate: boolean;
  };
  operationIds.push(created.operationId);
  if (!created.success || !created.created || created.duplicate) {
    throw new Error('order.created no informó una importación nueva.');
  }

  const operation = await prisma.orderOperation.findUniqueOrThrow({
    where: { id: created.operationId },
    include: {
      customer: { include: { integrations: true } },
      orders: { include: { items: true } },
    },
  });
  customerId = operation.customerId;
  const importedOrder = operation.orders[0];
  if (
    operation.source !== 'WOOCOMMERCE' ||
    operation.status !== 'PENDING' ||
    operation.operationCode !== `WC-S-${wooOrderId}` ||
    operation.customer.documentNumber !== documentNumber ||
    operation.customer.firstName !== 'Ángela María' ||
    operation.customer.region !== 'CO-ANT' ||
    !operation.customer.cityCode ||
    importedOrder?.wooOrderId?.toString() !== wooOrderId ||
    importedOrder.syncStatus !== 'SYNCED' ||
    importedOrder.items[0]?.productId !== seratus.id ||
    importedOrder.items[0]?.skuSnapshot !== seratusSku ||
    Number(operation.total) !== 195000
  ) {
    throw new Error(
      `El pedido Woo no conservó Customer, snapshots, mapping o totales: ${JSON.stringify({
        source: operation.source,
        status: operation.status,
        operationCode: operation.operationCode,
        customer: {
          documentNumber: operation.customer.documentNumber,
          firstName: operation.customer.firstName,
          region: operation.customer.region,
          cityCode: operation.customer.cityCode,
        },
        order: importedOrder
          ? {
              wooOrderId: importedOrder.wooOrderId?.toString(),
              syncStatus: importedOrder.syncStatus,
              productId: importedOrder.items[0]?.productId,
              sku: importedOrder.items[0]?.skuSnapshot,
            }
          : null,
        total: Number(operation.total),
      })}`,
    );
  }
  if (
    operation.customer.integrations.find(({ provider }) => provider === 'SERATUS')?.externalId !==
    null
  ) {
    throw new Error('El checkout invitado creó una vinculación Woo inexistente.');
  }

  const duplicateResponse = await post(createPayload);
  await expectStatus(duplicateResponse, 200, 'Entrega duplicada');
  const duplicate = (await duplicateResponse.json()) as { duplicate: boolean };
  if (!duplicate.duplicate) throw new Error('El deliveryId duplicado no fue reconocido.');
  if (
    (await prisma.order.count({
      where: { store: 'SERATUS', wooOrderId: BigInt(wooOrderId) },
    })) !== 1
  ) {
    throw new Error('El retry duplicó el pedido Woo.');
  }

  const updatePayload = orderPayload({
    event: 'order.updated',
    deliveryId: randomUUID(),
    status: 'completed',
    total: '185000.00',
    modified: '2026-09-17T16:00:00',
    sku: seratusSku,
    productId: 9100,
    variationId: 9101,
  });
  const updateResponse = await post(updatePayload);
  await expectStatus(updateResponse, 200, 'Actualización order.updated');
  const updated = (await updateResponse.json()) as { operationId: number; created: boolean };
  if (updated.operationId !== created.operationId || updated.created) {
    throw new Error('order.updated creó una Operation distinta.');
  }
  const afterUpdate = await prisma.orderOperation.findUniqueOrThrow({
    where: { id: created.operationId },
    include: { orders: { include: { items: true } } },
  });
  if (
    afterUpdate.status !== 'COMPLETED' ||
    Number(afterUpdate.total) !== 185000 ||
    Number(afterUpdate.orders[0]?.items[0]?.discountTotal) !== 20000
  ) {
    throw new Error('order.updated no actualizó estado, total o líneas.');
  }

  const staleResponse = await post(
    orderPayload({
      event: 'order.updated',
      deliveryId: randomUUID(),
      status: 'cancelled',
      modified: '2026-09-17T15:30:00',
      sku: seratusSku,
      productId: 9100,
      variationId: 9101,
    }),
  );
  await expectStatus(staleResponse, 200, 'Evento antiguo');
  const stale = (await staleResponse.json()) as { stale: boolean };
  if (!stale.stale) throw new Error('El evento antiguo no fue marcado como obsoleto.');
  if (
    (await prisma.orderOperation.findUniqueOrThrow({ where: { id: created.operationId } }))
      .status !== 'COMPLETED'
  ) {
    throw new Error('Un evento antiguo revirtió el estado de la Operation.');
  }

  const paliSku = `WOO-INBOUND-P-${runId}`;
  const failedDeliveryId = randomUUID();
  const paliPayload = orderPayload({
    provider: 'PALI',
    event: 'order.updated',
    deliveryId: failedDeliveryId,
    orderId: String(Number(wooOrderId) + 1),
    customerId: 888,
    sku: paliSku,
    productId: 9200,
    variationId: 9201,
  });
  await expectStatus(await post(paliPayload), 400, 'Producto Woo no vinculado');
  const failedDelivery = await prisma.wooOrderDelivery.findUniqueOrThrow({
    where: { deliveryId: failedDeliveryId },
  });
  if (failedDelivery.status !== 'ERROR' || failedDelivery.errorCode !== 'WOO_PRODUCT_NOT_LINKED') {
    throw new Error('La entrega fallida no conservó su diagnóstico.');
  }

  const pali = await prisma.product.create({
    data: {
      siigoId: `siigo-${paliSku}`,
      sku: paliSku,
      siigoPriceCop: 100000,
      siigoPriceUsd: 25,
      siigoStock: 5,
      store: Store.PALI,
      wooParentId: 9200n,
      wooVariationId: 9201n,
      wooSku: paliSku,
      wooPriceCop: 100000,
      wooPriceUsd: 25,
      wooStock: 5,
      syncStatus: 'SYNCED',
      productName: 'Producto Woo inbound Pali',
    },
  });
  productIds.push(pali.id);
  const retryResponse = await post(paliPayload);
  await expectStatus(retryResponse, 200, 'Retry de entrega fallida');
  const retried = (await retryResponse.json()) as { operationId: number; created: boolean };
  operationIds.push(retried.operationId);
  if (!retried.created) throw new Error('El retry no importó el order.updated fuera de orden.');
  const paliOperation = await prisma.orderOperation.findUniqueOrThrow({
    where: { id: retried.operationId },
    include: { orders: true },
  });
  if (
    paliOperation.customerId !== customerId ||
    paliOperation.orders[0]?.store !== 'PALI' ||
    paliOperation.orders[0]?.wooOrderId?.toString() !== String(Number(wooOrderId) + 1)
  ) {
    throw new Error('El upsert fuera de orden no reutilizó Customer o mapping de tienda.');
  }
  const paliIntegration = await prisma.customerIntegration.findUniqueOrThrow({
    where: { customerId_provider: { customerId, provider: 'PALI' } },
  });
  if (paliIntegration.externalId !== '888' || paliIntegration.status !== 'SYNCED') {
    throw new Error('El pedido autenticado no recordó el customer_id de Pali.');
  }

  console.log(
    'Woo orders inbound smoke: auth, guest checkout, Customer/Product resolution, snapshots, create/update upsert, stale events, retries and delivery idempotency checks passed.',
  );
} finally {
  if (operationIds.length > 0) {
    await prisma.notification.deleteMany({ where: { orderOperationId: { in: operationIds } } });
  }
  await prisma.wooOrderDelivery.deleteMany({
    where: {
      store: { in: ['SERATUS', 'PALI'] },
      wooOrderId: { in: [BigInt(wooOrderId), BigInt(wooOrderId) + 1n] },
    },
  });
  if (operationIds.length > 0) {
    await prisma.orderOperation.deleteMany({ where: { id: { in: operationIds } } });
  }
  if (customerId) await prisma.customer.deleteMany({ where: { id: customerId } });
  if (productIds.length > 0) await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  process.env.N8N_API_KEY = originalApiKey;
  await app.close();
}
