import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import { Prisma, type Product, type Store } from '../generated/prisma/client.js';
import type { NormalizedWooOrderInbound } from './woo-order-inbound.normalizer.js';

export class WooInboundError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function decimal(value: string | number | Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function customerIntegrationData(
  store: Store,
  wooCustomerId: string | null,
): Prisma.CustomerIntegrationCreateWithoutCustomerInput[] {
  const providers = ['SIIGO', 'SERATUS', 'PALI'] as const;
  return providers.map((provider) => ({
    provider,
    externalId: provider === store ? wooCustomerId : null,
    status: provider === store && wooCustomerId ? 'SYNCED' : 'PENDING',
    ...(provider === store && wooCustomerId
      ? { lastAttemptAt: new Date(), lastSyncedAt: new Date() }
      : {}),
  }));
}

function operationSnapshot(input: NormalizedWooOrderInbound) {
  return {
    status: input.status,
    customerId: 0,
    currency: input.currency,
    paymentMethod: input.paymentMethod,
    paymentMethodTitle: input.paymentMethodTitle,
    shippingMethod: input.shippingMethod,
    shippingMethodTitle: input.shippingMethodTitle,
    subtotal: decimal(input.subtotal),
    discountTotal: decimal(input.discountTotal),
    shippingTotal: decimal(input.shippingTotal),
    total: decimal(input.total),
    billingFirstName: input.billing.firstName,
    billingLastName: input.billing.lastName,
    billingCompany: input.billing.company,
    billingAddress1: input.billing.address1,
    billingAddress2: input.billing.address2,
    billingCity: input.billing.city,
    billingState: input.billing.state,
    billingPostcode: input.billing.postcode,
    billingCountry: input.billing.country,
    billingEmail: input.billing.email,
    billingPhone: input.billing.phone,
    shippingFirstName: input.shipping.firstName,
    shippingLastName: input.shipping.lastName,
    shippingCompany: input.shipping.company,
    shippingAddress1: input.shipping.address1,
    shippingAddress2: input.shipping.address2,
    shippingCity: input.shipping.city,
    shippingState: input.shipping.state,
    shippingPostcode: input.shipping.postcode,
    shippingCountry: input.shipping.country,
    shippingPhone: input.shipping.phone,
    deletedAt: null,
  };
}

type Transaction = Prisma.TransactionClient;

@Injectable()
export class WooOrderInboundRepository {
  constructor(private readonly prisma: PrismaService) {}

  async claim(input: NormalizedWooOrderInbound) {
    try {
      const delivery = await this.prisma.wooOrderDelivery.create({
        data: {
          deliveryId: input.deliveryId,
          store: input.store,
          event: input.event,
          wooOrderId: BigInt(input.wooOrderId),
          status: 'PENDING',
        },
      });
      return { outcome: 'CLAIMED' as const, delivery, operationId: null };
    } catch (error) {
      if (!isUniqueConstraintError(error)) throw error;
      const existing = await this.prisma.wooOrderDelivery.findUniqueOrThrow({
        where: { deliveryId: input.deliveryId },
        include: { order: { select: { operationId: true } } },
      });
      if (
        existing.store !== input.store ||
        existing.event !== input.event ||
        existing.wooOrderId?.toString() !== input.wooOrderId
      ) {
        throw new WooInboundError(
          'WOO_DELIVERY_CONFLICT',
          'El identificador de entrega ya fue utilizado para otro evento.',
        );
      }
      if (existing.status === 'PROCESSED') {
        return {
          outcome: 'DUPLICATE' as const,
          delivery: existing,
          operationId: existing.order?.operationId ?? null,
        };
      }
      if (existing.status === 'PENDING') {
        return {
          outcome: 'PROCESSING' as const,
          delivery: existing,
          operationId: existing.order?.operationId ?? null,
        };
      }
      const retry = await this.prisma.wooOrderDelivery.updateMany({
        where: { id: existing.id, status: 'ERROR' },
        data: { status: 'PENDING', errorCode: null, errorMessage: null },
      });
      if (retry.count === 0) {
        return {
          outcome: 'PROCESSING' as const,
          delivery: existing,
          operationId: existing.order?.operationId ?? null,
        };
      }
      return {
        outcome: 'CLAIMED' as const,
        delivery: await this.prisma.wooOrderDelivery.findUniqueOrThrow({
          where: { id: existing.id },
        }),
        operationId: null,
      };
    }
  }

  markError(deliveryId: string, code: string, message: string) {
    return this.prisma.wooOrderDelivery.updateMany({
      where: { deliveryId, status: { not: 'PROCESSED' } },
      data: { status: 'ERROR', errorCode: code, errorMessage: message },
    });
  }

  async import(input: NormalizedWooOrderInbound) {
    return this.prisma.$transaction(async (transaction) => {
      const customer = await this.resolveCustomer(transaction, input);
      const products = await Promise.all(
        input.items.map((item) => this.resolveProduct(transaction, input.store, item)),
      );
      let existingOrder = await transaction.order.findUnique({
        where: {
          store_wooOrderId: { store: input.store, wooOrderId: BigInt(input.wooOrderId) },
        },
        include: { operation: true },
      });
      if (!existingOrder && input.outboundLocalOrderId && input.outboundOperationCode) {
        const outboundOrder = await transaction.order.findUnique({
          where: { id: input.outboundLocalOrderId },
          include: { operation: true },
        });
        if (
          outboundOrder?.store === input.store &&
          outboundOrder.wooOrderId === null &&
          outboundOrder.operation.source === 'CRM' &&
          outboundOrder.operation.operationCode === input.outboundOperationCode &&
          outboundOrder.operation.customerId === customer.id
        ) {
          existingOrder = outboundOrder;
        }
      }

      if (
        existingOrder?.wooUpdatedAt &&
        input.wooUpdatedAt &&
        input.wooUpdatedAt < existingOrder.wooUpdatedAt
      ) {
        await transaction.wooOrderDelivery.update({
          where: { deliveryId: input.deliveryId },
          data: {
            orderId: existingOrder.id,
            status: 'PROCESSED',
            processedAt: new Date(),
            errorCode: null,
            errorMessage: null,
          },
        });
        return {
          operationId: existingOrder.operationId,
          orderId: existingOrder.id,
          created: false,
          stale: true,
        };
      }

      const operationData = {
        ...operationSnapshot(input),
        customerId: customer.id,
        ...(existingOrder?.operation.source === 'CRM'
          ? { status: existingOrder.operation.status }
          : {}),
      };
      const itemData = input.items.map((item, index) => {
        const product = products[index] ?? null;
        const originalPrice = product
          ? input.currency === 'USD'
            ? product.wooPriceUsd
            : product.wooPriceCop
          : null;
        const unitPrice = decimal(item.unitPrice);
        return {
          productId: product?.id ?? null,
          skuSnapshot: item.sku || product?.sku || '',
          nameSnapshot: item.name || product?.productName || '',
          storeSnapshot: input.store,
          quantity: item.quantity,
          originalPrice,
          unitPrice,
          priceModified: product && originalPrice ? !unitPrice.equals(originalPrice) : false,
          subtotal: decimal(item.subtotal),
          discountTotal: decimal(item.discountTotal),
          total: decimal(item.total),
          taxClass: item.taxClass,
        };
      });
      const orderData = {
        wooStatus: input.wooStatus,
        wooCreatedAt: input.wooCreatedAt,
        wooUpdatedAt: input.wooUpdatedAt,
        syncStatus: 'SYNCED' as const,
        lastSyncAt: new Date(),
        lastSyncErrorCode: null,
        lastSyncErrorMessage: null,
        subtotal: decimal(input.subtotal),
        discountTotal: decimal(input.discountTotal),
        shippingTotal: decimal(input.shippingTotal),
        total: decimal(input.total),
      };

      let operationId: number;
      let orderId: number;
      let created = false;
      if (existingOrder) {
        operationId = existingOrder.operationId;
        orderId = existingOrder.id;
        await transaction.orderOperation.update({
          where: { id: operationId },
          data: operationData,
        });
        await transaction.orderItem.deleteMany({ where: { orderId } });
        await transaction.orderCoupon.deleteMany({ where: { orderId } });
        await transaction.order.update({
          where: { id: orderId },
          data: {
            wooOrderId: BigInt(input.wooOrderId),
            ...orderData,
            items: { create: itemData },
            coupons: {
              create: input.coupons.map((coupon) => ({
                code: coupon.code,
                discountTotal: decimal(coupon.discountTotal),
              })),
            },
          },
        });
      } else {
        const operation = await transaction.orderOperation.create({
          data: {
            operationCode: input.operationCode,
            source: 'WOOCOMMERCE',
            ...operationData,
            orders: {
              create: {
                store: input.store,
                wooOrderId: BigInt(input.wooOrderId),
                ...orderData,
                items: { create: itemData },
                coupons: {
                  create: input.coupons.map((coupon) => ({
                    code: coupon.code,
                    discountTotal: decimal(coupon.discountTotal),
                  })),
                },
              },
            },
          },
          include: { orders: { select: { id: true } } },
        });
        operationId = operation.id;
        orderId = operation.orders[0]!.id;
        created = true;
      }

      await transaction.wooOrderDelivery.update({
        where: { deliveryId: input.deliveryId },
        data: {
          orderId,
          status: 'PROCESSED',
          processedAt: new Date(),
          errorCode: null,
          errorMessage: null,
        },
      });
      return { operationId, orderId, created, stale: false };
    });
  }

  private async resolveCustomer(transaction: Transaction, input: NormalizedWooOrderInbound) {
    let customer = await transaction.customer.findFirst({
      where: { documentNumber: input.customer.documentNumber, deletedAt: null },
    });
    if (customer && customer.documentType !== input.customer.documentType) {
      throw new WooInboundError(
        'WOO_CUSTOMER_DOCUMENT_CONFLICT',
        'El documento del pedido ya existe con otro tipo de documento.',
      );
    }
    if (!customer) {
      customer = await transaction.customer.create({
        data: {
          ...input.customer,
          active: true,
          fiscalResponsibilities: input.customer.fiscalResponsibilities,
          integrations: {
            create: customerIntegrationData(input.store, input.wooCustomerId),
          },
        },
      });
      return customer;
    }

    const integration = await transaction.customerIntegration.findUnique({
      where: { customerId_provider: { customerId: customer.id, provider: input.store } },
    });
    if (
      input.wooCustomerId &&
      integration?.externalId &&
      integration.externalId !== input.wooCustomerId
    ) {
      throw new WooInboundError(
        'WOO_CUSTOMER_LINK_CONFLICT',
        'El cliente local está vinculado con otro cliente de esta tienda.',
      );
    }
    await transaction.customerIntegration.upsert({
      where: { customerId_provider: { customerId: customer.id, provider: input.store } },
      create: {
        customerId: customer.id,
        provider: input.store,
        externalId: input.wooCustomerId,
        status: input.wooCustomerId ? 'SYNCED' : 'PENDING',
        ...(input.wooCustomerId ? { lastAttemptAt: new Date(), lastSyncedAt: new Date() } : {}),
      },
      update: input.wooCustomerId
        ? {
            externalId: input.wooCustomerId,
            status: 'SYNCED',
            lastAttemptAt: new Date(),
            lastSyncedAt: new Date(),
            lastErrorCode: null,
            lastErrorMessage: null,
          }
        : {},
    });
    return customer;
  }

  private async resolveProduct(
    transaction: Transaction,
    store: Store,
    item: NormalizedWooOrderInbound['items'][number],
  ): Promise<Product | null> {
    const externalId = BigInt(item.wooVariationId ?? item.wooProductId);
    const byId = await transaction.product.findFirst({
      where: { store, wooVariationId: externalId },
    });
    if (byId) return byId;
    if (item.sku) {
      const bySku = await transaction.product.findFirst({
        where: {
          store,
          OR: [{ sku: item.sku }, { wooSku: item.sku }],
        },
      });
      if (bySku) return bySku;
    }
    // Un producto que ya no existe en el inventario no invalida el pedido: se conserva el snapshot que
    // envió la tienda y el ítem queda sin vínculo local.
    return null;
  }
}
