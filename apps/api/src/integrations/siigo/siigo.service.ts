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
  /** Tipo de cotización configurado en Siigo. */
  documentId: number;
  /** Centro de costo que exige el comprobante. */
  costCenter: number;
  customerExternalId: string;
  customerIdentification: string;
  sellerId: number;
  currency: 'COP' | 'USD';
  exchangeRate?: number;
  date: string;
  items: Array<{
    code: string;
    description: string;
    quantity: number;
    price: number;
    /** Descuento en porcentaje sobre el precio del ítem. */
    discountPercent: number;
    taxId: number;
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
  return {
    id,
    active: value.active !== false,
    discountType: value.discount_type,
    automaticNumber: value.automatic_number === true,
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
    // El tipo de documento se confirma contra Siigo para conocer cómo interpreta el descuento
    // (valor o porcentaje) y para no enviar un comprobante inactivo. Los productos no se consultan:
    // el código de cada ítem es el SKU que el inventario ya tiene vinculado.
    const [documentPayload, customerPayload] = await Promise.all([
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
    ]);

    const document = this.resolveQuotationDocument(documentPayload, input.documentId);
    const customer = this.resolveQuotationCustomer(customerPayload, input.customerIdentification);

    const payload = {
      document: { id: document.id },
      date: input.date,
      customer: {
        identification: customer.identification,
        branch_office: customer.branchOffice,
      },
      cost_center: input.costCenter,
      ...(input.currency === 'USD'
        ? { currency: { code: 'USD', exchange_rate: input.exchangeRate } }
        : {}),
      seller: input.sellerId,
      items: input.items.map((item) => {
        // El descuento ya viene como porcentaje, que es lo que usa el comprobante. Un comprobante
        // configurado por valor necesita la conversión sobre el total de la línea.
        const discount =
          document.discountType === 'Percentage'
            ? round(item.discountPercent, 2)
            : round((item.price * item.quantity * item.discountPercent) / 100, 2);
        return {
          code: item.code,
          description: item.description,
          quantity: item.quantity,
          price: round(item.price, 6),
          taxes: [{ id: item.taxId }],
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
    return this.normalizeQuotationResponse(response, input.sellerId);
  }

  private resolveQuotationDocument(payload: unknown, expectedId: number): QuotationDocument {
    const document = collection(payload)
      .map(normalizeDocument)
      .find((candidate): candidate is QuotationDocument =>
        Boolean(candidate?.active && candidate.id === expectedId),
      );
    if (!document) {
      throw quotationConfigurationError(
        `El tipo de cotización ${expectedId} no existe o está inactivo en Siigo.`,
      );
    }
    return this.ensureSupportedDocument(document);
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
    };
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
