import { Injectable } from '@nestjs/common';
import {
  IntegrationAuthenticationException,
  integrationGet,
  integrationUrl,
  invalidIntegrationResponse,
  requireIntegrationValue,
} from '../integration-http.js';
import { SiigoTokenService } from './siigo-token.service.js';

type UnknownRecord = Record<string, unknown>;

export type SiigoProduct = {
  id: string;
  sku: string;
  name: string;
  priceCop: number | null;
  priceUsd: number | null;
  stock: number;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number | null {
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

function normalizeName(value: unknown): string {
  return typeof value === 'string'
    ? value
        .normalize('NFD')
        .replace(/[\u0300-\u036f]/g, '')
        .trim()
        .toUpperCase()
    : '';
}

function priceFrom(product: UnknownRecord, listName: 'PESOS' | 'DOLAR', currency: string) {
  if (!Array.isArray(product.prices)) return null;
  const priceGroups = product.prices.filter(isRecord);
  for (const group of priceGroups) {
    if (!Array.isArray(group.price_list)) continue;
    const lists = group.price_list.filter(isRecord);
    const named = lists.find((entry) => normalizeName(entry.name) === listName);
    const namedValue = named ? finiteNumber(named.value) : null;
    if (namedValue !== null) return namedValue;
  }
  const currencyGroup = priceGroups.find(
    (group) => normalizeName(group.currency_code) === currency,
  );
  if (!currencyGroup || !Array.isArray(currencyGroup.price_list)) return null;
  const first = currencyGroup.price_list.find(isRecord);
  return first ? finiteNumber(first.value) : null;
}

function normalizeProduct(value: unknown, requestedSku: string): SiigoProduct | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const sku = typeof value.code === 'string' ? value.code.trim() : '';
  const name = typeof value.name === 'string' ? value.name.trim() : '';
  const stock = finiteNumber(value.available_quantity);
  if (!id || !sku || stock === null || sku.toUpperCase() !== requestedSku.toUpperCase()) {
    return null;
  }
  return {
    id,
    sku,
    name,
    priceCop: priceFrom(value, 'PESOS', 'COP'),
    priceUsd: priceFrom(value, 'DOLAR', 'USD'),
    stock,
  };
}

@Injectable()
export class SiigoService {
  constructor(private readonly tokenService: SiigoTokenService) {}

  async searchProductBySku(sku: string): Promise<SiigoProduct | null> {
    const token = await this.tokenService.getAccessToken();
    try {
      return await this.requestProductBySku(sku, token);
    } catch (error) {
      if (!(error instanceof IntegrationAuthenticationException)) throw error;
      const renewedToken = await this.tokenService.refreshAccessToken(token);
      return this.requestProductBySku(sku, renewedToken);
    }
  }

  private async requestProductBySku(sku: string, token: string): Promise<SiigoProduct | null> {
    const baseUrl = requireIntegrationValue('SIIGO_API_URL', 'Siigo');
    const partnerId = requireIntegrationValue('SIIGO_PARTNER_ID', 'Siigo');
    const url = integrationUrl(baseUrl, 'products');
    url.searchParams.set('code', sku);
    url.searchParams.set('page', '1');
    url.searchParams.set('page_size', '2');

    const payload = await integrationGet(
      url,
      { Authorization: `Bearer ${token}`, 'Partner-Id': partnerId },
      'Siigo',
    );
    if (!isRecord(payload) || !Array.isArray(payload.results)) {
      throw invalidIntegrationResponse('Siigo');
    }
    const matches = payload.results
      .map((product) => normalizeProduct(product, sku))
      .filter((product): product is SiigoProduct => product !== null);
    if (payload.results.length > 0 && matches.length === 0) {
      throw invalidIntegrationResponse('Siigo');
    }
    if (matches.length > 1) throw invalidIntegrationResponse('Siigo');
    return matches[0] ?? null;
  }
}
