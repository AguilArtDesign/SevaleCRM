import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import {
  IntegrationAuthenticationException,
  integrationGet,
  integrationPost,
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

export type SiigoQuotationCreateInput = {
  customerExternalId: string;
  customerIdentification: string;
  currency: 'COP' | 'USD';
  exchangeRate?: number;
  date: string;
  items: Array<{
    productExternalId: string;
    description: string;
    quantity: number;
    price: number;
    discountValue: number;
  }>;
};

export type SiigoQuotationReference = {
  id: string;
  number: string;
  name: string;
  publicUrl: string | null;
  sellerId: string;
  exchangeRate: number | null;
};

type QuotationDocument = {
  id: number;
  active: boolean;
  discountType: 'Percentage' | 'Value';
  automaticNumber: boolean;
  costCenter: number | null;
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

function positiveInteger(value: unknown): number | null {
  const number = finiteNumber(value);
  return number !== null && Number.isSafeInteger(number) && number > 0 ? number : null;
}

function quotationConfigurationError(message: string) {
  return new ServiceUnavailableException({
    success: false,
    error: { code: 'SIIGO_QUOTATION_CONFIGURATION_REQUIRED', message },
  });
}

function configuredPositiveInteger(name: string): number | null {
  const value = process.env[name]?.trim();
  if (!value) return null;
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number <= 0) {
    throw quotationConfigurationError(`La variable ${name} no contiene un identificador válido.`);
  }
  return number;
}

function normalizeDocument(value: unknown): QuotationDocument | null {
  if (!isRecord(value)) return null;
  const id = positiveInteger(value.id);
  if (
    !id ||
    value.type !== 'C' ||
    (value.discount_type !== 'Value' && value.discount_type !== 'Percentage')
  ) {
    return null;
  }
  const costCenter = positiveInteger(value.cost_center_default);
  if (value.cost_center_mandatory === true && !costCenter) return null;
  return {
    id,
    active: value.active !== false,
    discountType: value.discount_type,
    automaticNumber: value.automatic_number === true,
    costCenter,
  };
}

function collection(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (isRecord(value) && Array.isArray(value.results)) return value.results;
  return isRecord(value) && 'id' in value ? [value] : [];
}

function round(value: number, decimals: number): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
}

function safeSiigoPublicUrl(value: unknown): string | null {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const url = new URL(value);
    if (
      url.protocol !== 'https:' ||
      (url.hostname !== 'siigo.com' && !url.hostname.endsWith('.siigo.com'))
    ) {
      return null;
    }
    return url.toString();
  } catch {
    return null;
  }
}

@Injectable()
export class SiigoService {
  constructor(private readonly tokenService: SiigoTokenService) {}

  async searchProductBySku(sku: string): Promise<SiigoProduct | null> {
    return this.withAuthenticationRetry((token) => this.requestProductBySku(sku, token));
  }

  async createQuotation(input: SiigoQuotationCreateInput): Promise<SiigoQuotationReference> {
    return this.withAuthenticationRetry((token) => this.requestCreateQuotation(input, token));
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

  private async requestCreateQuotation(
    input: SiigoQuotationCreateInput,
    token: string,
  ): Promise<SiigoQuotationReference> {
    const baseUrl = requireIntegrationValue('SIIGO_API_URL', 'Siigo');
    const partnerId = requireIntegrationValue('SIIGO_PARTNER_ID', 'Siigo');
    const headers = { Authorization: `Bearer ${token}`, 'Partner-Id': partnerId };
    const [documentPayload, customerPayload, products] = await Promise.all([
      integrationGet(
        (() => {
          const url = integrationUrl(baseUrl, 'document-types');
          url.searchParams.set('type', 'C');
          return url;
        })(),
        headers,
        'Siigo',
      ),
      integrationGet(
        integrationUrl(baseUrl, `customers/${encodeURIComponent(input.customerExternalId)}`),
        headers,
        'Siigo',
      ),
      Promise.all(
        [...new Set(input.items.map(({ productExternalId }) => productExternalId))].map(
          async (productExternalId) => ({
            productExternalId,
            payload: await integrationGet(
              integrationUrl(baseUrl, `products/${encodeURIComponent(productExternalId)}`),
              headers,
              'Siigo',
            ),
          }),
        ),
      ),
    ]);

    const document = this.resolveQuotationDocument(documentPayload);
    const customer = this.resolveQuotationCustomer(customerPayload, input.customerIdentification);
    const sellerId = await this.resolveSellerId(customer.sellerId, baseUrl, headers);
    const productCodes = new Map<string, string>();
    for (const { productExternalId, payload } of products) {
      if (!isRecord(payload)) throw invalidIntegrationResponse('Siigo');
      const id = typeof payload.id === 'string' ? payload.id.trim() : '';
      const code = typeof payload.code === 'string' ? payload.code.trim() : '';
      if (id !== productExternalId || !code || payload.active === false) {
        throw quotationConfigurationError(
          `El producto vinculado con Siigo (${productExternalId}) no existe o está inactivo.`,
        );
      }
      productCodes.set(productExternalId, code);
    }

    const payload = {
      document: { id: document.id },
      date: input.date,
      customer: {
        identification: customer.identification,
        branch_office: customer.branchOffice,
      },
      ...(document.costCenter ? { cost_center: document.costCenter } : {}),
      ...(input.currency === 'USD'
        ? { currency: { code: 'USD', exchange_rate: input.exchangeRate } }
        : {}),
      seller: sellerId,
      items: input.items.map((item) => {
        const subtotal = item.price * item.quantity;
        const discount =
          document.discountType === 'Value'
            ? round(item.discountValue, 2)
            : subtotal > 0
              ? round((item.discountValue / subtotal) * 100, 6)
              : 0;
        return {
          code: productCodes.get(item.productExternalId),
          description: item.description,
          quantity: item.quantity,
          price: round(item.price, 6),
          discount,
        };
      }),
    };
    const response = await integrationPost(
      integrationUrl(baseUrl, 'quotations'),
      headers,
      payload,
      'Siigo',
    );
    return this.normalizeQuotationResponse(response, sellerId);
  }

  private resolveQuotationDocument(payload: unknown): QuotationDocument {
    const active = collection(payload)
      .map(normalizeDocument)
      .filter((document): document is QuotationDocument => Boolean(document?.active));
    const configuredId = configuredPositiveInteger('SIIGO_QUOTATION_DOCUMENT_ID');
    if (configuredId) {
      const configured = active.find(({ id }) => id === configuredId);
      if (configured) return this.ensureSupportedDocument(configured);
      throw quotationConfigurationError(
        'El tipo de cotización configurado no existe o está inactivo en Siigo.',
      );
    }
    if (active.length === 1) return this.ensureSupportedDocument(active[0]!);
    if (active.length === 0) {
      throw quotationConfigurationError('No existe un tipo de cotización activo en Siigo.');
    }
    throw quotationConfigurationError(
      'Hay varios tipos de cotización activos. Configura SIIGO_QUOTATION_DOCUMENT_ID.',
    );
  }

  private ensureSupportedDocument(document: QuotationDocument): QuotationDocument {
    if (!document.automaticNumber) {
      throw quotationConfigurationError(
        'El tipo de cotización seleccionado usa numeración manual. Activa la numeración automática en Siigo.',
      );
    }
    return document;
  }

  private resolveQuotationCustomer(payload: unknown, expectedIdentification: string) {
    if (!isRecord(payload)) throw invalidIntegrationResponse('Siigo');
    const id = typeof payload.id === 'string' ? payload.id.trim() : '';
    const identification =
      typeof payload.identification === 'string' ? payload.identification.trim() : '';
    if (!id || identification !== expectedIdentification || payload.active === false) {
      throw quotationConfigurationError(
        'El vínculo del cliente con Siigo no corresponde a un cliente activo.',
      );
    }
    return {
      identification,
      branchOffice: Math.max(0, Math.trunc(finiteNumber(payload.branch_office) ?? 0)),
      sellerId: positiveInteger(payload.seller_id),
    };
  }

  private async resolveSellerId(
    customerSellerId: number | null,
    baseUrl: string,
    headers: HeadersInit,
  ): Promise<number> {
    if (customerSellerId) return customerSellerId;
    const configuredId = configuredPositiveInteger('SIIGO_QUOTATION_SELLER_ID');
    if (configuredId) return configuredId;
    const url = integrationUrl(baseUrl, 'users');
    url.searchParams.set('page', '1');
    url.searchParams.set('page_size', '100');
    const payload = await integrationGet(url, headers, 'Siigo');
    const activeIds = collection(payload)
      .filter((value): value is UnknownRecord => isRecord(value) && value.active !== false)
      .map(({ id }) => positiveInteger(id))
      .filter((id): id is number => id !== null);
    if (activeIds.length === 1) return activeIds[0]!;
    throw quotationConfigurationError(
      'El cliente no tiene vendedor asignado. Configura SIIGO_QUOTATION_SELLER_ID.',
    );
  }

  private normalizeQuotationResponse(payload: unknown, sellerId: number): SiigoQuotationReference {
    if (!isRecord(payload)) throw invalidIntegrationResponse('Siigo');
    const id = typeof payload.id === 'string' ? payload.id.trim() : '';
    const number = positiveInteger(payload.number);
    const name = typeof payload.name === 'string' ? payload.name.trim() : '';
    const publicUrl = safeSiigoPublicUrl(payload.public_url);
    const currency = isRecord(payload.currency) ? payload.currency : null;
    const exchangeRate = currency ? finiteNumber(currency.exchange_rate) : null;
    if (!id || !number || !name) throw invalidIntegrationResponse('Siigo');
    return {
      id,
      number: String(number),
      name,
      publicUrl,
      sellerId: String(sellerId),
      exchangeRate,
    };
  }

  private async withAuthenticationRetry<T>(request: (token: string) => Promise<T>): Promise<T> {
    const token = await this.tokenService.getAccessToken();
    try {
      return await request(token);
    } catch (error) {
      if (!(error instanceof IntegrationAuthenticationException)) throw error;
      const renewedToken = await this.tokenService.refreshAccessToken(token);
      return request(renewedToken);
    }
  }
}
