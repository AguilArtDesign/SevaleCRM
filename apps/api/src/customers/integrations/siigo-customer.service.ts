import { BadGatewayException, Injectable } from '@nestjs/common';
import { resolveLocationFromSiigo } from '@sevale/shared';
import { customerDocumentTypes, customerFiscalResponsibilities } from '@sevale/validation';
import {
  IntegrationAuthenticationException,
  integrationGet,
  integrationPost,
  integrationPut,
  integrationUrl,
  invalidIntegrationResponse,
  requireIntegrationValue,
} from '../../integrations/integration-http.js';
import { SiigoTokenService } from '../../integrations/siigo/siigo-token.service.js';
import type { CustomerMappingSource } from '../mapping/customer-mapping.types.js';
import {
  normalizeCustomerName,
  resolveSiigoPhone,
  sanitizeCustomerEmail,
  sanitizePostalCode,
  sanitizeSiigoAddress,
} from '../customer-data-sanitizer.js';
import {
  SiigoCustomerMapper,
  type SiigoCustomerPayload,
} from '../mapping/siigo-customer.mapper.js';

type UnknownRecord = Record<string, unknown>;

export type SiigoCustomerReference = {
  id: string;
  identification: string;
  personType: 'Person' | 'Company';
};

export type SiigoCustomerPrefill = {
  personType: 'PERSON' | 'COMPANY';
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  company: string | null;
  documentType: (typeof customerDocumentTypes)[number]['value'];
  documentNumber: string;
  checkDigit: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  region: string | null;
  cityCode: string | null;
  postalCode: string | null;
  addressLine1: string | null;
  addressLine2: null;
  vatResponsible: boolean;
  fiscalResponsibilities: Array<(typeof customerFiscalResponsibilities)[number]['value']>;
  active: boolean;
};

export type SiigoCustomerLookup = {
  reference: SiigoCustomerReference;
  prefill: SiigoCustomerPrefill;
};

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeCustomer(value: unknown): SiigoCustomerReference | null {
  if (!isRecord(value)) return null;
  const id = typeof value.id === 'string' ? value.id.trim() : '';
  const identification =
    typeof value.identification === 'string' ? value.identification.trim() : '';
  const personType = value.person_type;
  if (
    !UUID_PATTERN.test(id) ||
    !identification ||
    (personType !== 'Person' && personType !== 'Company')
  ) {
    return null;
  }
  return { id, identification, personType };
}

const documentTypes = new Set<string>(customerDocumentTypes.map(({ value }) => value));
const fiscalResponsibilities = new Set<string>(
  customerFiscalResponsibilities.map(({ value }) => value),
);

function optionalString(value: unknown): string | null {
  return normalizeCustomerName(value);
}

function branchOffice(value: unknown): number | null {
  if (typeof value === 'number' && Number.isInteger(value) && value >= 0) return value;
  if (typeof value === 'string' && /^\d+$/.test(value.trim())) return Number(value);
  return null;
}

function ambiguousCustomerResponse(): BadGatewayException {
  return new BadGatewayException({
    success: false,
    error: {
      code: 'INTEGRATION_AMBIGUOUS_RESPONSE',
      message: 'Siigo devolvió varios clientes y no fue posible identificar la sede principal.',
    },
  });
}

function selectCustomerReference(
  candidates: unknown[],
  identification: string,
): SiigoCustomerReference | null {
  const matches = candidates
    .map((candidate) => ({
      reference:
        !isRecord(candidate) || candidate.type === 'Customer' ? normalizeCustomer(candidate) : null,
      branchOffice: isRecord(candidate) ? branchOffice(candidate.branch_office) : null,
    }))
    .filter(
      (
        entry,
      ): entry is {
        reference: SiigoCustomerReference;
        branchOffice: number | null;
      } => entry.reference?.identification === identification,
    );
  if (candidates.length > 0 && matches.length === 0) throw invalidIntegrationResponse('Siigo');
  if (matches.length === 0) return null;
  if (matches.length !== new Set(matches.map(({ reference }) => reference.id)).size) {
    throw ambiguousCustomerResponse();
  }
  if (matches.length === 1) return matches[0]!.reference;
  const primary = matches.filter((entry) => entry.branchOffice === 0);
  if (primary.length === 1) return primary[0]!.reference;
  throw ambiguousCustomerResponse();
}

function selectLookupResult(
  candidates: unknown[],
  identification: string,
): SiigoCustomerLookup | null {
  const matches = candidates
    .map((candidate) => ({
      candidate,
      lookup: normalizeLookup(candidate),
      branchOffice: isRecord(candidate) ? branchOffice(candidate.branch_office) : null,
    }))
    .filter(
      (
        entry,
      ): entry is {
        candidate: unknown;
        lookup: SiigoCustomerLookup;
        branchOffice: number | null;
      } => entry.lookup?.reference.identification === identification,
    );
  if (candidates.length > 0 && matches.length === 0) throw invalidIntegrationResponse('Siigo');
  if (matches.length === 0) return null;
  if (matches.length !== new Set(matches.map(({ lookup }) => lookup.reference.id)).size) {
    throw ambiguousCustomerResponse();
  }
  if (matches.length === 1) return matches[0]!.lookup;
  const primary = matches.filter((entry) => entry.branchOffice === 0);
  if (primary.length === 1) return primary[0]!.lookup;
  throw ambiguousCustomerResponse();
}

function normalizeLookup(value: unknown): SiigoCustomerLookup | null {
  const reference = normalizeCustomer(value);
  if (!reference || !isRecord(value)) return null;
  const idType = isRecord(value.id_type) ? optionalString(value.id_type.code) : null;
  const names = Array.isArray(value.name)
    ? value.name.map(optionalString).filter((name): name is string => name !== null)
    : [];
  const address = isRecord(value.address) ? value.address : null;
  const city = address && isRecord(address.city) ? address.city : null;
  const location = city
    ? resolveLocationFromSiigo(
        optionalString(city.country_code) ?? '',
        optionalString(city.state_code) ?? '',
        optionalString(city.city_code) ?? '',
      )
    : null;
  if (!idType || !documentTypes.has(idType) || names.length === 0) {
    return null;
  }

  const contacts = Array.isArray(value.contacts) ? value.contacts.filter(isRecord) : [];
  const email =
    contacts.map((contact) => sanitizeCustomerEmail(contact.email)).find(Boolean) ?? null;
  const country = location?.country ?? null;
  const phone = resolveSiigoPhone(value, country ?? '');
  const personType = reference.personType === 'Person' ? 'PERSON' : 'COMPANY';
  const canonicalName = names.join(' ');
  const acceptedFiscalResponsibilities = Array.isArray(value.fiscal_responsibilities)
    ? value.fiscal_responsibilities
        .map((responsibility) =>
          isRecord(responsibility) ? optionalString(responsibility.code) : null,
        )
        .filter(
          (code): code is (typeof customerFiscalResponsibilities)[number]['value'] =>
            code !== null && fiscalResponsibilities.has(code),
        )
    : [];

  return {
    reference,
    prefill: {
      personType,
      firstName: personType === 'PERSON' ? names[0]! : null,
      lastName: personType === 'PERSON' ? names.slice(1).join(' ') || null : null,
      displayName: optionalString(value.commercial_name) ?? canonicalName,
      company: personType === 'COMPANY' ? canonicalName : null,
      documentType: idType as SiigoCustomerPrefill['documentType'],
      documentNumber: reference.identification,
      checkDigit: optionalString(value.check_digit),
      email,
      phone,
      country,
      region: location?.region ?? null,
      cityCode: location?.cityCode ?? null,
      postalCode: sanitizePostalCode(address?.postal_code),
      addressLine1: sanitizeSiigoAddress(address?.address),
      addressLine2: null,
      vatResponsible: value.vat_responsible === true,
      fiscalResponsibilities: [...new Set(acceptedFiscalResponsibilities)].slice(0, 1),
      active: typeof value.active === 'boolean' ? value.active : true,
    },
  };
}

@Injectable()
export class SiigoCustomerService {
  constructor(
    private readonly tokenService: SiigoTokenService,
    private readonly mapper: SiigoCustomerMapper,
  ) {}

  async findCustomer(identification: string): Promise<SiigoCustomerReference | null> {
    const normalizedIdentification = identification.trim();
    return this.withAuthenticationRetry((token) =>
      this.requestCustomerByIdentification(normalizedIdentification, token),
    );
  }

  async lookupCustomer(identification: string): Promise<SiigoCustomerLookup | null> {
    const normalizedIdentification = identification.trim();
    return this.withAuthenticationRetry((token) =>
      this.requestCustomerLookup(normalizedIdentification, token),
    );
  }

  async createCustomer(customer: CustomerMappingSource): Promise<SiigoCustomerReference> {
    const payload = this.mapper.map(customer);
    return this.withAuthenticationRetry((token) => this.requestCreate(payload, token));
  }

  async updateCustomer(
    externalId: string,
    customer: CustomerMappingSource,
  ): Promise<SiigoCustomerReference> {
    const normalizedExternalId = externalId.trim();
    if (!UUID_PATTERN.test(normalizedExternalId)) throw invalidIntegrationResponse('Siigo');
    const payload = this.mapper.map(customer);
    return this.withAuthenticationRetry((token) =>
      this.requestUpdate(normalizedExternalId, payload, token),
    );
  }

  private async requestCustomerByIdentification(
    identification: string,
    token: string,
  ): Promise<SiigoCustomerReference | null> {
    const url = integrationUrl(this.baseUrl(), 'customers');
    url.searchParams.set('identification', identification);
    url.searchParams.set('type', 'Customer');
    url.searchParams.set('page', '1');
    url.searchParams.set('page_size', '25');
    const response = await integrationGet(url, this.headers(token), 'Siigo', {
      timeoutMs: 15_000,
      retryCount: 1,
    });
    if (!isRecord(response) || !Array.isArray(response.results)) {
      throw invalidIntegrationResponse('Siigo');
    }
    return selectCustomerReference(response.results, identification);
  }

  private async requestCustomerLookup(
    identification: string,
    token: string,
  ): Promise<SiigoCustomerLookup | null> {
    const url = integrationUrl(this.baseUrl(), 'customers');
    url.searchParams.set('identification', identification);
    url.searchParams.set('page', '1');
    url.searchParams.set('page_size', '25');
    const response = await integrationGet(url, this.headers(token), 'Siigo', {
      timeoutMs: 15_000,
      retryCount: 1,
    });
    if (!isRecord(response) || !Array.isArray(response.results)) {
      throw invalidIntegrationResponse('Siigo');
    }
    return selectLookupResult(response.results, identification);
  }

  private async requestCreate(
    body: SiigoCustomerPayload,
    token: string,
  ): Promise<SiigoCustomerReference> {
    const response = await integrationPost(
      integrationUrl(this.baseUrl(), 'customers'),
      this.headers(token),
      body,
      'Siigo',
      { timeoutMs: 20_000 },
    );
    return this.confirmResponse(response, body.identification, body.person_type);
  }

  private async requestUpdate(
    externalId: string,
    body: SiigoCustomerPayload,
    token: string,
  ): Promise<SiigoCustomerReference> {
    const response = await integrationPut(
      integrationUrl(this.baseUrl(), `customers/${externalId}`),
      this.headers(token),
      body,
      'Siigo',
      { timeoutMs: 20_000, retryCount: 1 },
    );
    const customer = this.confirmResponse(response, body.identification, body.person_type);
    if (customer.id !== externalId) throw invalidIntegrationResponse('Siigo');
    return customer;
  }

  private confirmResponse(
    response: unknown,
    identification: string,
    personType: 'Person' | 'Company',
  ): SiigoCustomerReference {
    const customer = normalizeCustomer(response);
    if (
      !customer ||
      customer.identification !== identification ||
      customer.personType !== personType
    ) {
      throw invalidIntegrationResponse('Siigo');
    }
    return customer;
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

  private headers(token: string): HeadersInit {
    return { Authorization: `Bearer ${token}`, 'Partner-Id': this.partnerId() };
  }

  private baseUrl(): string {
    return requireIntegrationValue('SIIGO_API_URL', 'Siigo');
  }

  private partnerId(): string {
    return requireIntegrationValue('SIIGO_PARTNER_ID', 'Siigo');
  }
}
