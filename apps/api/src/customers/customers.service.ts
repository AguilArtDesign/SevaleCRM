import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import {
  customerDocumentTypes,
  createCustomerSchema,
  type CreateCustomerInput,
  type CustomerListQuery,
  type CustomerSyncInput,
  type UpdateCustomerInput,
} from '@sevale/validation';
import {
  findCitiesByName,
  getCities,
  resolveCity,
  resolveCountry,
  resolveState,
} from '@sevale/shared';
import {
  normalizeCustomerName,
  normalizeCustomerPhone,
  sanitizeCustomerEmail,
  sanitizePostalCode,
  sanitizeSiigoAddress,
} from './customer-data-sanitizer.js';
import { CustomersRepository } from './customers.repository.js';
import { CustomerIntegrationService } from './customer-integration.service.js';
import { SiigoCustomerService } from './integrations/siigo-customer.service.js';
import {
  WooCustomerService,
  type WooCustomerReference,
} from './integrations/woo-customer.service.js';

type WooLookupProvider = 'SERATUS' | 'PALI';
type WooCustomerData = Omit<WooCustomerReference, 'id'> & { id: number };
type CustomerSourceLookup = {
  provider: 'SIIGO' | WooLookupProvider;
  status: 'FOUND' | 'NOT_FOUND' | 'ERROR';
  externalId: string | null;
  externalData: WooCustomerData | null;
};

function firstText(...values: Array<string | null | undefined>): string | null {
  for (const value of values) {
    const normalized = value?.trim();
    if (normalized) return normalized;
  }
  return null;
}

function canonicalWooData(
  customer: WooCustomerReference | WooCustomerData | null,
  documentType: string | null,
  documentNumber: string,
): WooCustomerData | null {
  if (!customer) return null;
  const typeMetadata = customer.meta_data.find(({ key }) => key === 'billing_type_document');
  const identificationMetadata = customer.meta_data.find(
    ({ key }) => key === 'billing_identification',
  );
  const documentTypeName = customerDocumentTypes.find(({ value }) => value === documentType)?.label;
  return {
    ...customer,
    id: Number(customer.id),
    meta_data: [
      {
        id: typeMetadata?.id ?? null,
        key: 'billing_type_document',
        value: documentTypeName ?? typeMetadata?.value ?? '',
      },
      {
        id: identificationMetadata?.id ?? null,
        key: 'billing_identification',
        value: documentNumber,
      },
    ],
  };
}

function mergeWooFallbacks(
  siigo: NonNullable<Awaited<ReturnType<SiigoCustomerService['lookupCustomer']>>>['prefill'],
  sources: CustomerSourceLookup[],
) {
  const profiles = sources.flatMap(({ externalData }) => (externalData ? [externalData] : []));
  const billing = profiles.map((profile) => profile.billing);
  const countryCandidate = firstText(...billing.map(({ country }) => country));
  const country =
    siigo.country ??
    (countryCandidate && resolveCountry(countryCandidate) ? countryCandidate : null);
  const regionCandidate = firstText(
    ...billing
      .filter(({ country: sourceCountry }) => sourceCountry === country)
      .map(({ state }) => state),
  );
  const region =
    siigo.region ??
    (country && regionCandidate && resolveState(country, regionCandidate) ? regionCandidate : null);
  const cityName = firstText(
    ...billing
      .filter(({ country: sourceCountry, state }) => sourceCountry === country && state === region)
      .map(({ city }) => city),
  );
  const cityCode =
    siigo.cityCode ??
    (country && region && cityName
      ? (getCities(country, region).find(
          ({ name }) => name.localeCompare(cityName, 'es', { sensitivity: 'base' }) === 0,
        )?.code ?? null)
      : null);
  const email =
    siigo.email ??
    sanitizeCustomerEmail(
      firstText(
        ...billing.map(({ email: value }) => value),
        ...profiles.map(({ email: value }) => value),
      ),
    );
  const wooPhone = firstText(...billing.map(({ phone }) => phone));
  const siigoHasAddress = Boolean(siigo.addressLine1?.trim());
  return {
    ...siigo,
    firstName:
      siigo.firstName ??
      firstText(
        ...billing.map(({ first_name }) => first_name),
        ...profiles.map(({ first_name }) => first_name),
      ),
    lastName:
      siigo.lastName ??
      firstText(
        ...billing.map(({ last_name }) => last_name),
        ...profiles.map(({ last_name }) => last_name),
      ),
    company: siigo.company ?? firstText(...billing.map(({ company }) => company)),
    email,
    phone: siigo.phone ?? (wooPhone ? normalizeCustomerPhone(wooPhone, country ?? '') : null),
    country,
    region,
    cityCode,
    postalCode:
      siigo.postalCode ?? sanitizePostalCode(firstText(...billing.map(({ postcode }) => postcode))),
    addressLine1:
      siigo.addressLine1 ??
      sanitizeSiigoAddress(firstText(...billing.map(({ address_1 }) => address_1))),
    addressLine2:
      siigo.addressLine2 ??
      (siigoHasAddress ? null : firstText(...billing.map(({ address_2 }) => address_2))),
  };
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function validateLocation(input: Pick<CreateCustomerInput, 'country' | 'region' | 'cityCode'>) {
  if (input.country && !resolveCountry(input.country)) {
    throw new BadRequestException('El país no existe en el catálogo geográfico.');
  }
  if (input.region && (!input.country || !resolveState(input.country, input.region))) {
    throw new BadRequestException('La región no pertenece al país seleccionado.');
  }
  if (
    input.cityCode &&
    (!input.country || !input.region || !resolveCity(input.country, input.region, input.cityCode))
  ) {
    throw new BadRequestException('La ciudad no pertenece a la región seleccionada.');
  }
}

function normalizedPhone(
  phone: string | null | undefined,
  country: string | null | undefined,
): string | null {
  if (!phone) return null;
  const normalized = normalizeCustomerPhone(phone, country);
  if (!normalized) {
    throw new BadRequestException('El teléfono no es válido para el país seleccionado.');
  }
  return normalized;
}

function sanitizeCustomerInput(input: CreateCustomerInput): CreateCustomerInput {
  const email = input.email ? sanitizeCustomerEmail(input.email) : null;
  if (input.email && !email) {
    throw new BadRequestException(
      'Ingresa un correo válido del cliente que no pertenezca a un dominio interno.',
    );
  }
  const addressLine1 = sanitizeSiigoAddress(input.addressLine1);
  const canonicalDisplayName =
    input.personType === 'PERSON'
      ? [input.firstName, input.lastName].filter(Boolean).join(' ')
      : (input.company ?? '');
  return {
    ...input,
    firstName: normalizeCustomerName(input.firstName),
    lastName: normalizeCustomerName(input.lastName),
    displayName: normalizeCustomerName(input.displayName) ?? canonicalDisplayName,
    company: normalizeCustomerName(input.company),
    email,
    phone: normalizedPhone(input.phone, input.country),
    postalCode: sanitizePostalCode(input.postalCode),
    addressLine1,
    addressLine2: normalizeCustomerName(input.addressLine2),
  };
}

function serializeCustomer<
  T extends {
    country: string | null;
    region: string | null;
    cityCode: string | null;
    fiscalResponsibilities: unknown;
  },
>(customer: T) {
  const country = customer.country ? resolveCountry(customer.country) : null;
  const state =
    customer.country && customer.region ? resolveState(customer.country, customer.region) : null;
  const city =
    customer.country && customer.region && customer.cityCode
      ? resolveCity(customer.country, customer.region, customer.cityCode)
      : null;
  return {
    ...customer,
    fiscalResponsibilities: Array.isArray(customer.fiscalResponsibilities)
      ? customer.fiscalResponsibilities
      : [],
    location: {
      countryName: country?.name ?? customer.country ?? null,
      regionName: state?.name ?? customer.region ?? null,
      cityName: city ?? customer.cityCode ?? null,
    },
  };
}

@Injectable()
export class CustomersService {
  private readonly logger = new Logger(CustomersService.name);

  constructor(
    private readonly customers: CustomersRepository,
    private readonly integrations: CustomerIntegrationService,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly siigoCustomers: SiigoCustomerService,
    private readonly wooCustomers: WooCustomerService,
  ) {}

  async list(query: CustomerListQuery) {
    const [customers, total] = await this.customers.list(
      query,
      findCitiesByName(query.search, query.country),
    );
    return {
      data: customers.map(serializeCustomer),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async detail(id: number) {
    const customer = await this.customers.findById(id);
    if (!customer) throw new NotFoundException('El cliente no existe.');
    return serializeCustomer(customer);
  }

  async lookupSiigo(identification: string) {
    const [match, seratus, pali] = await Promise.all([
      this.siigoCustomers.lookupCustomer(identification),
      this.lookupWooCustomer('SERATUS', identification),
      this.lookupWooCustomer('PALI', identification),
    ]);
    const integrations: CustomerSourceLookup[] = [
      {
        provider: 'SIIGO',
        status: match ? 'FOUND' : 'NOT_FOUND',
        externalId: match?.reference.id ?? null,
        externalData: null,
      },
      {
        ...seratus,
        externalData: canonicalWooData(
          seratus.externalData,
          match?.prefill.documentType ?? null,
          identification,
        ),
      },
      {
        ...pali,
        externalData: canonicalWooData(
          pali.externalData,
          match?.prefill.documentType ?? null,
          identification,
        ),
      },
    ];
    if (!match) return { exists: false as const, identification, integrations };
    return {
      exists: true as const,
      identification,
      customer: mergeWooFallbacks(match.prefill, integrations),
      integrations,
    };
  }

  async create(input: CreateCustomerInput) {
    const sanitized = sanitizeCustomerInput(input);
    validateLocation(sanitized);
    if (await this.customers.findByDocument(sanitized.documentType, sanitized.documentNumber)) {
      throw new ConflictException('Ya existe un cliente con ese tipo y número de documento.');
    }
    const [siigoMatch, seratusLookup, paliLookup] = await Promise.all([
      this.siigoCustomers.lookupCustomer(sanitized.documentNumber),
      this.lookupWooCustomer('SERATUS', sanitized.documentNumber),
      this.lookupWooCustomer('PALI', sanitized.documentNumber),
    ]);
    const seratusData = canonicalWooData(
      seratusLookup.externalData,
      sanitized.documentType,
      sanitized.documentNumber,
    );
    const paliData = canonicalWooData(
      paliLookup.externalData,
      sanitized.documentType,
      sanitized.documentNumber,
    );
    if (
      siigoMatch &&
      (siigoMatch.prefill.documentType !== sanitized.documentType ||
        siigoMatch.prefill.personType !== sanitized.personType)
    ) {
      throw new ConflictException(
        'El documento existe en Siigo con un tipo de documento o persona diferente.',
      );
    }
    try {
      const customer = await this.customers.create({
        ...sanitized,
        active: siigoMatch?.prefill.active ?? true,
        fiscalResponsibilities: sanitized.fiscalResponsibilities,
        integrations: {
          create: [
            { provider: 'SIIGO', externalId: siigoMatch?.reference.id ?? null },
            {
              provider: 'SERATUS',
              externalId: seratusLookup.externalId,
              ...(seratusData ? { externalData: seratusData } : {}),
            },
            {
              provider: 'PALI',
              externalId: paliLookup.externalId,
              ...(paliData ? { externalData: paliData } : {}),
            },
          ],
        },
      });
      this.realtime.emitCustomerCreated(customer);
      for (const integration of customer.integrations) {
        this.realtime.emitCustomerIntegrationUpdated(customer, integration);
      }
      await this.publishNotification(
        this.notifications.createCustomerLocal(customer, Boolean(siigoMatch)),
        'creación',
      );
      return serializeCustomer(customer);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('Ya existe un cliente con ese tipo y número de documento.');
      }
      throw error;
    }
  }

  async update(id: number, input: UpdateCustomerInput) {
    const current = await this.customers.findById(id);
    if (!current) throw new NotFoundException('El cliente no existe.');

    if (
      (input.documentType !== undefined && input.documentType !== current.documentType) ||
      (input.documentNumber !== undefined && input.documentNumber !== current.documentNumber)
    ) {
      throw new BadRequestException(
        'El documento no puede cambiarse hasta habilitar la sincronización con las integraciones.',
      );
    }

    const merged = createCustomerSchema.safeParse({
      personType: input.personType ?? current.personType,
      firstName: input.firstName === undefined ? current.firstName : input.firstName,
      lastName: input.lastName === undefined ? current.lastName : input.lastName,
      displayName: input.displayName ?? current.displayName,
      company: input.company === undefined ? current.company : input.company,
      documentType: current.documentType,
      documentNumber: current.documentNumber,
      checkDigit: input.checkDigit === undefined ? current.checkDigit : input.checkDigit,
      email: input.email === undefined ? current.email : input.email,
      phone: input.phone === undefined ? current.phone : input.phone,
      country: input.country === undefined ? current.country : input.country,
      region: input.region === undefined ? current.region : input.region,
      cityCode: input.cityCode === undefined ? current.cityCode : input.cityCode,
      postalCode: input.postalCode === undefined ? current.postalCode : input.postalCode,
      addressLine1: input.addressLine1 === undefined ? current.addressLine1 : input.addressLine1,
      addressLine2: input.addressLine2 === undefined ? current.addressLine2 : input.addressLine2,
      vatResponsible: input.vatResponsible ?? current.vatResponsible,
      fiscalResponsibilities:
        input.fiscalResponsibilities ?? (current.fiscalResponsibilities as string[]),
    });
    if (!merged.success) {
      throw new BadRequestException(merged.error.issues[0]?.message || 'Los datos no son válidos.');
    }
    const sanitized = sanitizeCustomerInput(merged.data);
    validateLocation(sanitized);

    const data: Prisma.CustomerUpdateInput = {
      ...sanitized,
      fiscalResponsibilities: sanitized.fiscalResponsibilities,
    };
    try {
      const customer = await this.customers.update(id, data);
      this.realtime.emitCustomerUpdated(customer);
      for (const integration of customer.integrations) {
        this.realtime.emitCustomerIntegrationUpdated(customer, integration);
      }
      await this.publishNotification(
        this.notifications.createCustomerUpdatedLocal(customer),
        'actualización',
      );
      return serializeCustomer(customer);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('Ya existe un cliente con ese tipo y número de documento.');
      }
      throw error;
    }
  }

  async sync(id: number, input: CustomerSyncInput) {
    const customer = await this.customers.findById(id);
    if (!customer) throw new NotFoundException('El cliente no existe.');
    const providers = input.provider
      ? [input.provider]
      : customer.integrations
          .filter((integration) => integration.status !== 'SYNCED')
          .map((integration) => integration.provider);
    if (providers.length === 0) return serializeCustomer(customer);
    const results = await this.integrations.synchronize(customer, providers);
    const synchronized = await this.customers.findById(customer.id);
    if (!synchronized) throw new NotFoundException('El cliente no existe.');
    for (const result of results) {
      this.realtime.emitCustomerIntegrationUpdated(synchronized, result);
    }
    await this.publishNotification(
      this.notifications.createCustomerRetrySummary(synchronized, results),
      'reintento',
    );
    return serializeCustomer(synchronized);
  }

  async remove(id: number) {
    const customer = await this.customers.findById(id);
    if (!customer) throw new NotFoundException('El cliente no existe.');
    const deleted = await this.customers.delete(id);
    this.realtime.emitCustomerDeleted(deleted);
    return serializeCustomer(deleted);
  }

  private async publishNotification(operation: Promise<unknown>, context: string) {
    try {
      await operation;
    } catch {
      this.logger.warn(`No se pudo registrar la notificación de ${context} del cliente.`);
    }
  }

  private async lookupWooCustomer(
    provider: WooLookupProvider,
    identification: string,
  ): Promise<CustomerSourceLookup> {
    try {
      const customer = await this.wooCustomers.findCustomerByDocument(provider, identification);
      return {
        provider,
        status: customer ? 'FOUND' : 'NOT_FOUND',
        externalId: customer?.id ?? null,
        externalData: customer ? canonicalWooData(customer, null, identification) : null,
      };
    } catch {
      this.logger.warn(`No se pudo consultar el cliente ${identification} en ${provider}.`);
      return { provider, status: 'ERROR', externalId: null, externalData: null };
    }
  }
}
