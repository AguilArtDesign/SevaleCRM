import { Injectable } from '@nestjs/common';
import type { Store } from '../../generated/prisma/client.js';
import {
  integrationGet,
  integrationUrl,
  invalidIntegrationResponse,
  requireIntegrationValue,
} from '../integration-http.js';

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

function storeConfiguration(store: Store) {
  const prefix = store === 'SERATUS' ? 'SERATUS' : 'PALI';
  const label = store === 'SERATUS' ? 'Seratus' : 'Pali';
  return {
    label,
    apiUrl: requireIntegrationValue(`${prefix}_API_URL`, label),
    consumerKey: requireIntegrationValue(`WOOCOMMERCE_${prefix}_CK`, label),
    consumerSecret: requireIntegrationValue(`WOOCOMMERCE_${prefix}_CS`, label),
  };
}

@Injectable()
export class WooCommerceService {
  async searchProductBySku(store: Store, sku: string): Promise<WooCommerceProduct | null> {
    const config = storeConfiguration(store);
    const url = integrationUrl(config.apiUrl, 'products');
    url.searchParams.set('sku', sku);
    url.searchParams.set('per_page', '2');
    const credentials = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString(
      'base64',
    );
    const payload = await integrationGet(
      url,
      { Authorization: `Basic ${credentials}` },
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
}
