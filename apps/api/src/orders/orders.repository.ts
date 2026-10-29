import { Injectable } from '@nestjs/common';
import type { OrderListQuery, UpdateShipmentInput } from '@sevale/validation';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PreparedOperation, PreparedStoreOrder } from './orders.types.js';

export const orderDetailInclude = {
  customer: true,
  createdBy: { select: { id: true, name: true, email: true } },
  updatedBy: { select: { id: true, name: true, email: true } },
  orders: {
    orderBy: { store: 'asc' as const },
    include: {
      items: {
        orderBy: { id: 'asc' as const },
        include: {
          product: {
            select: {
              id: true,
              sku: true,
              productName: true,
              store: true,
              imageUrl: true,
            },
          },
        },
      },
      coupons: { orderBy: { id: 'asc' as const } },
    },
  },
  shipment: {
    include: {
      events: {
        orderBy: { createdAt: 'asc' as const },
        include: { createdBy: { select: { id: true, name: true, email: true } } },
      },
      storeSyncs: { orderBy: { store: 'asc' as const } },
    },
  },
  siigoQuotation: true,
} as const;

export type OrderOperationDetail = Prisma.OrderOperationGetPayload<{
  include: typeof orderDetailInclude;
}>;

/** Datos de la operación que acompañan a cada pedido de tienda en el historial del cliente. */
const customerOrderOperationSelect = {
  id: true,
  operationCode: true,
  source: true,
  status: true,
  currency: true,
  createdAt: true,
  updatedAt: true,
  paymentMethod: true,
  paymentMethodTitle: true,
  createdBy: { select: { id: true, name: true, email: true } },
  billingFirstName: true,
  billingLastName: true,
  billingCompany: true,
  billingAddress1: true,
  billingAddress2: true,
  billingCity: true,
  billingState: true,
  billingPostcode: true,
  billingCountry: true,
  billingEmail: true,
  billingPhone: true,
  shippingMethod: true,
  shippingMethodTitle: true,
  shippingFirstName: true,
  shippingLastName: true,
  shippingAddress1: true,
  shippingAddress2: true,
  shippingCity: true,
  shippingState: true,
  shippingPostcode: true,
  shippingCountry: true,
  shippingPhone: true,
} as const;

const outboundOrderInclude = {
  operation: {
    include: {
      customer: { include: { integrations: true } },
    },
  },
  items: {
    orderBy: { id: 'asc' as const },
    include: {
      product: {
        select: {
          id: true,
          store: true,
          wooParentId: true,
          wooVariationId: true,
        },
      },
    },
  },
} as const;

export type OutboundOrder = Prisma.OrderGetPayload<{ include: typeof outboundOrderInclude }>;

type UpdateResult =
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'NOT_EDITABLE' }
  | { outcome: 'CURRENCY_LOCKED' }
  | { outcome: 'UPDATED'; operation: OrderOperationDetail };

type DeleteResult =
  { outcome: 'NOT_FOUND' } | { outcome: 'UPDATED'; operation: OrderOperationDetail };

export type CompleteClaim =
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'NOT_COMPLETABLE' }
  | { outcome: 'ALREADY_COMPLETED' }
  | { outcome: 'CLAIMED'; orderIds: number[] };

export type RetryClaim =
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'NOT_RETRYABLE' }
  | { outcome: 'NOTHING_TO_RETRY' }
  | { outcome: 'CLAIMED'; orderIds: number[] };

export type RetryOrderClaim =
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'NOT_RETRYABLE' }
  | { outcome: 'NOTHING_TO_RETRY' }
  | { outcome: 'CLAIMED'; operationId: number; orderIds: number[] };

export type ShipmentUpdateResult =
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'NOT_ALLOWED' }
  | { outcome: 'UPDATED'; operation: OrderOperationDetail };

const shipmentSyncJobInclude = {
  shipment: {
    include: {
      operation: {
        include: {
          orders: { select: { store: true, wooOrderId: true } },
        },
      },
    },
  },
} as const;

export type ShipmentSyncJob = Prisma.ShipmentStoreSyncGetPayload<{
  include: typeof shipmentSyncJobInclude;
}>;

/**
 * Datos de la operación que necesita una cotización de Siigo: el cliente con su vínculo, y los
 * productos de todas las tiendas de la operación con el SKU que Siigo usa como código.
 */
const quotationOperationInclude = {
  customer: { include: { integrations: true } },
  siigoQuotation: true,
  orders: {
    include: {
      items: {
        orderBy: { id: 'asc' as const },
        include: { product: { select: { id: true, sku: true, productName: true } } },
      },
    },
  },
} as const;

export type QuotationOperation = Prisma.OrderOperationGetPayload<{
  include: typeof quotationOperationInclude;
}>;

const siigoQuotationJobInclude = {
  operation: { include: quotationOperationInclude },
} as const;

export type SiigoQuotationJob = Prisma.SiigoQuotationGetPayload<{
  include: typeof siigoQuotationJobInclude;
}>;

export type QuotationSeller = {
  id: number | null;
  name: string;
  email: string;
};

export type SiigoQuotationClaim =
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'NOT_ALLOWED' }
  | { outcome: 'ALREADY_SYNCED' }
  | { outcome: 'IN_PROGRESS' }
  /** `update` indica que la cotización ya existe en Siigo y hay que actualizarla, no crearla. */
  | { outcome: 'CLAIMED'; quotationId: number; update: boolean };

/**
 * Orden del panel. "createdAt" es la fecha de creación del pedido y no la de la operación: la que
 * registró WooCommerce cuando el pedido ya existe en la tienda y la del CRM mientras tanto. Las
 * demás columnas ordenan por el campo equivalente de la operación.
 */
function orderSort(query: OrderListQuery): Prisma.OrderOrderByWithRelationInput[] {
  if (query.sort === 'total') return [{ total: query.order }, { id: 'desc' }];
  if (query.sort === 'createdAt') return [{ wooCreatedAt: query.order }, { id: 'desc' }];
  return [{ operation: { [query.sort]: query.order } }, { id: 'desc' }];
}

/**
 * Un pedido nace en el CRM o en la tienda, y su fecha de creación es la del sistema que lo registró
 * primero. Al crearlo aquí se guarda la fecha del CRM como provisional en `wooCreatedAt`; cuando el
 * pedido llega a WooCommerce (por el envío o por el webhook) la fecha de la tienda la reemplaza.
 * Tener siempre el valor permite ordenar el historial por la fecha real del pedido.
 */
function orderCreateData(order: PreparedStoreOrder) {
  return {
    store: order.store,
    wooCreatedAt: new Date(),
    subtotal: order.subtotal,
    discountTotal: order.discountTotal,
    shippingTotal: order.shippingTotal,
    total: order.total,
    items: { create: order.items },
    coupons: { create: order.coupons },
  };
}

function operationData(operation: PreparedOperation) {
  return Object.fromEntries(Object.entries(operation).filter(([key]) => key !== 'orders')) as Omit<
    PreparedOperation,
    'orders'
  >;
}

@Injectable()
export class OrdersRepository {
  constructor(private readonly prisma: PrismaService) {}

  findCoupon(id: number) {
    return this.prisma.coupon.findUnique({ where: { id } });
  }

  list(query: OrderListQuery) {
    const numericWooOrderId = /^\d+$/.test(query.search) ? BigInt(query.search) : null;
    const parsedLocalOrderId = Number(query.search);
    const numericLocalOrderId =
      /^\d+$/.test(query.search) &&
      Number.isSafeInteger(parsedLocalOrderId) &&
      parsedLocalOrderId <= 2_147_483_647
        ? parsedLocalOrderId
        : null;
    const operationWhere: Prisma.OrderOperationWhereInput = {
      deletedAt: null,
      ...(query.status ? { status: query.status } : {}),
      ...(query.source ? { source: query.source } : {}),
      ...(query.customerId ? { customerId: query.customerId } : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            createdAt: {
              ...(query.dateFrom ? { gte: query.dateFrom } : {}),
              ...(query.dateTo ? { lte: query.dateTo } : {}),
            },
          }
        : {}),
    };
    const where: Prisma.OrderWhereInput = {
      operation: { is: operationWhere },
      ...(query.store ? { store: query.store } : {}),
      ...(query.search
        ? {
            OR: [
              ...(numericLocalOrderId ? [{ id: numericLocalOrderId }] : []),
              {
                operation: {
                  is: {
                    OR: [
                      { operationCode: { contains: query.search } },
                      {
                        customer: {
                          is: {
                            OR: [
                              { displayName: { contains: query.search } },
                              { firstName: { contains: query.search } },
                              { lastName: { contains: query.search } },
                              { company: { contains: query.search } },
                              { documentNumber: { contains: query.search } },
                              { email: { contains: query.search } },
                            ],
                          },
                        },
                      },
                    ],
                  },
                },
              },
              { items: { some: { skuSnapshot: { contains: query.search } } } },
              ...(numericWooOrderId ? [{ wooOrderId: numericWooOrderId }] : []),
            ],
          }
        : {}),
    };
    const orderBy = orderSort(query);

    return this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy,
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          operation: {
            select: {
              id: true,
              operationCode: true,
              source: true,
              status: true,
              currency: true,
              createdAt: true,
              updatedAt: true,
              // El resumen de la cotización decide qué dice la acción de la fila: crear, actualizar
              // o ver. `externalId` distingue una cotización que ya vive en Siigo.
              siigoQuotation: {
                select: { status: true, externalId: true },
              },
              customer: {
                select: {
                  id: true,
                  displayName: true,
                  // Decide si el nombre se normaliza al leer: una empresa conserva su forma.
                  personType: true,
                  documentType: true,
                  documentNumber: true,
                  email: true,
                },
              },
            },
          },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
  }

  /**
   * Pedidos de tienda del cliente, uno por tienda: es lo que muestra el historial de su detalle y
   * coincide con las filas del panel de Pedidos. Se ordenan por la fecha de creación del pedido, la
   * misma que muestra la columna Fecha.
   */
  customerOrders(customerId: number, page: number, pageSize: number) {
    const where: Prisma.OrderWhereInput = { operation: { is: { customerId, deletedAt: null } } };

    return this.prisma.$transaction([
      this.prisma.order.findMany({
        where,
        orderBy: [{ wooCreatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          operation: { select: customerOrderOperationSelect },
          items: {
            orderBy: { id: 'asc' as const },
            include: {
              product: {
                select: {
                  id: true,
                  sku: true,
                  productName: true,
                  store: true,
                  imageUrl: true,
                },
              },
            },
          },
          coupons: { orderBy: { id: 'asc' as const } },
        },
      }),
      this.prisma.order.count({ where }),
    ]);
  }

  /**
   * Resumen del historial en una sola consulta: cuántos pedidos de tienda tiene el cliente y cuánto
   * ha comprado en pedidos completados. Se agrupa por moneda porque los totales no se suman entre sí.
   */
  customerOrdersSummary(customerId: number) {
    return this.prisma.$transaction([
      this.prisma.order.count({ where: { operation: { is: { customerId, deletedAt: null } } } }),
      this.prisma.orderOperation.groupBy({
        by: ['currency'],
        where: { customerId, deletedAt: null, status: 'COMPLETED' },
        _sum: { total: true },
        orderBy: { currency: 'asc' },
      }),
    ]);
  }

  detail(id: number) {
    return this.prisma.orderOperation.findFirst({
      where: { id, deletedAt: null },
      include: orderDetailInclude,
    });
  }

  findCustomer(id: number) {
    return this.prisma.customer.findFirst({ where: { id, deletedAt: null } });
  }

  findProducts(ids: number[]) {
    return this.prisma.product.findMany({ where: { id: { in: ids } } });
  }

  claimCompletion(id: number, completedByUserId: string): Promise<CompleteClaim> {
    return this.prisma.$transaction(async (transaction) => {
      const operation = await transaction.orderOperation.findFirst({
        where: { id, deletedAt: null },
        select: { source: true, status: true },
      });
      if (!operation) return { outcome: 'NOT_FOUND' };
      if (operation.source !== 'CRM' || operation.status === 'CANCELLED') {
        return { outcome: 'NOT_COMPLETABLE' };
      }
      if (operation.status === 'COMPLETED') return { outcome: 'ALREADY_COMPLETED' };

      const completed = await transaction.orderOperation.updateMany({
        where: { id, source: 'CRM', status: 'PENDING', deletedAt: null },
        data: {
          status: 'COMPLETED',
          // Completar también modifica la operación: cuenta como última modificación de esta persona.
          updatedByUserId: completedByUserId,
          updatedByAt: new Date(),
        },
      });
      if (completed.count === 0) return { outcome: 'ALREADY_COMPLETED' };

      await transaction.order.updateMany({
        where: { operationId: id, wooOrderId: null, syncStatus: { in: ['PENDING', 'ERROR'] } },
        data: {
          syncStatus: 'SYNCING',
          lastSyncErrorCode: null,
          lastSyncErrorMessage: null,
        },
      });
      const orders = await transaction.order.findMany({
        where: { operationId: id, wooOrderId: null, syncStatus: 'SYNCING' },
        select: { id: true },
      });
      return { outcome: 'CLAIMED', orderIds: orders.map(({ id: orderId }) => orderId) };
    });
  }

  claimRetry(id: number): Promise<RetryClaim> {
    return this.prisma.$transaction(async (transaction) => {
      const operation = await transaction.orderOperation.findFirst({
        where: { id, deletedAt: null },
        select: { source: true, status: true },
      });
      if (!operation) return { outcome: 'NOT_FOUND' };
      if (operation.source !== 'CRM' || operation.status !== 'COMPLETED') {
        return { outcome: 'NOT_RETRYABLE' };
      }
      const retryable = await transaction.order.findMany({
        where: { operationId: id, wooOrderId: null, syncStatus: 'ERROR' },
        select: { id: true },
      });
      if (retryable.length === 0) return { outcome: 'NOTHING_TO_RETRY' };
      const orderIds: number[] = [];
      for (const { id: orderId } of retryable) {
        const claimed = await transaction.order.updateMany({
          where: { id: orderId, wooOrderId: null, syncStatus: 'ERROR' },
          data: {
            syncStatus: 'SYNCING',
            lastSyncErrorCode: null,
            lastSyncErrorMessage: null,
          },
        });
        if (claimed.count === 1) orderIds.push(orderId);
      }
      if (orderIds.length === 0) return { outcome: 'NOTHING_TO_RETRY' };
      return { outcome: 'CLAIMED', orderIds };
    });
  }

  claimOrderRetry(id: number): Promise<RetryOrderClaim> {
    return this.prisma.$transaction(async (transaction) => {
      const order = await transaction.order.findFirst({
        where: { id, operation: { deletedAt: null } },
        select: {
          id: true,
          operationId: true,
          wooOrderId: true,
          syncStatus: true,
          operation: { select: { source: true, status: true } },
        },
      });
      if (!order) return { outcome: 'NOT_FOUND' };
      if (order.operation.source !== 'CRM' || order.operation.status !== 'COMPLETED') {
        return { outcome: 'NOT_RETRYABLE' };
      }
      if (order.wooOrderId !== null || order.syncStatus !== 'ERROR') {
        return { outcome: 'NOTHING_TO_RETRY' };
      }
      const claimed = await transaction.order.updateMany({
        where: { id, wooOrderId: null, syncStatus: 'ERROR' },
        data: {
          syncStatus: 'SYNCING',
          lastSyncErrorCode: null,
          lastSyncErrorMessage: null,
        },
      });
      if (claimed.count === 0) return { outcome: 'NOTHING_TO_RETRY' };
      return { outcome: 'CLAIMED', operationId: order.operationId, orderIds: [order.id] };
    });
  }

  outboundOrders(ids: number[]): Promise<OutboundOrder[]> {
    return this.prisma.order.findMany({
      where: { id: { in: ids }, wooOrderId: null, syncStatus: 'SYNCING' },
      include: outboundOrderInclude,
    });
  }

  markOrderSynced(
    id: number,
    result: { id: string; status: string; dateCreated: Date | null; dateModified: Date | null },
  ) {
    const syncedAt = new Date();
    return this.prisma.order.updateMany({
      where: { id, wooOrderId: null, syncStatus: 'SYNCING' },
      data: {
        wooOrderId: BigInt(result.id),
        wooStatus: result.status,
        wooCreatedAt: result.dateCreated,
        wooUpdatedAt: result.dateModified,
        syncStatus: 'SYNCED',
        lastSyncAt: syncedAt,
        lastSyncErrorCode: null,
        lastSyncErrorMessage: null,
      },
    });
  }

  markOrderError(id: number, code: string, message: string) {
    return this.prisma.order.updateMany({
      where: { id, wooOrderId: null, syncStatus: 'SYNCING' },
      data: {
        syncStatus: 'ERROR',
        lastSyncAt: new Date(),
        lastSyncErrorCode: code,
        lastSyncErrorMessage: message,
      },
    });
  }

  updateShipment(
    operationId: number,
    input: UpdateShipmentInput,
    createdByUserId: string,
  ): Promise<ShipmentUpdateResult> {
    return this.prisma.$transaction(async (transaction) => {
      const operation = await transaction.orderOperation.findFirst({
        where: { id: operationId, deletedAt: null },
        select: {
          status: true,
          orders: { select: { store: true, wooOrderId: true } },
        },
      });
      if (!operation) return { outcome: 'NOT_FOUND' };
      if (operation.status !== 'COMPLETED') return { outcome: 'NOT_ALLOWED' };

      const shipment = await transaction.shipment.upsert({
        where: { operationId },
        create: {
          operationId,
          carrier: input.carrier,
          trackingNumber: input.trackingNumber,
          status: input.status,
        },
        update: {
          carrier: input.carrier,
          trackingNumber: input.trackingNumber,
          status: input.status,
        },
      });
      await transaction.shipmentEvent.create({
        data: {
          shipmentId: shipment.id,
          status: input.status,
          note: input.note,
          createdByUserId,
        },
      });
      // Asignar el envío es una modificación de la operación, así que también firma la ficha.
      await transaction.orderOperation.update({
        where: { id: operationId },
        data: { updatedByUserId: createdByUserId, updatedByAt: new Date() },
      });
      for (const order of operation.orders) {
        const canSynchronize = order.wooOrderId !== null;
        await transaction.shipmentStoreSync.upsert({
          where: { shipmentId_store: { shipmentId: shipment.id, store: order.store } },
          create: {
            shipmentId: shipment.id,
            store: order.store,
            syncStatus: canSynchronize ? 'PENDING' : 'ERROR',
            lastSyncErrorCode: canSynchronize ? null : 'WOO_ORDER_NOT_CREATED',
            lastSyncErrorMessage: canSynchronize
              ? null
              : `El pedido de ${order.store === 'SERATUS' ? 'Seratus' : 'Pali'} todavía no existe en WooCommerce.`,
          },
          update: {
            syncStatus: canSynchronize ? 'PENDING' : 'ERROR',
            lastSyncErrorCode: canSynchronize ? null : 'WOO_ORDER_NOT_CREATED',
            lastSyncErrorMessage: canSynchronize
              ? null
              : `El pedido de ${order.store === 'SERATUS' ? 'Seratus' : 'Pali'} todavía no existe en WooCommerce.`,
          },
        });
      }
      const updated = await transaction.orderOperation.findUniqueOrThrow({
        where: { id: operationId },
        include: orderDetailInclude,
      });
      return { outcome: 'UPDATED', operation: updated };
    });
  }

  claimShipmentSyncs(shipmentId: number, retry: boolean): Promise<number[]> {
    return this.prisma.$transaction(async (transaction) => {
      const candidates = await transaction.shipmentStoreSync.findMany({
        where: {
          shipmentId,
          syncStatus: retry ? 'ERROR' : { in: ['PENDING', 'ERROR'] },
        },
        select: { id: true },
      });
      const claimedIds: number[] = [];
      for (const { id } of candidates) {
        const claimed = await transaction.shipmentStoreSync.updateMany({
          where: {
            id,
            syncStatus: retry ? 'ERROR' : { in: ['PENDING', 'ERROR'] },
          },
          data: {
            syncStatus: 'SYNCING',
            lastSyncErrorCode: null,
            lastSyncErrorMessage: null,
          },
        });
        if (claimed.count === 1) claimedIds.push(id);
      }
      return claimedIds;
    });
  }

  shipmentSyncJobs(ids: number[]): Promise<ShipmentSyncJob[]> {
    return this.prisma.shipmentStoreSync.findMany({
      where: { id: { in: ids }, syncStatus: 'SYNCING' },
      include: shipmentSyncJobInclude,
    });
  }

  markShipmentStoreSynced(id: number) {
    return this.prisma.shipmentStoreSync.updateMany({
      where: { id, syncStatus: 'SYNCING' },
      data: {
        syncStatus: 'SYNCED',
        lastSyncAt: new Date(),
        lastSyncErrorCode: null,
        lastSyncErrorMessage: null,
      },
    });
  }

  markShipmentStoreError(id: number, code: string, message: string) {
    return this.prisma.shipmentStoreSync.updateMany({
      where: { id, syncStatus: 'SYNCING' },
      data: {
        syncStatus: 'ERROR',
        lastSyncAt: new Date(),
        lastSyncErrorCode: code,
        lastSyncErrorMessage: message,
      },
    });
  }

  /**
   * Toma la cotización para sincronizarla. Si ya existe en Siigo pero el pedido cambió desde
   * entonces —la huella guardada no coincide con la actual—, se reclama para actualizarla en vez de
   * darla por buena: la cotización de Siigo seguiría con los productos anteriores.
   */
  claimSiigoQuotation(operationId: number, fingerprint: string): Promise<SiigoQuotationClaim> {
    return this.prisma.$transaction(async (transaction) => {
      const operation = await transaction.orderOperation.findFirst({
        where: { id: operationId, deletedAt: null },
        select: { status: true, siigoQuotation: true },
      });
      if (!operation) return { outcome: 'NOT_FOUND' };
      if (operation.status === 'CANCELLED') return { outcome: 'NOT_ALLOWED' };
      if (operation.siigoQuotation?.status === 'SYNCING') return { outcome: 'IN_PROGRESS' };
      const update = Boolean(operation.siigoQuotation?.externalId);
      if (update && operation.siigoQuotation?.quotedFingerprint === fingerprint) {
        return { outcome: 'ALREADY_SYNCED' };
      }

      const quotation = await transaction.siigoQuotation.upsert({
        where: { operationId },
        create: { operationId, status: 'SYNCING' },
        update: { status: 'SYNCING', errorCode: null, errorMessage: null },
      });
      return { outcome: 'CLAIMED', quotationId: quotation.id, update };
    });
  }

  siigoQuotationJob(id: number): Promise<SiigoQuotationJob | null> {
    return this.prisma.siigoQuotation.findFirst({
      where: { id, status: 'SYNCING' },
      include: siigoQuotationJobInclude,
    });
  }

  /** Operación con lo necesario para previsualizar la cotización, sin importar su estado. */
  quotationOperation(id: number): Promise<QuotationOperation | null> {
    return this.prisma.orderOperation.findFirst({
      where: { id, deletedAt: null },
      include: quotationOperationInclude,
    });
  }

  /**
   * Varias operaciones de una misma página con los mismos datos de cotización. Es una sola consulta
   * para no repetirla por fila cuando el panel necesita saber cuáles quedaron desactualizadas.
   */
  quotationOperations(ids: number[]): Promise<QuotationOperation[]> {
    if (ids.length === 0) return Promise.resolve([]);
    return this.prisma.orderOperation.findMany({
      where: { id: { in: ids }, deletedAt: null },
      include: quotationOperationInclude,
    });
  }

  /** El vendedor de Siigo es el del usuario que dispara la cotización, no el del cliente. */
  async quotationSeller(userId: string): Promise<QuotationSeller | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { name: true, email: true, sellerId: true },
    });
    return user ? { id: user.sellerId, name: user.name, email: user.email } : null;
  }

  markSiigoQuotationSynced(
    id: number,
    result: {
      id: string;
      number: string;
      name: string;
      publicUrl: string | null;
      sellerId: string;
      exchangeRate: number | null;
    },
    fingerprint: string,
  ) {
    return this.prisma.siigoQuotation.updateMany({
      where: { id, status: 'SYNCING' },
      data: {
        externalId: result.id,
        number: result.number,
        name: result.name,
        // Si la respuesta de una actualización no trae el enlace, se conserva el que ya había.
        ...(result.publicUrl === null ? {} : { url: result.publicUrl }),
        sellerId: result.sellerId,
        status: 'SYNCED',
        syncedAt: new Date(),
        // La huella se guarda con lo que efectivamente viajó: es contra ella que se compara el
        // pedido la próxima vez para decidir si hay que actualizar la cotización.
        quotedFingerprint: fingerprint,
        ...(result.exchangeRate === null ? {} : { exchangeRate: result.exchangeRate }),
        errorCode: null,
        errorMessage: null,
      },
    });
  }

  markSiigoQuotationError(id: number, code: string, message: string) {
    return this.prisma.siigoQuotation.updateMany({
      where: { id, status: 'SYNCING' },
      data: {
        status: 'ERROR',
        errorCode: code,
        errorMessage: message,
      },
    });
  }

  create(operationCode: string, createdByUserId: string, operation: PreparedOperation) {
    return this.prisma.orderOperation.create({
      data: {
        operationCode,
        source: 'CRM',
        status: 'PENDING',
        createdByUserId,
        ...operationData(operation),
        orders: { create: operation.orders.map(orderCreateData) },
      },
      include: orderDetailInclude,
    });
  }

  updatePending(
    id: number,
    operation: PreparedOperation,
    updatedByUserId: string,
  ): Promise<UpdateResult> {
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.orderOperation.findFirst({
        where: { id, deletedAt: null },
        select: { status: true, currency: true },
      });
      if (!current) return { outcome: 'NOT_FOUND' };
      if (current.status !== 'PENDING') return { outcome: 'NOT_EDITABLE' };
      // La moneda se fija al crear la operación: los pedidos ya enviados a WooCommerce y las
      // cotizaciones de Siigo quedan con importes en esa moneda y no se pueden reinterpretar.
      if (current.currency !== operation.currency) return { outcome: 'CURRENCY_LOCKED' };

      await transaction.orderOperation.update({
        where: { id },
        data: {
          ...operationData(operation),
          // El detalle muestra «Última modificación» con nombre y fecha: se guardan juntos para que
          // la fecha sea la de esta edición y no la de una sincronización posterior.
          updatedByUserId,
          updatedByAt: new Date(),
        },
      });

      const stores = operation.orders.map(({ store }) => store);
      await transaction.order.deleteMany({
        where: { operationId: id, store: { notIn: stores } },
      });

      for (const order of operation.orders) {
        const existing = await transaction.order.findUnique({
          where: { operationId_store: { operationId: id, store: order.store } },
          select: { id: true },
        });
        if (!existing) {
          await transaction.order.create({
            data: { operationId: id, ...orderCreateData(order) },
          });
          continue;
        }
        await transaction.orderItem.deleteMany({ where: { orderId: existing.id } });
        await transaction.orderCoupon.deleteMany({ where: { orderId: existing.id } });
        await transaction.order.update({
          where: { id: existing.id },
          data: {
            subtotal: order.subtotal,
            discountTotal: order.discountTotal,
            shippingTotal: order.shippingTotal,
            total: order.total,
            items: { create: order.items },
            coupons: { create: order.coupons },
          },
        });
      }

      const updated = await transaction.orderOperation.findUniqueOrThrow({
        where: { id },
        include: orderDetailInclude,
      });
      return { outcome: 'UPDATED', operation: updated };
    });
  }

  async delete(id: number): Promise<DeleteResult> {
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.orderOperation.findFirst({
        where: { id, deletedAt: null },
        include: orderDetailInclude,
      });
      if (!current) return { outcome: 'NOT_FOUND' };
      const orderIds = current.orders.map(({ id: orderId }) => orderId);
      if (orderIds.length > 0) {
        await transaction.wooOrderDelivery.deleteMany({ where: { orderId: { in: orderIds } } });
      }
      await transaction.notification.deleteMany({ where: { orderOperationId: id } });
      await transaction.orderOperation.delete({ where: { id } });
      return { outcome: 'UPDATED', operation: current };
    });
  }
}
