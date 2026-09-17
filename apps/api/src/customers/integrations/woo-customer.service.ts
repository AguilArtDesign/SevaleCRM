import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import type { Store } from '../../generated/prisma/client.js';
import {
  integrationGet,
  integrationPost,
  integrationPut,
  integrationUrl,
  invalidIntegrationResponse,
} from '../../integrations/integration-http.js';
import {
  wooCommerceAuthorizationHeaders,
  wooCommerceConfiguration,
  type WooCommerceConfiguration,
} from '../../integrations/woocommerce/woocommerce-configuration.js';
import type { CustomerMappingSource } from '../mapping/customer-mapping.types.js';
import { WooCustomerMapper, type WooCustomerPayload } from '../mapping/woo-customer.mapper.js';

type UnknownRecord = Record<string, unknown>;

type WooCustomerCreatePayload = WooCustomerPayload & { password: string };

function createCustomerPassword(): string {
  // 192 bits of entropy plus every character class commonly required by WordPress.
  return `${randomBytes(24).toString('base64url')}aA1!`;
}

export type WooCustomerReference = {
  id: string;
  email: string;
  first_name: string;
  last_name: string;
  username: string;
  billing: {
    first_name: string;
    last_name: string;
    company: string;
    address_1: string;
    address_2: string;
    city: string;
    postcode: string;
    country: string;
    state: string;
    email: string;
    phone: string;
  };
  meta_data: Array<{
    id: number | null;
    key: 'billing_type_document' | 'billing_identification';
    value: string;
  }>;
};

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function identifier(value: unknown): string | null {
  if (typeof value === 'number' && Number.isSafeInteger(value) && value > 0) return String(value);
  if (typeof value === 'string' && /^[1-9]\d*$/.test(value)) return value;
  return null;
}

function text(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function metadataId(value: unknown): number | null {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : null;
}

function normalizeCustomer(value: unknown): WooCustomerReference | null {
  if (!isRecord(value)) return null;
  const id = identifier(value.id);
  const email = text(value.email).toLowerCase();
  const username = text(value.username);
  if (!id || !username) return null;
  const billing = isRecord(value.billing) ? value.billing : {};
  const metadata = Array.isArray(value.meta_data) ? value.meta_data : [];
  const meta_data: WooCustomerReference['meta_data'] = [];
  for (const entry of metadata) {
    if (!isRecord(entry)) continue;
    const key = text(entry.key);
    if (key !== 'billing_type_document' && key !== 'billing_identification') continue;
    meta_data.push({ id: metadataId(entry.id), key, value: text(entry.value) });
  }
  return {
    id,
    email,
    first_name: text(value.first_name),
    last_name: text(value.last_name),
    username,
    billing: {
      first_name: text(billing.first_name),
      last_name: text(billing.last_name),
      company: text(billing.company),
      address_1: text(billing.address_1),
      address_2: text(billing.address_2),
      city: text(billing.city),
      postcode: text(billing.postcode),
      country: text(billing.country).toUpperCase(),
      state: text(billing.state).toUpperCase(),
      email: text(billing.email).toLowerCase(),
      phone: text(billing.phone),
    },
    meta_data,
  };
}

function requireEmail(value: string | null): string {
  if (value) return value.trim().toLowerCase();
  throw new BadRequestException({
    success: false,
    error: {
      code: 'WOOCOMMERCE_CUSTOMER_EMAIL_REQUIRED',
      message: 'Completa el correo antes de sincronizar con WooCommerce.',
    },
  });
}

@Injectable()
export class WooCustomerService {
  constructor(private readonly mapper: WooCustomerMapper) {}

  async findCustomerByDocument(
    store: Store,
    documentNumber: string,
  ): Promise<WooCustomerReference | null> {
    const config = wooCommerceConfiguration(store);
    const username = documentNumber.trim();
    const matches = (await this.search(config, 'search', username)).filter(
      (result) => result.username === username,
    );
    if (matches.length === 0) return null;
    if (matches.length === 1) return matches[0] ?? null;
    throw this.conflict(config.label);
  }

  async findCustomer(
    store: Store,
    customer: Pick<CustomerMappingSource, 'documentNumber' | 'email'>,
  ): Promise<WooCustomerReference | null> {
    const config = wooCommerceConfiguration(store);
    const username = customer.documentNumber.trim();
    const email = requireEmail(customer.email);
    const [emailResults, usernameResults] = await Promise.all([
      this.search(config, 'email', email),
      this.search(config, 'search', username),
    ]);
    const emailMatches = emailResults.filter((result) => result.email === email);
    const usernameMatches = usernameResults.filter((result) => result.username === username);
    const candidates = new Map(
      [...emailMatches, ...usernameMatches].map((result) => [result.id, result]),
    );
    const exact = [...candidates.values()].filter(
      (result) => result.email === email && result.username === username,
    );
    if (candidates.size === 0) return null;
    if (candidates.size === 1 && exact.length === 1) return exact[0] ?? null;
    throw this.conflict(config.label);
  }

  async createCustomer(
    store: Store,
    customer: CustomerMappingSource,
  ): Promise<WooCustomerReference> {
    const config = wooCommerceConfiguration(store);
    const body: WooCustomerCreatePayload = {
      ...this.mapper.map(customer),
      password: createCustomerPassword(),
    };
    const response = await integrationPost(
      integrationUrl(config.apiUrl, 'customers'),
      wooCommerceAuthorizationHeaders(config),
      body,
      config.label,
      { timeoutMs: 20_000 },
    );
    return this.confirmResponse(response, body, config.label);
  }

  async updateCustomer(
    store: Store,
    externalId: string,
    customer: CustomerMappingSource,
  ): Promise<WooCustomerReference> {
    const config = wooCommerceConfiguration(store);
    const id = identifier(externalId.trim());
    if (!id) throw invalidIntegrationResponse(config.label);
    const body = this.mapper.map(customer);
    await this.ensureUpdateIdentityAvailable(config, id, body.email, body.username);
    const response = await integrationPut(
      integrationUrl(config.apiUrl, `customers/${id}`),
      wooCommerceAuthorizationHeaders(config),
      body,
      config.label,
      { timeoutMs: 20_000, retryCount: 1 },
    );
    const result = this.confirmResponse(response, body, config.label);
    if (result.id !== id) throw invalidIntegrationResponse(config.label);
    return result;
  }

  private async ensureUpdateIdentityAvailable(
    config: WooCommerceConfiguration,
    externalId: string,
    email: string,
    username: string,
  ): Promise<void> {
    const [emailResults, usernameResults] = await Promise.all([
      this.search(config, 'email', email.toLowerCase()),
      this.search(config, 'search', username),
    ]);
    const belongsToAnotherCustomer = [...emailResults, ...usernameResults].some(
      (candidate) => candidate.id !== externalId,
    );
    if (belongsToAnotherCustomer) throw this.conflict(config.label);
  }

  private async search(
    config: WooCommerceConfiguration,
    field: 'email' | 'search',
    value: string,
  ): Promise<WooCustomerReference[]> {
    const url = integrationUrl(config.apiUrl, 'customers');
    url.searchParams.set(field, value);
    // El correo y el username son únicos a nivel de WordPress, no solo para el rol customer.
    url.searchParams.set('role', 'all');
    url.searchParams.set('per_page', '100');
    const response = await integrationGet(
      url,
      wooCommerceAuthorizationHeaders(config),
      config.label,
      { timeoutMs: 15_000, retryCount: 1 },
    );
    if (!Array.isArray(response)) throw invalidIntegrationResponse(config.label);
    const customers = response.map(normalizeCustomer);
    if (customers.some((customer) => customer === null)) {
      throw invalidIntegrationResponse(config.label);
    }
    return customers.filter((customer): customer is WooCustomerReference => customer !== null);
  }

  private confirmResponse(
    response: unknown,
    expected: WooCustomerPayload,
    label: string,
  ): WooCustomerReference {
    const customer = normalizeCustomer(response);
    if (
      !customer ||
      customer.email !== expected.email.toLowerCase() ||
      customer.username !== expected.username
    ) {
      throw invalidIntegrationResponse(label);
    }
    return customer;
  }

  private conflict(label: string): ConflictException {
    return new ConflictException({
      success: false,
      error: {
        code: 'EXTERNAL_CUSTOMER_CONFLICT',
        message: `El correo o documento ya pertenece a otro cliente en ${label}.`,
      },
    });
  }
}
