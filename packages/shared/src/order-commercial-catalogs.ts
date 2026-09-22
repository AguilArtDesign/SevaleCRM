import couponTypesCatalog from './coupon-types.json' with { type: 'json' };
import paymentMethodsCatalog from './payment-methods.json' with { type: 'json' };
import shippingMethodsCatalog from './shipping-methods.json' with { type: 'json' };

export const paymentMethods = paymentMethodsCatalog.paymentMethods;
export const shippingMethods = shippingMethodsCatalog.shippingMethods;
export const couponTypes = couponTypesCatalog.couponTypes;

export type PaymentMethodCode = (typeof paymentMethods)[number]['payment_method'];
export type ShippingMethodCode = (typeof shippingMethods)[number]['shipping_method'];
export type CouponTypeCode = (typeof couponTypes)[number]['type'];

export function resolvePaymentMethod(value: string) {
  return paymentMethods.find(({ payment_method }) => payment_method === value) ?? null;
}

export function resolveShippingMethod(value: string) {
  return shippingMethods.find(({ shipping_method }) => shipping_method === value) ?? null;
}

export function resolveCouponType(value: string) {
  return couponTypes.find(({ type, active }) => active && type === value) ?? null;
}
