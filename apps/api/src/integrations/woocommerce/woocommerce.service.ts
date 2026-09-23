import { Injectable } from '@nestjs/common';
import type { Store } from '../../generated/prisma/client.js';
import {
  integrationDelete,
  integrationGet,
  integrationPost,
  integrationPut,
  integrationUrl,
  invalidIntegrationResponse,
} from '../integration-http.js';
import {
  wooCommerceAuthorizationHeaders,
  wooCommerceConfiguration,
} from './woocommerce-configuration.js';

type UnknownRecord = Record<string, unknown>;

export type WooCommerceProduct = {
  store: Store;
  parentId: string | null;
  variationId: string;
  sku: string;
  priceCop: number | null;
  priceUsd: number | null;
  stock: number | null;
  productName: string;
  imageUrl: string | null;
  dataWarnings: string[];
};

export type WooCommerceProductUpdate = {
  store: Store;
  parentId: string | null;
  productId: string;
  priceCop: number;
  priceUsd: number;
  stock: number;
};

export type WooCommerceBatchProductUpdate = Omit<WooCommerceProductUpdate, 'store' | 'parentId'>;

export type WooCommerceBatchUpdateResult = {
  productId: string;
  success: boolean;
  error: string | null;
};

export type WooCommerceOrderCreatePayload = {
  customer_id: number;
  currency: string;
  payment_method?: string;
  payment_method_title?: string;
  set_paid: true;
  billing: Record<string, string>;
  shipping: Record<string, string>;
  line_items: Array<{
    product_id: number;
    variation_id?: number;
    quantity: number;
    subtotal: string;
    total: string;
  }>;
  shipping_lines?: Array<{ method_id: string; method_title: string; total: string }>;
  coupon_lines?: Array<{ code: string }>;
  meta_data: Array<{ key: string; value: string }>;
};

export type WooCommerceOrderReference = {
  id: string;
  status: string;
  dateCreated: Date | null;
  dateModified: Date | null;
};

export type WooCommerceShipmentUpdate = {
  carrier: string;
  trackingNumber: string;
  status: string;
};

export type WooCommerceCouponPayload = {
  code: string;
  description: string;
  discount_type: string;
  amount: string;
  date_expires: string;
  individual_use: boolean;
  exclude_sale_items: boolean;
  // Sin límite se envía 0, no cadena vacía ni null: WordPress rechaza la cadena vacía en campos
  // de tipo entero y el controlador ignora un null, de modo que 0 es el único valor que borra la
  // restricción. Es además lo que almacena el propio panel de WooCommerce al dejar el campo vacío
  // (WC_Coupon::set_usage_limit aplica absint) y su validación lo interpreta como "sin límite".
  usage_limit: number;
  usage_limit_per_user: number;
};

export type WooCommerceCouponReference = {
  id: string;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function identifier(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  return null;
}

function date(value: unknown): Date | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  const result = new Date(value);
  return Number.isNaN(result.getTime()) ? null : result;
}

function orderMetadata(value: unknown, key: string): string | null {
  if (!isRecord(value) || !Array.isArray(value.meta_data)) return null;
  for (const item of value.meta_data) {
    if (!isRecord(item) || item.key !== key) continue;
    if (typeof item.value === 'string' || typeof item.value === 'number') {
      return String(item.value).trim() || null;
    }
  }
  return null;
}

function normalizeOrder(value: unknown): WooCommerceOrderReference | null {
  if (!isRecord(value)) return null;
  const id = identifier(value.id);
  const status = typeof value.status === 'string' ? value.status.trim() : '';
  if (!id || !status) return null;
  return {
    id,
    status,
    dateCreated: date(value.date_created),
    dateModified: date(value.date_modified),
  };
}

function updateBody(update: WooCommerceBatchProductUpdate) {
  return {
    regular_price: String(update.priceCop),
    stock_quantity: update.stock,
    manage_stock: true,
    meta_data: [
      {
        key: '_regular_price_wmcp',
        value: JSON.stringify({ USD: String(update.priceUsd) }),
      },
    ],
  };
}

function usdPrice(metaData: unknown): { price: number | null; invalid: boolean } {
  if (!Array.isArray(metaData)) return { price: null, invalid: false };
  const entry = metaData.filter(isRecord).find((item) => item.key === '_regular_price_wmcp');
  if (!entry || entry.value === null || entry.value === '') {
    return { price: null, invalid: false };
  }
  let value: unknown = entry.value;
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value) as unknown;
    } catch {
      return { price: null, invalid: true };
    }
  }
  if (!isRecord(value)) return { price: null, invalid: true };
  const price = finiteNumber(value.USD);
  return { price, invalid: price === null };
}

function imageUrl(product: UnknownRecord): string | null {
  if (isRecord(product.image) && typeof product.image.src === 'string') {
    return product.image.src;
  }
  if (Array.isArray(product.images)) {
    const firstImage = product.images.find(isRecord);
    if (firstImage && typeof firstImage.src === 'string') return firstImage.src;
  }
  return null;
}

function normalizeProduct(
  value: unknown,
  store: Store,
  requestedSku: string,
): WooCommerceProduct | null {
  if (!isRecord(value)) return null;
  const variationId = identifier(value.id);
  const parentId = identifier(value.parent_id);
  const sku = typeof value.sku === 'string' ? value.sku.trim() : '';
  const productName = typeof value.name === 'string' ? value.name.trim() : '';
  if (!variationId || !sku || sku.toUpperCase() !== requestedSku.toUpperCase()) return null;
  const usd = usdPrice(value.meta_data);
  return {
    store,
    parentId,
    variationId,
    sku,
    priceCop: finiteNumber(value.price ?? value.regular_price),
    priceUsd: usd.price,
    stock: finiteNumber(value.stock_quantity),
    productName,
    imageUrl: imageUrl(value),
    dataWarnings: usd.invalid ? ['INVALID_USD_PRICE'] : [],
  };
}

@Injectable()
export class WooCommerceService {
  async updateOrderShipment(
    store: Store,
    orderId: string,
    shipment: WooCommerceShipmentUpdate,
  ): Promise<WooCommerceOrderReference> {
    const config = wooCommerceConfiguration(store);
    const normalizedOrderId = identifier(orderId);
    if (!normalizedOrderId) throw invalidIntegrationResponse(config.label);
    const metadata = [
      { key: '_wot_tracking_carrier', value: shipment.carrier },
      { key: '_wot_tracking_number', value: shipment.trackingNumber },
      { key: '_wot_tracking_status', value: shipment.status },
    ];
    const response = await integrationPut(
      integrationUrl(config.apiUrl, `orders/${normalizedOrderId}`),
      wooCommerceAuthorizationHeaders(config),
      { meta_data: metadata },
      config.label,
      { timeoutMs: 30_000, retryCount: 1 },
    );
    const order = normalizeOrder(response);
    if (
      !order ||
      order.id !== normalizedOrderId ||
      metadata.some(({ key, value }) => orderMetadata(response, key) !== value)
    ) {
      throw invalidIntegrationResponse(config.label);
    }
    return order;
  }

  async findOrderByExternalKey(
    store: Store,
    customerId: string,
    externalKey: string,
  ): Promise<WooCommerceOrderReference | null> {
    const config = wooCommerceConfiguration(store);
    const normalizedCustomerId = identifier(customerId);
    if (!normalizedCustomerId) throw invalidIntegrationResponse(config.label);

    for (let page = 1; page <= 10; page += 1) {
      const url = integrationUrl(config.apiUrl, 'orders');
      url.searchParams.set('customer', normalizedCustomerId);
      url.searchParams.set('status', 'any');
      url.searchParams.set('orderby', 'date');
      url.searchParams.set('order', 'desc');
      url.searchParams.set('per_page', '100');
      url.searchParams.set('page', String(page));
      const payload = await integrationGet(
        url,
        wooCommerceAuthorizationHeaders(config),
        config.label,
        { timeoutMs: 20_000, retryCount: 1 },
      );
      if (!Array.isArray(payload)) throw invalidIntegrationResponse(config.label);
      const orders: unknown[] = payload;
      const match = orders.find(
        (order) => orderMetadata(order, 'sevale_crm_order_key') === externalKey,
      );
      if (match) {
        const normalized = normalizeOrder(match);
        if (!normalized) throw invalidIntegrationResponse(config.label);
        return normalized;
      }
      if (orders.length < 100) return null;
    }
    return null;
  }

  async createOrder(
    store: Store,
    body: WooCommerceOrderCreatePayload,
  ): Promise<WooCommerceOrderReference> {
    const config = wooCommerceConfiguration(store);
    const response = await integrationPost(
      integrationUrl(config.apiUrl, 'orders'),
      wooCommerceAuthorizationHeaders(config),
      body,
      config.label,
      { timeoutMs: 30_000 },
    );
    const order = normalizeOrder(response);
    const externalKey = body.meta_data.find(({ key }) => key === 'sevale_crm_order_key')?.value;
    if (!order || !externalKey || orderMetadata(response, 'sevale_crm_order_key') !== externalKey) {
      throw invalidIntegrationResponse(config.label);
    }
    return order;
  }

  async searchProductBySku(store: Store, sku: string): Promise<WooCommerceProduct | null> {
    const config = wooCommerceConfiguration(store);
    const url = integrationUrl(config.apiUrl, 'products');
    url.searchParams.set('sku', sku);
    url.searchParams.set('per_page', '2');
    const payload = await integrationGet(
      url,
      wooCommerceAuthorizationHeaders(config),
      config.label,
    );
    if (!Array.isArray(payload)) throw invalidIntegrationResponse(config.label);
    const matches = payload
      .map((product) => normalizeProduct(product, store, sku))
      .filter((product): product is WooCommerceProduct => product !== null);
    if (payload.length > 0 && matches.length === 0) {
      throw invalidIntegrationResponse(config.label);
    }
    if (matches.length > 1) throw invalidIntegrationResponse(config.label);
    return matches[0] ?? null;
  }

  async updateProduct({
    store,
    parentId,
    productId,
    priceCop,
    priceUsd,
    stock,
  }: WooCommerceProductUpdate): Promise<void> {
    const config = wooCommerceConfiguration(store);
    const normalizedProductId = identifier(productId);
    const normalizedParentId = parentId === null ? null : identifier(parentId);
    if (!normalizedProductId || (parentId !== null && !normalizedParentId)) {
      throw invalidIntegrationResponse(config.label);
    }

    const path = normalizedParentId
      ? `products/${normalizedParentId}/variations/${normalizedProductId}`
      : `products/${normalizedProductId}`;
    const url = integrationUrl(config.apiUrl, path);
    const payload = await integrationPut(
      url,
      wooCommerceAuthorizationHeaders(config),
      updateBody({ productId, priceCop, priceUsd, stock }),
      config.label,
      { timeoutMs: 20_000, retryCount: 1 },
    );

    if (!isRecord(payload) || identifier(payload.id) !== normalizedProductId) {
      throw invalidIntegrationResponse(config.label);
    }
  }

  async updateProductsBatch({
    store,
    parentId,
    updates,
  }: {
    store: Store;
    parentId: string | null;
    updates: WooCommerceBatchProductUpdate[];
  }): Promise<WooCommerceBatchUpdateResult[]> {
    const config = wooCommerceConfiguration(store);
    const normalizedParentId = parentId === null ? null : identifier(parentId);
    if (parentId !== null && !normalizedParentId) throw invalidIntegrationResponse(config.label);

    const normalizedUpdates = updates.map((update) => {
      const productId = identifier(update.productId);
      const numericId = Number(productId);
      if (!productId || !Number.isSafeInteger(numericId) || numericId <= 0) {
        throw invalidIntegrationResponse(config.label);
      }
      return { ...update, productId, numericId };
    });
    const path = normalizedParentId
      ? `products/${normalizedParentId}/variations/batch`
      : 'products/batch';
    const payload = await integrationPost(
      integrationUrl(config.apiUrl, path),
      wooCommerceAuthorizationHeaders(config),
      {
        update: normalizedUpdates.map((update) => ({
          id: update.numericId,
          ...updateBody(update),
        })),
      },
      config.label,
      { timeoutMs: 30_000, retryCount: 1 },
    );
    if (!isRecord(payload)) {
      throw invalidIntegrationResponse(config.label);
    }
    const updatedItems = payload.update;
    if (!Array.isArray(updatedItems)) throw invalidIntegrationResponse(config.label);

    return normalizedUpdates.map((update, index) => {
      const result: unknown = updatedItems[index];
      if (isRecord(result) && identifier(result.id) === update.productId) {
        return { productId: update.productId, success: true, error: null };
      }
      const message =
        isRecord(result) && isRecord(result.error) && typeof result.error.message === 'string'
          ? result.error.message
          : `${config.label} no confirmó la actualización del producto.`;
      return { productId: update.productId, success: false, error: message };
    });
  }

  async createCoupon(
    store: Store,
    payload: WooCommerceCouponPayload,
  ): Promise<WooCommerceCouponReference> {
    const config = wooCommerceConfiguration(store);
    const response = await integrationPost(
      integrationUrl(config.apiUrl, 'coupons'),
      wooCommerceAuthorizationHeaders(config),
      payload,
      config.label,
      { timeoutMs: 20_000 },
    );
    return this.confirmCoupon(response, payload, config.label);
  }

  async updateCoupon(
    store: Store,
    couponId: number,
    payload: WooCommerceCouponPayload,
  ): Promise<WooCommerceCouponReference> {
    const config = wooCommerceConfiguration(store);
    const id = identifier(couponId);
    if (!id) throw invalidIntegrationResponse(config.label);
    const response = await integrationPut(
      integrationUrl(config.apiUrl, `coupons/${id}`),
      wooCommerceAuthorizationHeaders(config),
      payload,
      config.label,
      { timeoutMs: 20_000, retryCount: 1 },
    );
    const result = this.confirmCoupon(response, payload, config.label);
    if (result.id !== id) throw invalidIntegrationResponse(config.label);
    return result;
  }

  async deleteCoupon(store: Store, couponId: number): Promise<void> {
    const config = wooCommerceConfiguration(store);
    const id = identifier(couponId);
    if (!id) throw invalidIntegrationResponse(config.label);
    const url = integrationUrl(config.apiUrl, `coupons/${id}`);
    // Sin force, WooCommerce mueve el cupón a la papelera y mantiene el código ocupado.
    url.searchParams.set('force', 'true');
    const response = await integrationDelete(
      url,
      wooCommerceAuthorizationHeaders(config),
      config.label,
      { timeoutMs: 20_000, retryCount: 1 },
    );
    if (!isRecord(response) || response.deleted !== true) {
      throw invalidIntegrationResponse(config.label);
    }
  }

  private confirmCoupon(
    response: unknown,
    expected: WooCommerceCouponPayload,
    label: string,
  ): WooCommerceCouponReference {
    if (!isRecord(response)) throw invalidIntegrationResponse(label);
    const id = identifier(response.id);
    if (!id) throw invalidIntegrationResponse(label);
    // WooCommerce normaliza el código a minúsculas; el CRM lo envía ya normalizado.
    if (typeof response.code === 'string' && response.code !== expected.code) {
      throw invalidIntegrationResponse(label);
    }
    return { id };
  }
}
