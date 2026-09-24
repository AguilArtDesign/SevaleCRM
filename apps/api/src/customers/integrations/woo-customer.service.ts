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
  wooCommerceCrmAuthorizationHeaders,
  wooCommerceCrmConfiguration,
  type WooCommerceConfiguration,
} from '../../integrations/woocommerce/woocommerce-configuration.js';
import { documentTypeFromWoo } from '../customer-document-type.mapping.js';
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

export type WooCustomerLookup =
  | { status: 'FOUND'; customer: WooCustomerReference }
  | { status: 'NOT_FOUND' }
  | { status: 'AMBIGUOUS'; candidates: number };

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

// Payload del endpoint propio /wp-json/sevale/v1/customer/crm/{identificación}.
// Se normaliza al mismo contrato que la REST API para que los consumidores no distingan el origen.
function crmCustomerReference(value: UnknownRecord): WooCustomerReference | null {
  const id = identifier(value.customer_id);
  const username = text(value.username);
  if (!id || !username) return null;
  const billing = isRecord(value.billing) ? value.billing : {};
  const metadata = Array.isArray(value.meta_data) ? value.meta_data : [];
  const meta_data: WooCustomerReference['meta_data'] = [];
  for (const entry of metadata) {
    if (!isRecord(entry)) continue;
    const key = text(entry.key);
    if (key !== 'billing_type_document' && key !== 'billing_identification') continue;
    meta_data.push({ id: null, key, value: text(entry.value) });
  }
  return {
    id,
    email: text(value.email).toLowerCase(),
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

// Contrato anterior: objeto plano con `found` en la raíz de la respuesta.
function normalizeCrmCustomer(value: unknown): WooCustomerReference | null {
  if (!isRecord(value) || value.found !== true) return null;
  return crmCustomerReference(value);
}

// Contrato nuevo: cada elemento de `customers[]` trae los datos del cliente y no `found`.
function normalizeCrmCustomerEntry(value: unknown): WooCustomerReference | null {
  return isRecord(value) ? crmCustomerReference(value) : null;
}

function declaredIdentification(customer: WooCustomerReference): string | null {
  return customer.meta_data.find((entry) => entry.key === 'billing_identification')?.value ?? null;
}

// La tienda devuelve la identificación tal como la guardó (con puntos, guiones o espacios), así que
// la verificación compara normalizado para no rechazar un acierto legítimo por formato.
function normalizedKey(value: string): string {
  return value
    .trim()
    .toLocaleUpperCase('es')
    .replace(/[^A-Z0-9]/gu, '');
}

// Salvaguarda: la respuesta debe declarar la misma identificación que se buscó; una distinta
// indica una respuesta inconsistente y no un acierto válido.
function requireDeclaredIdentification(
  customer: WooCustomerReference,
  documentNumber: string,
  label: string,
): WooCustomerReference {
  const declared = declaredIdentification(customer);
  if (declared && normalizedKey(declared) !== normalizedKey(documentNumber)) {
    throw invalidIntegrationResponse(label);
  }
  return customer;
}

// Tipo declarado por la tienda, traducido al código del CRM cuando es una etiqueta heredada.
function declaredDocumentType(customer: WooCustomerReference): string | null {
  const raw =
    customer.meta_data.find((entry) => entry.key === 'billing_type_document')?.value ?? null;
  if (!raw) return null;
  return documentTypeFromWoo(raw) ?? raw;
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

  /**
   * Busca el cliente en la tienda por la pareja (tipo, número), que es la identidad real del
   * cliente en el CRM y en Siigo. Acepta el contrato nuevo (`customers[]`) y el anterior (objeto
   * plano) para que el orden de despliegue entre el CRM y las tiendas no importe.
   */
  async findCustomerByDocument(
    store: Store,
    documentType: string,
    documentNumber: string,
  ): Promise<WooCustomerLookup> {
    const config = wooCommerceCrmConfiguration(store);
    const identification = documentNumber.trim();
    if (!identification) return { status: 'NOT_FOUND' };
    const url = integrationUrl(config.apiUrl, 'customer/crm');
    url.searchParams.set('billing_type_document', documentType.trim());
    url.searchParams.set('billing_identification', identification);
    const response = await integrationGet(
      url,
      wooCommerceCrmAuthorizationHeaders(config),
      config.label,
      { timeoutMs: 15_000, retryCount: 1 },
    );
    if (!isRecord(response)) throw invalidIntegrationResponse(config.label);
    if (response.found === false) return { status: 'NOT_FOUND' };
    const entries = Array.isArray(response.customers) ? response.customers : null;
    if (!entries) {
      const customer = normalizeCrmCustomer(response);
      if (!customer) throw invalidIntegrationResponse(config.label);
      return {
        status: 'FOUND',
        customer: requireDeclaredIdentification(customer, identification, config.label),
      };
    }
    const customers = entries.map((entry) => normalizeCrmCustomerEntry(entry));
    if (customers.some((customer) => customer === null)) {
      throw invalidIntegrationResponse(config.label);
    }
    const found = customers.filter(
      (customer): customer is WooCustomerReference => customer !== null,
    );
    if (found.length === 0) return { status: 'NOT_FOUND' };
    if (found.length > 1 || response.ambiguous === true) {
      const declared =
        typeof response.count === 'number' && Number.isSafeInteger(response.count)
          ? response.count
          : found.length;
      return { status: 'AMBIGUOUS', candidates: Math.max(found.length, declared) };
    }
    return {
      status: 'FOUND',
      customer: requireDeclaredIdentification(found[0]!, identification, config.label),
    };
  }

  async findCustomer(
    store: Store,
    customer: Pick<CustomerMappingSource, 'documentType' | 'documentNumber' | 'email'>,
  ): Promise<WooCustomerReference | null> {
    const config = wooCommerceConfiguration(store);
    const email = requireEmail(customer.email);
    // El correo es único en WordPress, así que se busca por ahí; el username no identifica al
    // cliente y por eso se confirma el documento declarado antes de aceptar la coincidencia.
    const matches = (await this.search(config, email)).filter((result) => result.email === email);
    if (matches.length === 0) return null;
    if (matches.length > 1) throw this.conflict(config.label);

    const match = matches[0]!;
    const declaredNumber = declaredIdentification(match);
    if (
      !declaredNumber ||
      normalizedKey(declaredNumber) !== normalizedKey(customer.documentNumber)
    ) {
      throw this.conflict(config.label);
    }
    const declaredType = declaredDocumentType(match);
    if (declaredType && normalizedKey(declaredType) !== normalizedKey(customer.documentType)) {
      throw this.conflict(config.label);
    }

    return match;
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
    return this.confirmResponse(response, body.email, config.label);
  }

  async updateCustomer(
    store: Store,
    externalId: string,
    customer: CustomerMappingSource,
  ): Promise<WooCustomerReference> {
    const config = wooCommerceConfiguration(store);
    const id = identifier(externalId.trim());
    if (!id) throw invalidIntegrationResponse(config.label);
    const body = this.mapper.mapForUpdate(customer);
    await this.ensureUpdateIdentityAvailable(config, id, body.email);
    const response = await integrationPut(
      integrationUrl(config.apiUrl, `customers/${id}`),
      wooCommerceAuthorizationHeaders(config),
      body,
      config.label,
      { timeoutMs: 20_000, retryCount: 1 },
    );
    const result = this.confirmResponse(response, body.email, config.label);
    if (result.id !== id) throw invalidIntegrationResponse(config.label);
    return result;
  }

  private async ensureUpdateIdentityAvailable(
    config: WooCommerceConfiguration,
    externalId: string,
    email: string,
  ): Promise<void> {
    const results = await this.search(config, email.toLowerCase());
    const belongsToAnotherCustomer = results.some((candidate) => candidate.id !== externalId);
    if (belongsToAnotherCustomer) throw this.conflict(config.label);
  }

  // El correo es único a nivel de WordPress, no solo para el rol customer: sirve para saber si el
  // cliente ya existe en la tienda sin usar el username como llave.
  private async search(
    config: WooCommerceConfiguration,
    email: string,
  ): Promise<WooCustomerReference[]> {
    const url = integrationUrl(config.apiUrl, 'customers');
    url.searchParams.set('email', email);
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
    expectedEmail: string,
    label: string,
  ): WooCustomerReference {
    const customer = normalizeCustomer(response);
    // El username no se compara: solo se define al crear y no identifica al cliente.
    if (!customer || customer.email !== expectedEmail.toLowerCase()) {
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
