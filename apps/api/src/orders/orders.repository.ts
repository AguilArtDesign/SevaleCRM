import { Injectable } from '@nestjs/common';
import type { OrderListQuery, UpdateShipmentInput } from '@sevale/validation';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';
import type { PreparedOperation, PreparedStoreOrder } from './orders.types.js';

export const orderDetailInclude = {
  customer: true,
  createdBy: { select: { id: true, name: true, email: true } },
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
  coupons: { orderBy: { id: 'asc' as const } },
} as const;

export type OutboundOrder = Prisma.OrderGetPayload<{ include: typeof outboundOrderInclude }>;

type UpdateResult =
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'NOT_EDITABLE' }
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

const siigoQuotationJobInclude = {
  operation: {
    include: {
      customer: { include: { integrations: true } },
      orders: {
        include: {
          items: {
            orderBy: { id: 'asc' as const },
            include: {
              product: { select: { id: true, siigoId: true } },
            },
          },
        },
      },
    },
  },
} as const;

export type SiigoQuotationJob = Prisma.SiigoQuotationGetPayload<{
  include: typeof siigoQuotationJobInclude;
}>;

export type SiigoQuotationClaim =
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'NOT_ALLOWED' }
  | { outcome: 'ALREADY_SYNCED' }
  | { outcome: 'IN_PROGRESS' }
  | { outcome: 'CLAIMED'; quotationId: number };

function orderCreateData(order: PreparedStoreOrder) {
  return {
    store: order.store,
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

  findActiveCoupon(id: number) {
    return this.prisma.coupon.findFirst({ where: { id, active: true } });
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
    const orderBy: Prisma.OrderOrderByWithRelationInput[] = [
      query.sort === 'total'
        ? { total: query.order }
        : { operation: { [query.sort]: query.order } },
      { id: 'desc' },
    ];

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
              customer: {
                select: {
                  id: true,
                  displayName: true,
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

  claimCompletion(id: number): Promise<CompleteClaim> {
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
        data: { status: 'COMPLETED' },
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
          source: true,
          status: true,
          orders: { select: { store: true, wooOrderId: true } },
        },
      });
      if (!operation) return { outcome: 'NOT_FOUND' };
      if (
        (operation.source === 'CRM' && operation.status !== 'COMPLETED') ||
        (operation.source === 'WOOCOMMERCE' && operation.status === 'CANCELLED')
      ) {
        return { outcome: 'NOT_ALLOWED' };
      }

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

  claimSiigoQuotation(operationId: number, exchangeRate?: number): Promise<SiigoQuotationClaim> {
    return this.prisma.$transaction(async (transaction) => {
      const operation = await transaction.orderOperation.findFirst({
        where: { id: operationId, deletedAt: null },
        select: { status: true, siigoQuotation: true },
      });
      if (!operation) return { outcome: 'NOT_FOUND' };
      if (operation.status === 'CANCELLED') return { outcome: 'NOT_ALLOWED' };
      if (operation.siigoQuotation?.externalId) return { outcome: 'ALREADY_SYNCED' };
      if (operation.siigoQuotation?.status === 'SYNCING') return { outcome: 'IN_PROGRESS' };

      const quotation = await transaction.siigoQuotation.upsert({
        where: { operationId },
        create: {
          operationId,
          status: 'SYNCING',
          exchangeRate,
        },
        update: {
          status: 'SYNCING',
          ...(exchangeRate === undefined ? {} : { exchangeRate }),
          errorCode: null,
          errorMessage: null,
        },
      });
      return { outcome: 'CLAIMED', quotationId: quotation.id };
    });
  }

  siigoQuotationJob(id: number): Promise<SiigoQuotationJob | null> {
    return this.prisma.siigoQuotation.findFirst({
      where: { id, status: 'SYNCING', externalId: null },
      include: siigoQuotationJobInclude,
    });
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
  ) {
    return this.prisma.siigoQuotation.updateMany({
      where: { id, status: 'SYNCING', externalId: null },
      data: {
        externalId: result.id,
        number: result.number,
        name: result.name,
        url: result.publicUrl,
        sellerId: result.sellerId,
        status: 'SYNCED',
        syncedAt: new Date(),
        ...(result.exchangeRate === null ? {} : { exchangeRate: result.exchangeRate }),
        errorCode: null,
        errorMessage: null,
      },
    });
  }

  markSiigoQuotationError(id: number, code: string, message: string) {
    return this.prisma.siigoQuotation.updateMany({
      where: { id, status: 'SYNCING', externalId: null },
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

  updatePending(id: number, operation: PreparedOperation): Promise<UpdateResult> {
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.orderOperation.findFirst({
        where: { id, deletedAt: null },
        select: { status: true },
      });
      if (!current) return { outcome: 'NOT_FOUND' };
      if (current.status !== 'PENDING') return { outcome: 'NOT_EDITABLE' };

      await transaction.orderOperation.update({
        where: { id },
        data: operationData(operation),
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

  async softDelete(id: number): Promise<DeleteResult> {
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.orderOperation.findFirst({
        where: { id, deletedAt: null },
        include: orderDetailInclude,
      });
      if (!current) return { outcome: 'NOT_FOUND' };
      const operation = await transaction.orderOperation.update({
        where: { id },
        data: { deletedAt: new Date() },
        include: orderDetailInclude,
      });
      return { outcome: 'UPDATED', operation };
    });
  }
}
