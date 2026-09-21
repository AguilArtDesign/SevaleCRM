import { BadRequestException } from '@nestjs/common';
import { resolveCountry, resolveLocationFromWoo } from '@sevale/shared';
import { createCustomerSchema, type WooOrderInboundInput } from '@sevale/validation';
import { Prisma, type OperationStatus } from '../generated/prisma/client.js';
import {
  capitalizeCustomerName,
  normalizeCustomerName,
  normalizeCustomerPhone,
  sanitizeCustomerEmail,
  sanitizePostalCode,
  sanitizeSiigoAddress,
} from '../customers/customer-data-sanitizer.js';
import { documentTypeFromWoo } from '../customers/customer-document-type.mapping.js';

type WooOrder = WooOrderInboundInput['order'];

function inboundError(code: string, message: string) {
  return new BadRequestException({ success: false, error: { code, message } });
}

function metadata(order: WooOrder, key: string): string | null {
  const value = order.meta_data.find((entry) => entry.key === key)?.value;
  if (typeof value === 'string' || typeof value === 'number') {
    const normalized = String(value).trim();
    return normalized || null;
  }
  return null;
}

function validDate(value: string): Date | null {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

function decimalDifference(first: string, second: string): string {
  return Prisma.Decimal.max(new Prisma.Decimal(first).minus(second), 0).toFixed(2);
}

function decimalSum(values: string[]): string {
  return values.reduce((total, value) => total.plus(value), new Prisma.Decimal(0)).toFixed(2);
}

export function operationStatusFromWoo(status: string): OperationStatus {
  switch (status.trim().toLocaleLowerCase('en')) {
    case 'completed':
      return 'COMPLETED';
    case 'cancelled':
    case 'failed':
    case 'refunded':
      return 'CANCELLED';
    default:
      return 'PENDING';
  }
}

export function operationCodeFromWoo(
  store: WooOrderInboundInput['provider'],
  wooOrderId: string,
): string {
  return `WC-${store === 'SERATUS' ? 'S' : 'P'}-${wooOrderId}`;
}

function customerDraft(input: WooOrderInboundInput) {
  const { billing } = input.order;
  const rawDocumentType = metadata(input.order, 'billing_type_document');
  const documentType = documentTypeFromWoo(rawDocumentType);
  const documentNumber = metadata(input.order, 'billing_identification');
  if (!documentType) {
    throw inboundError(
      'WOO_DOCUMENT_TYPE_REQUIRED',
      'El pedido no contiene un tipo de documento compatible con el CRM.',
    );
  }
  if (!documentNumber) {
    throw inboundError(
      'WOO_DOCUMENT_NUMBER_REQUIRED',
      'El pedido no contiene el número de documento del cliente.',
    );
  }

  const country = billing.country.toUpperCase();
  const knownCountry = country && resolveCountry(country) ? country : null;
  const location =
    knownCountry && billing.state && billing.city
      ? resolveLocationFromWoo(knownCountry, billing.state, billing.city)
      : null;
  const company = normalizeCustomerName(billing.company);
  const personType = documentType === '31' ? ('COMPANY' as const) : ('PERSON' as const);
  const firstName = capitalizeCustomerName(billing.first_name);
  const lastName = capitalizeCustomerName(billing.last_name);
  const displayName =
    personType === 'COMPANY'
      ? company
      : normalizeCustomerName([firstName, lastName].filter(Boolean).join(' '));

  const result = createCustomerSchema.safeParse({
    personType,
    firstName,
    lastName,
    displayName,
    company,
    documentType,
    documentNumber,
    checkDigit: null,
    email: sanitizeCustomerEmail(billing.email),
    phone: normalizeCustomerPhone(billing.phone, knownCountry),
    country: location?.country ?? knownCountry,
    region: location?.region ?? null,
    cityCode: location?.cityCode ?? null,
    postalCode: sanitizePostalCode(billing.postcode),
    addressLine1: sanitizeSiigoAddress(billing.address_1),
    addressLine2: normalizeCustomerName(billing.address_2),
    vatResponsible: false,
    fiscalResponsibilities: ['R-99-PN'],
  });
  if (!result.success) {
    throw inboundError(
      'WOO_CUSTOMER_INVALID',
      result.error.issues[0]?.message || 'Los datos del cliente del pedido no son válidos.',
    );
  }
  return result.data;
}

function address(address: WooOrder['billing']) {
  return {
    firstName: normalizeCustomerName(address.first_name),
    lastName: normalizeCustomerName(address.last_name),
    company: normalizeCustomerName(address.company),
    address1: normalizeCustomerName(address.address_1),
    address2: normalizeCustomerName(address.address_2),
    city: normalizeCustomerName(address.city),
    state: normalizeCustomerName(address.state),
    postcode: sanitizePostalCode(address.postcode),
    country: normalizeCustomerName(address.country)?.toUpperCase() ?? null,
    phone: normalizeCustomerName(address.phone),
  };
}

export function normalizeWooOrderInbound(input: WooOrderInboundInput) {
  const order = input.order;
  const billing = address(order.billing);
  const shippingSource = Object.values(order.shipping).some(Boolean)
    ? order.shipping
    : order.billing;
  const shipping = address(shippingSource);
  const shippingLine = order.shipping_lines[0];
  const localOrderIdValue = metadata(order, 'sevale_crm_order_id');
  const localOrderId =
    localOrderIdValue && /^[1-9]\d*$/.test(localOrderIdValue) ? Number(localOrderIdValue) : null;
  return {
    deliveryId: input.deliveryId,
    event: input.event,
    store: input.provider,
    wooOrderId: order.id,
    wooCustomerId: order.customer_id === '0' ? null : order.customer_id,
    wooStatus: order.status,
    status: operationStatusFromWoo(order.status),
    operationCode: operationCodeFromWoo(input.provider, order.id),
    outboundLocalOrderId: Number.isSafeInteger(localOrderId) ? localOrderId : null,
    outboundOperationCode: metadata(order, 'sevale_crm_operation_code'),
    currency: order.currency,
    wooCreatedAt: validDate(order.date_created),
    wooUpdatedAt: validDate(order.date_modified),
    subtotal: decimalSum(order.line_items.map((item) => item.subtotal)),
    discountTotal: order.discount_total,
    shippingTotal: order.shipping_total,
    total: order.total,
    paymentMethod: normalizeCustomerName(order.payment_method),
    paymentMethodTitle: normalizeCustomerName(order.payment_method_title),
    shippingMethod: normalizeCustomerName(shippingLine?.method_id),
    shippingMethodTitle: normalizeCustomerName(shippingLine?.method_title),
    billing: { ...billing, email: sanitizeCustomerEmail(order.billing.email) },
    shipping,
    customer: customerDraft(input),
    items: order.line_items.map((item) => ({
      wooProductId: item.product_id,
      wooVariationId: item.variation_id === '0' ? null : item.variation_id,
      sku: item.sku,
      name: item.name,
      quantity: item.quantity,
      unitPrice: item.price ?? String(Number(item.subtotal) / item.quantity),
      subtotal: item.subtotal,
      discountTotal: decimalDifference(item.subtotal, item.total),
      total: item.total,
      taxClass: normalizeCustomerName(item.tax_class),
    })),
    coupons: order.coupon_lines.map((coupon) => ({
      code: coupon.code,
      discountTotal: coupon.discount,
    })),
  };
}

export type NormalizedWooOrderInbound = ReturnType<typeof normalizeWooOrderInbound>;
