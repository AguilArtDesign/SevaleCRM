import { HttpException, Injectable } from '@nestjs/common';
import { formatPhoneInternational } from '@sevale/shared';
import type { Prisma, Store } from '../generated/prisma/client.js';
import {
  WooCommerceService,
  type WooCommerceOrderCreatePayload,
  type WooCommerceOrderReference,
  type WooCommerceOrderSnapshot,
  type WooCommerceOrderUpdatePayload,
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

/** Resultado de sincronizar un pedido de tienda, para que la traza pueda dejarlo escrito. */
export type OrderSyncOutcome = {
  operationId: number;
  provider: Store;
  status: 'SYNCED' | 'ERROR';
  message: string | null;
};

function storeLabel(store: Store): string {
  return store === 'SERATUS' ? 'Seratus' : 'Pali';
}

// El teléfono viaja como lo muestra la tienda (+57 304 4251788), con el mismo formato que usa el
// cliente de WooCommerce.
function displayPhone(value: string | null, country: string | null): string | null {
  if (!value) return null;
  return formatPhoneInternational(value, country ?? '') ?? value;
}

// Las dos líneas de la dirección viajan en mayúsculas sostenidas, como las espera la tienda (y como las
// envía Siigo).
function upperAddress(value: string | null): string | null {
  return value ? value.toLocaleUpperCase('es-CO') : null;
}

// El descuento del cupón se reparte entre las líneas elegibles (las que no llevan el precio
// modificado) y viaja dentro del total de cada una, sin `coupon_lines`: así WooCommerce, el CRM y la
// cotización de Siigo muestran los mismos importes, sin depender de cómo reparte WooCommerce sus
// cupones. La última línea elegible absorbe el redondeo para que la suma coincida con el descuento
// guardado en el pedido al centavo.
function distributedDiscounts(order: OutboundOrder): Map<number, Prisma.Decimal> {
  const discounts = new Map<number, Prisma.Decimal>();
  const eligible = order.items.filter((item) => !item.priceModified);
  if (order.discountTotal.lessThanOrEqualTo(0) || eligible.length === 0) return discounts;
  const eligibleSubtotal = eligible.reduce(
    (total, item) => total.plus(item.subtotal),
    order.discountTotal.times(0),
  );
  if (eligibleSubtotal.lessThanOrEqualTo(0)) return discounts;
  let assigned = order.discountTotal.times(0);
  eligible.forEach((item, index) => {
    const isLast = index === eligible.length - 1;
    const share = isLast
      ? order.discountTotal.minus(assigned)
      : item.subtotal.times(order.discountTotal).dividedBy(eligibleSubtotal).toDecimalPlaces(2);
    assigned = assigned.plus(share);
    discounts.set(item.id, share);
  });
  return discounts;
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

/** Línea del CRM resuelta a los identificadores de la tienda, con el cupón ya repartido. */
type ResolvedLine = {
  productId: number;
  variationId: number | null;
  quantity: number;
  subtotal: string;
  total: string;
};

/**
 * Traduce los productos de la operación a líneas de la tienda. Es el único sitio que valida el
 * vínculo del producto y reparte el cupón, para que el alta y la actualización de un pedido en
 * WooCommerce manden exactamente los mismos importes.
 */
function resolvedLines(order: OutboundOrder): ResolvedLine[] {
  const discounts = distributedDiscounts(order);
  return order.items.map((item) => {
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
    const discount = discounts.get(item.id) ?? item.subtotal.times(0);
    return {
      productId,
      variationId,
      quantity: item.quantity,
      subtotal: item.subtotal.toFixed(2),
      // El descuento del cupón ya viene incluido en el total de la línea: no se envían `coupon_lines`.
      total: item.subtotal.minus(discount).toFixed(2),
    };
  });
}

/** Clave con la que se empareja un producto del CRM con una línea del pedido en la tienda. */
function lineKey(productId: number | null, variationId: number | null): string {
  return `${productId ?? ''}:${variationId ?? ''}`;
}

/** Los metadatos que el CRM deja en el pedido de la tienda, iguales en el alta y en la actualización. */
function orderMetadataFor(order: OutboundOrder): Array<{ key: string; value: string }> {
  const operation = order.operation;
  return [
    { key: 'sevale_crm_order_key', value: externalKey(order) },
    { key: 'sevale_crm_order_id', value: String(order.id) },
    { key: 'sevale_crm_operation_code', value: operation.operationCode },
    // Nombre que WooCommerce ya consume para identificar la operación del CRM.
    { key: 'operation_id', value: operation.operationCode },
    // Origen del pedido (CRM | WOOCOMMERCE): los webhooks lo usan para no reprocesar lo propio.
    { key: 'origen', value: operation.source },
    { key: 'billing_type_document', value: operation.customer.documentType },
    { key: 'billing_identification', value: operation.customer.documentNumber },
  ];
}

/**
 * Líneas de envío del `PUT`. Se reenvía el `id` del envío que ya tiene el pedido para que WooCommerce
 * reemplace su importe en vez de agregar otro: sin esto, pasar de envío gratis a cobrado —o al revés—
 * dejaría dos envíos y el total del pedido no cuadraría con lo que ve el cliente.
 *
 * Si el CRM ya no cobra envío pero la tienda lo tenía cobrado, se manda el mismo envío en cero, que
 * es exactamente lo que el comercial dejó escrito en el pedido.
 */
function shippingLinesFor(
  order: OutboundOrder,
  snapshot: WooCommerceOrderSnapshot,
): WooCommerceOrderUpdatePayload['shipping_lines'] {
  const existing = snapshot.shippingLines[0];
  const chargesShipping = order.shippingTotal.greaterThan(0);

  if (chargesShipping) {
    if (!order.operation.shippingMethod || !order.operation.shippingMethodTitle) {
      throw new WooOrderOutboundError(
        `${order.store}_SHIPPING_METHOD_REQUIRED`,
        `Completa el método de envío antes de actualizar el pedido en ${storeLabel(order.store)}.`,
      );
    }
    return [
      {
        ...(existing ? { id: existing.id } : {}),
        method_id: order.operation.shippingMethod,
        method_title: order.operation.shippingMethodTitle,
        total: order.shippingTotal.toFixed(2),
      },
    ];
  }

  // El envío del CRM quedó en cero: se conserva el método que tenía la tienda y se anula el importe.
  if (!existing) return undefined;
  return [
    {
      id: existing.id,
      method_id: existing.methodId ?? 'free_shipping',
      method_title: existing.methodTitle ?? 'Envío gratis',
      total: '0.00',
    },
  ];
}

/**
 * Cuerpo del `PUT` de un pedido que ya existe en la tienda y que el comercial reabrió para
 * terminarlo desde el CRM.
 *
 * Las líneas se emparejan por producto y variación contra lo que hoy tiene el pedido en WooCommerce,
 * consumiendo cada línea de la tienda una sola vez: dos líneas del CRM del mismo producto no pueden
 * apuntar al mismo `id`. Lo que la tienda tiene y el CRM ya no, se borra explícitamente: WooCommerce
 * no toca las líneas que no llegan en el arreglo.
 */
function reopenedOrderPayload(
  order: OutboundOrder,
  snapshot: WooCommerceOrderSnapshot,
): WooCommerceOrderUpdatePayload {
  const operation = order.operation;
  const available = new Map<string, number[]>();
  for (const line of snapshot.lines) {
    const key = lineKey(line.productId, line.variationId);
    const current = available.get(key);
    if (current) current.push(line.id);
    else available.set(key, [line.id]);
  }

  const lineItems: WooCommerceOrderUpdatePayload['line_items'] = resolvedLines(order).map(
    (line) => {
      const candidates = available.get(lineKey(line.productId, line.variationId));
      const existingId = candidates?.shift();
      const amounts = { quantity: line.quantity, subtotal: line.subtotal, total: line.total };
      return existingId === undefined
        ? {
            product_id: line.productId,
            ...(line.variationId === null ? {} : { variation_id: line.variationId }),
            ...amounts,
          }
        : { id: existingId, ...amounts };
    },
  );

  /**
   * Lo que quedó sin consumir es lo que el CRM ya no tiene. Va con `quantity: 0`, que es la única
   * forma de borrar una línea: omitirla no sirve, porque WooCommerce actualiza las que llegan y deja
   * intactas las demás. Así, quitar un producto en el CRM lo quita del pedido en la tienda en vez de
   * dejar los productos viejos y los nuevos a la vez.
   */
  for (const id of [...available.values()].flat()) {
    lineItems.push({ id, quantity: 0 });
  }

  const shippingLines = shippingLinesFor(order, snapshot);
  const phoneCountry = operation.billingCountry ?? operation.customer.country;
  return {
    status: 'completed',
    ...(operation.paymentMethod ? { payment_method: operation.paymentMethod } : {}),
    ...(operation.paymentMethodTitle ? { payment_method_title: operation.paymentMethodTitle } : {}),
    ...(operation.customerNote ? { customer_note: operation.customerNote } : {}),
    set_paid: true,
    billing: compactAddress({
      first_name: operation.billingFirstName,
      last_name: operation.billingLastName,
      company: operation.billingCompany,
      address_1: upperAddress(operation.billingAddress1),
      address_2: upperAddress(operation.billingAddress2),
      city: operation.billingCity,
      state: operation.billingState,
      postcode: operation.billingPostcode,
      country: operation.billingCountry,
      email: operation.billingEmail,
      phone: displayPhone(operation.billingPhone, phoneCountry),
    }),
    shipping: compactAddress({
      first_name: operation.shippingFirstName,
      last_name: operation.shippingLastName,
      company: operation.shippingCompany,
      address_1: upperAddress(operation.shippingAddress1),
      address_2: upperAddress(operation.shippingAddress2),
      city: operation.shippingCity,
      state: operation.shippingState,
      postcode: operation.shippingPostcode,
      country: operation.shippingCountry,
      phone: displayPhone(operation.shippingPhone, phoneCountry),
    }),
    line_items: lineItems,
    ...(shippingLines ? { shipping_lines: shippingLines } : {}),
    meta_data: orderMetadataFor(order),
  };
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

export function orderPayload(
  order: OutboundOrder,
  externalCustomerId: string,
): WooCommerceOrderCreatePayload {
  const operation = order.operation;
  const lineItems = resolvedLines(order).map(({ productId, variationId, ...amounts }) => ({
    product_id: productId,
    ...(variationId === null ? {} : { variation_id: variationId }),
    ...amounts,
  }));

  // El teléfono se formatea con el país del número: el de facturación y, si no hay, el del cliente.
  const phoneCountry = operation.billingCountry ?? operation.customer.country;
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
    // El comercial solo envía operaciones con el pago acordado, así que el pedido nace completado.
    status: 'completed',
    ...(operation.paymentMethod ? { payment_method: operation.paymentMethod } : {}),
    ...(operation.paymentMethodTitle ? { payment_method_title: operation.paymentMethodTitle } : {}),
    // `customer_note` es el campo donde WooCommerce muestra la nota del comprador, tanto en el
    // admin como en los correos. Solo se envía si el comercial escribió algo.
    ...(operation.customerNote ? { customer_note: operation.customerNote } : {}),
    set_paid: true,
    billing: compactAddress({
      first_name: operation.billingFirstName,
      last_name: operation.billingLastName,
      company: operation.billingCompany,
      address_1: upperAddress(operation.billingAddress1),
      address_2: upperAddress(operation.billingAddress2),
      city: operation.billingCity,
      state: operation.billingState,
      postcode: operation.billingPostcode,
      country: operation.billingCountry,
      email: operation.billingEmail,
      phone: displayPhone(operation.billingPhone, phoneCountry),
    }),
    shipping: compactAddress({
      first_name: operation.shippingFirstName,
      last_name: operation.shippingLastName,
      company: operation.shippingCompany,
      address_1: upperAddress(operation.shippingAddress1),
      address_2: upperAddress(operation.shippingAddress2),
      city: operation.shippingCity,
      state: operation.shippingState,
      postcode: operation.shippingPostcode,
      country: operation.shippingCountry,
      phone: displayPhone(operation.shippingPhone, phoneCountry),
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
    meta_data: orderMetadataFor(order),
  };
}

@Injectable()
export class WooOrderOutboundService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly wooCommerce: WooCommerceService,
  ) {}

  async synchronize(orderIds: number[]): Promise<OrderSyncOutcome[]> {
    const orders = await this.orders.outboundOrders(orderIds);
    return Promise.all(orders.map((order) => this.synchronizeOrder(order)));
  }

  private async synchronizeOrder(order: OutboundOrder): Promise<OrderSyncOutcome> {
    // Un pedido que ya vive en la tienda no se crea: se actualiza. Es el caso de un pedido de
    // WooCommerce que el comercial reabrió para cerrarlo desde el CRM.
    if (order.wooOrderId !== null) return this.updateExisting(order);
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
      return await this.confirm(order, result);
    } catch (error) {
      const message = safeIntegrationMessage(error, order.store);
      await this.orders.markOrderError(order.id, `${order.store}_ORDER_CREATE_FAILED`, message);
      return { operationId: order.operationId, provider: order.store, status: 'ERROR', message };
    }
  }

  /**
   * Cierra en la tienda un pedido reabierto. Se lee primero para conocer el `id` de cada línea: es
   * la única forma de modificar las existentes sin duplicarlas ni borrar las que siguen.
   */
  private async updateExisting(order: OutboundOrder): Promise<OrderSyncOutcome> {
    try {
      const snapshot = await this.wooCommerce.getOrder(order.store, String(order.wooOrderId));
      const result = await this.wooCommerce.updateOrder(
        order.store,
        String(order.wooOrderId),
        reopenedOrderPayload(order, snapshot),
      );
      return await this.confirm(order, result);
    } catch (error) {
      const message = safeIntegrationMessage(error, order.store);
      await this.orders.markOrderError(order.id, `${order.store}_ORDER_UPDATE_FAILED`, message);
      return { operationId: order.operationId, provider: order.store, status: 'ERROR', message };
    }
  }

  private async confirm(
    order: OutboundOrder,
    result: WooCommerceOrderReference,
  ): Promise<OrderSyncOutcome> {
    const synced: OrderSyncOutcome = {
      operationId: order.operationId,
      provider: order.store,
      status: 'SYNCED',
      message: null,
    };
    try {
      await this.orders.markOrderSynced(order.id, result);
      return synced;
    } catch {
      const message = `${storeLabel(order.store)} creó el pedido, pero el CRM no pudo guardar su identificador. Reintenta la sincronización para recuperarlo.`;
      await this.orders.markOrderError(
        order.id,
        `${order.store}_ORDER_CONFIRMATION_FAILED`,
        message,
      );
      return { ...synced, status: 'ERROR', message };
    }
  }
}
