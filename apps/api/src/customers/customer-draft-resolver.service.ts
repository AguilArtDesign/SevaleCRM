import { Injectable, Logger } from '@nestjs/common';
import type { CreateCustomerInput } from '@sevale/validation';
import {
  normalizeCustomerName,
  normalizeCustomerPhone,
  sanitizeCustomerEmail,
  sanitizePostalCode,
  sanitizeSiigoAddress,
} from './customer-data-sanitizer.js';
import { documentTypeFromWoo } from './customer-document-type.mapping.js';
import { CustomersRepository } from './customers.repository.js';
import {
  SiigoCustomerService,
  type SiigoCustomerLookup,
} from './integrations/siigo-customer.service.js';
import {
  WooCustomerService,
  type WooCustomerReference,
} from './integrations/woo-customer.service.js';

export type CustomerDraftSource = 'SIIGO' | 'SERATUS' | 'PALI';
export type CustomerSourceSummary = {
  provider: CustomerDraftSource;
  status: 'FOUND' | 'NOT_FOUND' | 'ERROR';
  externalId: string | null;
};
export type CustomerDraftAddress = Pick<
  CreateCustomerInput,
  'country' | 'region' | 'cityCode' | 'cityName' | 'postalCode' | 'addressLine1' | 'addressLine2'
>;
export type CustomerDraftName = Pick<CreateCustomerInput, 'firstName' | 'lastName' | 'displayName'>;
export type CustomerDraftConflictOption<T> = { value: T; sources: CustomerDraftSource[] };
export type CustomerDraftConflicts = {
  name?: { options: Array<CustomerDraftConflictOption<CustomerDraftName>> };
  email?: { options: Array<CustomerDraftConflictOption<string>> };
  phone?: { options: Array<CustomerDraftConflictOption<string>> };
  address?: { options: Array<CustomerDraftConflictOption<CustomerDraftAddress>> };
};
export type ResolvedCustomerDraft = Omit<CreateCustomerInput, 'documentType'> & {
  documentType: CreateCustomerInput['documentType'] | null;
  active: boolean;
};

type ExternalLookup = {
  provider: CustomerDraftSource;
  status: CustomerSourceSummary['status'];
  externalId: string | null;
  customer: WooCustomerReference | null;
};
type Candidate<T> = CustomerDraftConflictOption<T>;

function firstText(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const text = normalizeCustomerName(value);
    if (text) return text;
  }
  return null;
}

function mostCompleteText(...values: Array<string | null | undefined>): string | null {
  const candidates = values
    .map((value, index) => ({ value: normalizeCustomerName(value), index }))
    .filter((candidate): candidate is { value: string; index: number } => candidate.value !== null)
    .map((candidate) => ({
      ...candidate,
      words: candidate.value.split(/\s+/).length,
      length: candidate.value.replace(/\s/g, '').length,
    }));
  candidates.sort(
    (first, second) =>
      second.words - first.words || second.length - first.length || first.index - second.index,
  );
  return candidates[0]?.value ?? null;
}

function metadata(
  customer: WooCustomerReference,
  key: WooCustomerReference['meta_data'][number]['key'],
) {
  return customer.meta_data.find((entry) => entry.key === key)?.value ?? null;
}

function mergeScalarCandidates(candidates: Array<Candidate<string>>): Array<Candidate<string>> {
  const merged = new Map<string, Candidate<string>>();
  for (const candidate of candidates) {
    const key = candidate.value.toLocaleLowerCase('es');
    const current = merged.get(key);
    if (current) current.sources = [...new Set([...current.sources, ...candidate.sources])];
    else merged.set(key, { value: candidate.value, sources: [...candidate.sources] });
  }
  return [...merged.values()];
}

function comparableName(value: CustomerDraftName): string {
  return [value.firstName, value.lastName, value.displayName]
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es')
    .replace(/\s+/g, ' ')
    .trim();
}

function mergeNameCandidates(
  candidates: Array<Candidate<CustomerDraftName>>,
): Array<Candidate<CustomerDraftName>> {
  const merged = new Map<string, Candidate<CustomerDraftName>>();
  for (const candidate of candidates) {
    const key = comparableName(candidate.value);
    if (!key) continue;
    const current = merged.get(key);
    if (current) current.sources = [...new Set([...current.sources, ...candidate.sources])];
    else merged.set(key, { value: candidate.value, sources: [...candidate.sources] });
  }
  return [...merged.values()];
}

function comparableAddressText(address: CustomerDraftAddress): string {
  return [address.addressLine1, address.addressLine2]
    .filter(Boolean)
    .join(' ')
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es')
    .replace(/[.,;:]/g, ' ')
    .replace(/\s*([#-])\s*/g, '$1')
    .replace(/\s+/g, ' ')
    .trim();
}

function compatibleValue(first: string | null, second: string | null): boolean {
  return !first || !second || first.toLocaleLowerCase('es') === second.toLocaleLowerCase('es');
}

function equivalentAddress(first: CustomerDraftAddress, second: CustomerDraftAddress): boolean {
  return (
    comparableAddressText(first) === comparableAddressText(second) &&
    compatibleValue(first.country, second.country) &&
    compatibleValue(first.region, second.region) &&
    compatibleValue(first.cityCode, second.cityCode) &&
    compatibleValue(first.cityName, second.cityName) &&
    compatibleValue(first.postalCode, second.postalCode)
  );
}

function combineEquivalentAddress(
  current: Candidate<CustomerDraftAddress>,
  incoming: Candidate<CustomerDraftAddress>,
): Candidate<CustomerDraftAddress> {
  const currentIsWoo = current.sources.some((source) => source !== 'SIIGO');
  const incomingIsWoo = incoming.sources.some((source) => source !== 'SIIGO');
  const structured = incomingIsWoo && !currentIsWoo ? incoming.value : current.value;
  const fallback = structured === current.value ? incoming.value : current.value;
  return {
    value: {
      country: structured.country ?? fallback.country,
      region: structured.region ?? fallback.region,
      cityCode: structured.cityCode ?? fallback.cityCode,
      cityName: structured.cityName ?? fallback.cityName,
      postalCode: structured.postalCode ?? fallback.postalCode,
      addressLine1: structured.addressLine1 ?? fallback.addressLine1,
      addressLine2: structured.addressLine2 ?? fallback.addressLine2,
    },
    sources: [...new Set([...current.sources, ...incoming.sources])],
  };
}

function mergeAddressCandidates(
  candidates: Array<Candidate<CustomerDraftAddress>>,
): Array<Candidate<CustomerDraftAddress>> {
  const merged: Array<Candidate<CustomerDraftAddress>> = [];
  for (const candidate of candidates) {
    const index = merged.findIndex((current) => equivalentAddress(current.value, candidate.value));
    if (index < 0) merged.push(candidate);
    else merged[index] = combineEquivalentAddress(merged[index]!, candidate);
  }
  return merged;
}

function wooAddress(customer: WooCustomerReference): CustomerDraftAddress | null {
  const addressLine1 = sanitizeSiigoAddress(customer.billing.address_1);
  if (!addressLine1) return null;
  return {
    country: null,
    region: null,
    cityCode: null,
    cityName: null,
    postalCode: sanitizePostalCode(customer.billing.postcode),
    addressLine1,
    addressLine2: sanitizeSiigoAddress(customer.billing.address_2),
  };
}

function siigoAddress(customer: SiigoCustomerLookup): CustomerDraftAddress | null {
  if (!customer.prefill.addressLine1) return null;
  return {
    country: null,
    region: null,
    cityCode: null,
    cityName: null,
    postalCode: customer.prefill.postalCode,
    addressLine1: customer.prefill.addressLine1,
    addressLine2: null,
  };
}

@Injectable()
export class CustomerDraftResolverService {
  private readonly logger = new Logger(CustomerDraftResolverService.name);

  constructor(
    private readonly customers: CustomersRepository,
    private readonly siigoCustomers: SiigoCustomerService,
    private readonly wooCustomers: WooCustomerService,
  ) {}

  async resolve(identification: string) {
    const documentNumber = identification.trim();
    const local = await this.customers.findByDocumentNumber(documentNumber);
    if (local) {
      return { existsLocally: true as const, identification: documentNumber, customerId: local.id };
    }

    const [siigo, seratus, pali] = await Promise.all([
      this.lookupSiigo(documentNumber),
      this.lookupWoo('SERATUS', documentNumber),
      this.lookupWoo('PALI', documentNumber),
    ]);
    const woo = [seratus, pali];
    const integrations: CustomerSourceSummary[] = [
      {
        provider: 'SIIGO',
        status: siigo.status,
        externalId: siigo.customer?.reference.id ?? null,
      },
      ...woo.map(({ provider, status, externalId }) => ({ provider, status, externalId })),
    ];
    const profiles = woo.filter(
      (lookup): lookup is ExternalLookup & { customer: WooCustomerReference } =>
        lookup.customer !== null,
    );
    const found = Boolean(siigo.customer || profiles.length);
    if (!found) {
      return {
        existsLocally: false as const,
        found: false as const,
        identification: documentNumber,
        customer: null,
        integrations,
        conflicts: {} as CustomerDraftConflicts,
      };
    }

    const siigoPrefill = siigo.customer?.prefill;
    const firstName = mostCompleteText(
      siigoPrefill?.firstName,
      ...profiles.map(({ customer }) => customer.billing.first_name),
      ...profiles.map(({ customer }) => customer.first_name),
    );
    const lastName = mostCompleteText(
      siigoPrefill?.lastName,
      ...profiles.map(({ customer }) => customer.billing.last_name),
      ...profiles.map(({ customer }) => customer.last_name),
    );
    const documentTypes = [
      ...new Set(
        profiles
          .map(({ customer }) => documentTypeFromWoo(metadata(customer, 'billing_type_document')))
          .filter((type): type is NonNullable<typeof type> => type !== null),
      ),
    ];
    const nameOptions = mergeNameCandidates([
      ...(siigoPrefill?.firstName || siigoPrefill?.lastName
        ? [
            {
              value: {
                firstName: siigoPrefill.firstName,
                lastName: siigoPrefill.lastName,
                displayName: siigoPrefill.displayName,
              },
              sources: ['SIIGO'] as CustomerDraftSource[],
            },
          ]
        : []),
      ...profiles.flatMap(({ provider, customer }) => {
        const sourceFirstName = firstText(customer.billing.first_name, customer.first_name);
        const sourceLastName = firstText(customer.billing.last_name, customer.last_name);
        if (!sourceFirstName && !sourceLastName) return [];
        return [
          {
            value: {
              firstName: sourceFirstName,
              lastName: sourceLastName,
              displayName: [sourceFirstName, sourceLastName].filter(Boolean).join(' '),
            },
            sources: [provider],
          },
        ];
      }),
    ]);

    const emailOptions = mergeScalarCandidates([
      ...(siigoPrefill?.email
        ? [{ value: siigoPrefill.email, sources: ['SIIGO'] as CustomerDraftSource[] }]
        : []),
      ...profiles.flatMap(({ provider, customer }) => {
        const email =
          sanitizeCustomerEmail(customer.billing.email) ?? sanitizeCustomerEmail(customer.email);
        return email ? [{ value: email, sources: [provider] }] : [];
      }),
    ]);
    const phoneOptions = mergeScalarCandidates([
      ...(siigoPrefill?.phone
        ? [{ value: siigoPrefill.phone, sources: ['SIIGO'] as CustomerDraftSource[] }]
        : []),
      ...profiles.flatMap(({ provider, customer }) => {
        const phone = normalizeCustomerPhone(customer.billing.phone, customer.billing.country);
        return phone ? [{ value: phone, sources: [provider] }] : [];
      }),
    ]);
    const addressOptions = mergeAddressCandidates([
      ...(siigo.customer && siigoAddress(siigo.customer)
        ? [{ value: siigoAddress(siigo.customer)!, sources: ['SIIGO'] as CustomerDraftSource[] }]
        : []),
      ...profiles.flatMap(({ provider, customer }) => {
        const address = wooAddress(customer);
        return address ? [{ value: address, sources: [provider] }] : [];
      }),
    ]);

    const conflicts: CustomerDraftConflicts = {};
    if (nameOptions.length > 1) conflicts.name = { options: nameOptions };
    if (emailOptions.length > 1) conflicts.email = { options: emailOptions };
    if (phoneOptions.length > 1) conflicts.phone = { options: phoneOptions };
    if (addressOptions.length > 1) conflicts.address = { options: addressOptions };
    const resolvedAddress = addressOptions.length === 1 ? addressOptions[0]!.value : null;
    const hasNameConflict = nameOptions.length > 1;
    const draft: ResolvedCustomerDraft = {
      personType: siigoPrefill?.personType ?? 'PERSON',
      firstName: hasNameConflict ? null : firstName,
      lastName: hasNameConflict ? null : lastName,
      displayName: hasNameConflict
        ? ''
        : (siigoPrefill?.personType ?? 'PERSON') === 'PERSON'
          ? [firstName, lastName].filter(Boolean).join(' ')
          : (siigoPrefill?.displayName ??
            firstText(...profiles.map(({ customer }) => customer.billing.company)) ??
            [firstName, lastName].filter(Boolean).join(' ')),
      company:
        siigoPrefill?.company ??
        firstText(...profiles.map(({ customer }) => customer.billing.company)),
      documentType:
        siigoPrefill?.documentType ?? (documentTypes.length === 1 ? documentTypes[0]! : null),
      documentNumber,
      checkDigit: siigoPrefill?.checkDigit ?? null,
      email: emailOptions.length === 1 ? emailOptions[0]!.value : null,
      phone: phoneOptions.length === 1 ? phoneOptions[0]!.value : null,
      country: null,
      region: null,
      cityCode: null,
      cityName: null,
      postalCode: resolvedAddress?.postalCode ?? siigoPrefill?.postalCode ?? null,
      addressLine1: resolvedAddress?.addressLine1 ?? null,
      addressLine2: resolvedAddress?.addressLine2 ?? null,
      vatResponsible: siigoPrefill?.vatResponsible ?? false,
      fiscalResponsibilities: siigoPrefill?.fiscalResponsibilities.length
        ? siigoPrefill.fiscalResponsibilities
        : ['R-99-PN'],
      active: siigoPrefill?.active ?? true,
    };
    return {
      existsLocally: false as const,
      found: true as const,
      identification: documentNumber,
      customer: draft,
      integrations,
      conflicts,
    };
  }

  private async lookupSiigo(identification: string) {
    try {
      const customer = await this.siigoCustomers.lookupCustomer(identification);
      return { status: customer ? ('FOUND' as const) : ('NOT_FOUND' as const), customer };
    } catch {
      this.logger.warn(`No se pudo consultar el cliente ${identification} en SIIGO.`);
      return { status: 'ERROR' as const, customer: null };
    }
  }

  private async lookupWoo(
    provider: Extract<CustomerDraftSource, 'SERATUS' | 'PALI'>,
    identification: string,
  ): Promise<ExternalLookup> {
    try {
      const customer = await this.wooCustomers.findCustomerByDocument(provider, identification);
      return {
        provider,
        status: customer ? 'FOUND' : 'NOT_FOUND',
        externalId: customer?.id ?? null,
        customer,
      };
    } catch {
      this.logger.warn(`No se pudo consultar el cliente ${identification} en ${provider}.`);
      return { provider, status: 'ERROR', externalId: null, customer: null };
    }
  }
}
