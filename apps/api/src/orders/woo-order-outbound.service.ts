import { HttpException, Injectable } from '@nestjs/common';
import type { Store } from '../generated/prisma/client.js';
import {
  WooCommerceService,
  type WooCommerceOrderCreatePayload,
  type WooCommerceOrderReference,
} from '../integrations/woocommerce/woocommerce.service.js';
import { OrdersRepository, type OutboundOrder } from './orders.repository.js';

export class WooOrderOutboundError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function storeLabel(store: Store): string {
  return store === 'SERATUS' ? 'Seratus' : 'Pali';
}

function positiveIdentifier(
  value: string | null | undefined,
  code: string,
  message: string,
): number {
  if (!value || !/^[1-9]\d*$/.test(value)) throw new WooOrderOutboundError(code, message);
  const result = Number(value);
  if (!Number.isSafeInteger(result)) throw new WooOrderOutboundError(code, message);
  return result;
}

function compactAddress(values: Record<string, string | null>) {
  return Object.fromEntries(
    Object.entries(values).filter((entry): entry is [string, string] => Boolean(entry[1])),
  );
}

function safeIntegrationMessage(error: unknown, store: Store): string {
  if (error instanceof WooOrderOutboundError) return error.message;
  if (error instanceof HttpException) {
    const response: unknown = error.getResponse();
    if (typeof response === 'object' && response !== null && 'error' in response) {
      const detail = (response as { error?: unknown }).error;
      if (typeof detail === 'object' && detail !== null && 'message' in detail) {
        const message = (detail as { message?: unknown }).message;
        if (typeof message === 'string' && message.length <= 500) return message;
      }
    }
  }
  return `No fue posible crear el pedido en ${storeLabel(store)}.`;
}

function externalKey(order: OutboundOrder): string {
  return `${order.operation.operationCode}:${order.store}`;
}

function customerExternalId(order: OutboundOrder): string {
  const integration = order.operation.customer.integrations.find(
    ({ provider }) => provider === order.store,
  );
  if (!integration?.externalId) {
    throw new WooOrderOutboundError(
      `${order.store}_CUSTOMER_NOT_LINKED`,
      `El cliente todavía no está vinculado con ${storeLabel(order.store)}.`,
    );
  }
  positiveIdentifier(
    integration.externalId,
    `${order.store}_CUSTOMER_NOT_LINKED`,
    `El vínculo del cliente con ${storeLabel(order.store)} no es válido.`,
  );
  return integration.externalId;
}

function orderPayload(
  order: OutboundOrder,
  externalCustomerId: string,
): WooCommerceOrderCreatePayload {
  const operation = order.operation;
  const lineItems = order.items.map((item) => {
    const product = item.product;
    if (!product || product.store !== order.store || !product.wooVariationId) {
      throw new WooOrderOutboundError(
        `${order.store}_PRODUCT_NOT_LINKED`,
        `El producto ${item.skuSnapshot} no tiene un vínculo válido con ${storeLabel(order.store)}.`,
      );
    }
    const productId = Number(product.wooParentId ?? product.wooVariationId);
    const variationId = product.wooParentId ? Number(product.wooVariationId) : null;
    if (
      !Number.isSafeInteger(productId) ||
      (variationId !== null && !Number.isSafeInteger(variationId))
    ) {
      throw new WooOrderOutboundError(
        `${order.store}_PRODUCT_NOT_LINKED`,
        `El producto ${item.skuSnapshot} no tiene un identificador válido en ${storeLabel(order.store)}.`,
      );
    }
    return {
      product_id: productId,
      ...(variationId === null ? {} : { variation_id: variationId }),
      quantity: item.quantity,
      subtotal: item.subtotal.toFixed(2),
      total: item.total.toFixed(2),
    };
  });

  const shippingTotal = order.shippingTotal.toFixed(2);
  if (
    order.shippingTotal.greaterThan(0) &&
    (!operation.shippingMethod || !operation.shippingMethodTitle)
  ) {
    throw new WooOrderOutboundError(
      `${order.store}_SHIPPING_METHOD_REQUIRED`,
      `Completa el método de envío antes de crear el pedido en ${storeLabel(order.store)}.`,
    );
  }

  return {
    customer_id: positiveIdentifier(
      externalCustomerId,
      `${order.store}_CUSTOMER_NOT_LINKED`,
      `El vínculo del cliente con ${storeLabel(order.store)} no es válido.`,
    ),
    currency: operation.currency,
    ...(operation.paymentMethod ? { payment_method: operation.paymentMethod } : {}),
    ...(operation.paymentMethodTitle ? { payment_method_title: operation.paymentMethodTitle } : {}),
    set_paid: true,
    billing: compactAddress({
      first_name: operation.billingFirstName,
      last_name: operation.billingLastName,
      company: operation.billingCompany,
      address_1: operation.billingAddress1,
      address_2: operation.billingAddress2,
      city: operation.billingCity,
      state: operation.billingState,
      postcode: operation.billingPostcode,
      country: operation.billingCountry,
      email: operation.billingEmail,
      phone: operation.billingPhone,
    }),
    shipping: compactAddress({
      first_name: operation.shippingFirstName,
      last_name: operation.shippingLastName,
      company: operation.shippingCompany,
      address_1: operation.shippingAddress1,
      address_2: operation.shippingAddress2,
      city: operation.shippingCity,
      state: operation.shippingState,
      postcode: operation.shippingPostcode,
      country: operation.shippingCountry,
      phone: operation.shippingPhone,
    }),
    line_items: lineItems,
    ...(operation.shippingMethod && operation.shippingMethodTitle
      ? {
          shipping_lines: [
            {
              method_id: operation.shippingMethod,
              method_title: operation.shippingMethodTitle,
              total: shippingTotal,
            },
          ],
        }
      : {}),
    ...(order.coupons.length ? { coupon_lines: order.coupons.map(({ code }) => ({ code })) } : {}),
    meta_data: [
      { key: 'sevale_crm_order_key', value: externalKey(order) },
      { key: 'sevale_crm_order_id', value: String(order.id) },
      { key: 'sevale_crm_operation_code', value: operation.operationCode },
      {
        key: 'billing_type_document',
        value: operation.customer.documentType,
      },
      {
        key: 'billing_identification',
        value: operation.customer.documentNumber,
      },
    ],
  };
}

@Injectable()
export class WooOrderOutboundService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly wooCommerce: WooCommerceService,
  ) {}

  async synchronize(orderIds: number[]): Promise<void> {
    const orders = await this.orders.outboundOrders(orderIds);
    await Promise.all(orders.map((order) => this.synchronizeOrder(order)));
  }

  private async synchronizeOrder(order: OutboundOrder): Promise<void> {
    try {
      const externalCustomerId = customerExternalId(order);
      const key = externalKey(order);
      const existing = await this.wooCommerce.findOrderByExternalKey(
        order.store,
        externalCustomerId,
        key,
      );
      const result =
        existing ??
        (await this.wooCommerce.createOrder(order.store, orderPayload(order, externalCustomerId)));
      await this.confirm(order.id, order.store, result);
    } catch (error) {
      const message = safeIntegrationMessage(error, order.store);
      await this.orders.markOrderError(order.id, `${order.store}_ORDER_CREATE_FAILED`, message);
    }
  }

  private async confirm(
    orderId: number,
    store: Store,
    result: WooCommerceOrderReference,
  ): Promise<void> {
    try {
      await this.orders.markOrderSynced(orderId, result);
    } catch {
      await this.orders.markOrderError(
        orderId,
        `${store}_ORDER_CONFIRMATION_FAILED`,
        `${storeLabel(store)} creó el pedido, pero el CRM no pudo guardar su identificador. Reintenta la sincronización para recuperarlo.`,
      );
    }
  }
}
