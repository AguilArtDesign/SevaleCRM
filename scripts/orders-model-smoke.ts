import '../apps/api/src/config/load-environment.js';
import { rolePermissions } from '../packages/permissions/src/index.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import {
  OperationStatus,
  OrderSource,
  OrderSyncStatus,
  Store,
  WebhookDeliveryStatus,
} from '../apps/api/src/generated/prisma/client.js';

const prisma = new PrismaService();
await prisma.$connect();

const suffix = Date.now().toString();
let userId: string | null = null;
let customerId: number | null = null;
let productId: number | null = null;
let operationId: number | null = null;
let deliveryId: number | null = null;
let notificationId: number | null = null;

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

try {
  const commercial = rolePermissions.COMMERCIAL as readonly string[];
  const logistics = rolePermissions.LOGISTICS as readonly string[];
  if (
    !rolePermissions.ADMIN.includes('orders.delete') ||
    !commercial.includes('orders.read') ||
    !commercial.includes('orders.create') ||
    !commercial.includes('orders.update') ||
    !commercial.includes('orders.complete') ||
    !commercial.includes('orders.shipping.update') ||
    !commercial.includes('orders.siigo_quote.create') ||
    !commercial.includes('orders.sync.retry') ||
    commercial.includes('orders.delete') ||
    !logistics.includes('orders.read') ||
    !logistics.includes('orders.shipping.update') ||
    logistics.some((permission) =>
      ['orders.create', 'orders.update', 'orders.complete', 'orders.delete'].includes(permission),
    )
  ) {
    throw new Error('La matriz RBAC de Pedidos no coincide con la definición aprobada.');
  }

  const user = await prisma.user.create({
    data: {
      name: 'Usuario Pedidos Smoke',
      email: `orders-user-${suffix}@example.invalid`,
      emailVerified: true,
      role: 'COMMERCIAL',
    },
  });
  userId = user.id;

  const customer = await prisma.customer.create({
    data: {
      personType: 'PERSON',
      firstName: 'Cliente',
      lastName: 'Pedidos',
      displayName: 'Cliente Pedidos',
      documentType: '13',
      documentNumber: `ORD-${suffix}`,
      fiscalResponsibilities: ['R-99-PN'],
    },
  });
  customerId = customer.id;

  const product = await prisma.product.create({
    data: {
      siigoId: `siigo-order-${suffix}`,
      sku: `ORDER-${suffix}`,
      siigoPriceCop: 127000,
      siigoPriceUsd: 50,
      siigoStock: 5,
      store: Store.SERATUS,
      wooParentId: BigInt(8800),
      wooVariationId: BigInt(8801),
      wooSku: `ORDER-${suffix}`,
      wooPriceCop: 127000,
      wooPriceUsd: 50,
      wooStock: 5,
      syncStatus: 'SYNCED',
      productName: 'Producto Pedidos Smoke',
    },
  });
  productId = product.id;

  const operation = await prisma.orderOperation.create({
    data: {
      operationCode: `OP${suffix}`,
      source: OrderSource.CRM,
      status: OperationStatus.PENDING,
      customerId: customer.id,
      createdByUserId: user.id,
      currency: 'COP',
      subtotal: 127000,
      discountTotal: 7000,
      shippingTotal: 10000,
      total: 130000,
      billingFirstName: customer.firstName,
      billingLastName: customer.lastName,
      billingCountry: 'CO',
      shippingFirstName: customer.firstName,
      shippingLastName: customer.lastName,
      shippingCountry: 'CO',
      orders: {
        create: {
          store: Store.SERATUS,
          syncStatus: OrderSyncStatus.PENDING,
          subtotal: 127000,
          discountTotal: 7000,
          shippingTotal: 10000,
          total: 130000,
          items: {
            create: {
              productId: product.id,
              skuSnapshot: product.sku,
              nameSnapshot: product.productName,
              storeSnapshot: product.store,
              quantity: 1,
              originalPrice: 127000,
              unitPrice: 120000,
              priceModified: true,
              subtotal: 127000,
              discountTotal: 7000,
              total: 120000,
            },
          },
          coupons: { create: { code: 'SMOKE', discountTotal: 7000 } },
        },
      },
      shipment: {
        create: {
          carrier: 'Transportadora Smoke',
          trackingNumber: `TRACK-${suffix}`,
          status: 'CREATED',
          events: {
            create: { status: 'CREATED', note: 'Evento inicial', createdByUserId: user.id },
          },
        },
      },
      siigoQuotation: {
        create: { status: 'PENDING', exchangeRate: '4000.123456' },
      },
    },
    include: {
      orders: { include: { items: true, coupons: true } },
      shipment: { include: { events: true } },
      siigoQuotation: true,
    },
  });
  operationId = operation.id;

  const order = operation.orders[0];
  if (
    !order ||
    order.items[0]?.productId !== product.id ||
    order.items[0]?.skuSnapshot !== product.sku ||
    order.coupons[0]?.code !== 'SMOKE' ||
    operation.shipment?.events[0]?.createdByUserId !== user.id ||
    operation.siigoQuotation?.operationId !== operation.id
  ) {
    throw new Error('El grafo de Operation, Order, Items, Shipment y Siigo no se guardó completo.');
  }

  const delivery = await prisma.wooOrderDelivery.create({
    data: {
      deliveryId: `delivery-${suffix}`,
      store: Store.SERATUS,
      event: 'order.created',
      wooOrderId: BigInt(9000),
      orderId: order.id,
      status: WebhookDeliveryStatus.PROCESSED,
      processedAt: new Date(),
    },
  });
  deliveryId = delivery.id;

  const notification = await prisma.notification.create({
    data: {
      type: 'ORDER_OPERATION_CREATED',
      title: 'Nueva operación',
      message: operation.operationCode,
      orderOperationId: operation.id,
      requiredPermission: 'orders.read',
    },
  });
  notificationId = notification.id;

  let duplicateStoreRejected = false;
  try {
    await prisma.order.create({
      data: {
        operationId: operation.id,
        store: Store.SERATUS,
        subtotal: 0,
        discountTotal: 0,
        shippingTotal: 0,
        total: 0,
      },
    });
  } catch (error) {
    duplicateStoreRejected = isUniqueConstraintError(error);
  }
  if (!duplicateStoreRejected) {
    throw new Error('La base de datos permitió dos Orders de la misma tienda en una Operation.');
  }

  let duplicateDeliveryRejected = false;
  try {
    await prisma.wooOrderDelivery.create({
      data: {
        deliveryId: `delivery-${suffix}`,
        store: Store.PALI,
        event: 'order.updated',
      },
    });
  } catch (error) {
    duplicateDeliveryRejected = isUniqueConstraintError(error);
  }
  if (!duplicateDeliveryRejected) {
    throw new Error('La base de datos permitió procesar dos veces el mismo deliveryId.');
  }

  process.stdout.write(
    'Orders model smoke: RBAC, operation graph, snapshots, store uniqueness, webhook idempotency, shipment, quotation and notification checks passed.\n',
  );
} finally {
  if (notificationId !== null) {
    await prisma.notification.deleteMany({ where: { id: notificationId } });
  }
  if (deliveryId !== null) {
    await prisma.wooOrderDelivery.deleteMany({ where: { id: deliveryId } });
  }
  if (operationId !== null) {
    await prisma.orderOperation.deleteMany({ where: { id: operationId } });
  }
  if (productId !== null) await prisma.product.deleteMany({ where: { id: productId } });
  if (customerId !== null) await prisma.customer.deleteMany({ where: { id: customerId } });
  if (userId !== null) await prisma.user.deleteMany({ where: { id: userId } });
  await prisma.$disconnect();
}
