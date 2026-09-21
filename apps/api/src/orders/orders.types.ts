import type { Prisma, Store } from '../generated/prisma/client.js';

export type PreparedOrderItem = {
  productId: number;
  skuSnapshot: string;
  nameSnapshot: string;
  storeSnapshot: Store;
  quantity: number;
  originalPrice: Prisma.Decimal;
  unitPrice: Prisma.Decimal;
  priceModified: boolean;
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  total: Prisma.Decimal;
};

export type PreparedOrderCoupon = {
  code: string;
  discountTotal: Prisma.Decimal;
};

export type PreparedStoreOrder = {
  store: Store;
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  shippingTotal: Prisma.Decimal;
  total: Prisma.Decimal;
  items: PreparedOrderItem[];
  coupons: PreparedOrderCoupon[];
};

export type PreparedOperation = {
  customerId: number;
  currency: string;
  paymentMethod: string | null;
  paymentMethodTitle: string | null;
  shippingMethod: string | null;
  shippingMethodTitle: string | null;
  subtotal: Prisma.Decimal;
  discountTotal: Prisma.Decimal;
  shippingTotal: Prisma.Decimal;
  total: Prisma.Decimal;
  billingFirstName: string | null;
  billingLastName: string | null;
  billingCompany: string | null;
  billingAddress1: string | null;
  billingAddress2: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingPostcode: string | null;
  billingCountry: string | null;
  billingEmail: string | null;
  billingPhone: string | null;
  shippingFirstName: string | null;
  shippingLastName: string | null;
  shippingCompany: string | null;
  shippingAddress1: string | null;
  shippingAddress2: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingPostcode: string | null;
  shippingCountry: string | null;
  shippingPhone: string | null;
  orders: PreparedStoreOrder[];
};
