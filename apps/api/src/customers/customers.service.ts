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
  createCustomerSchema,
  type CreateCustomerInput,
  type CustomerListQuery,
  type CustomerSyncInput,
  type UpdateCustomerInput,
} from '@sevale/validation';
import {
  findCustomerColombiaCitiesByName,
  getCustomerWooStates,
  resolveCustomerCityName,
  resolveCustomerColombiaCity,
  resolveCustomerColombiaState,
  resolveCustomerCountry,
  resolveCustomerCountryName,
  resolveCustomerRegionName,
  resolveCustomerWooState,
} from '@sevale/shared';
import {
  capitalizeCustomerName,
  normalizeCustomerName,
  normalizeCustomerPhone,
  sanitizeCustomerEmail,
  sanitizePostalCode,
  sanitizeSiigoAddress,
} from './customer-data-sanitizer.js';
import { CustomersRepository } from './customers.repository.js';
import { CustomerIntegrationService } from './customer-integration.service.js';
import { CustomerDraftResolverService } from './customer-draft-resolver.service.js';
import { documentTypeToWoo } from './customer-document-type.mapping.js';
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
  const documentTypeName = documentTypeToWoo(documentType);
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

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function isForeignKeyConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2003'
  );
}

function validateLocation(
  input: Pick<CreateCustomerInput, 'country' | 'region' | 'cityCode' | 'cityName'>,
) {
  if (!input.country) {
    if (input.region || input.cityCode || input.cityName) {
      throw new BadRequestException('Selecciona un país para guardar la ubicación.');
    }
    return;
  }
  if (!resolveCustomerCountry(input.country)) {
    throw new BadRequestException('El país no existe en el catálogo geográfico.');
  }
  if (input.country === 'CO') {
    if (input.region && !resolveCustomerColombiaState(input.region)) {
      throw new BadRequestException('El departamento no pertenece a Colombia.');
    }
    if (
      input.cityCode &&
      (!input.region || !resolveCustomerColombiaCity(input.region, input.cityCode))
    ) {
      throw new BadRequestException('La ciudad no pertenece al departamento seleccionado.');
    }
    return;
  }
  if (input.cityCode) {
    throw new BadRequestException('Las ciudades internacionales deben guardarse como texto libre.');
  }
  if (
    input.region &&
    getCustomerWooStates(input.country).length > 0 &&
    !resolveCustomerWooState(input.country, input.region)
  ) {
    throw new BadRequestException('La región no pertenece al país seleccionado.');
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
  const firstName =
    input.personType === 'PERSON'
      ? capitalizeCustomerName(input.firstName)
      : normalizeCustomerName(input.firstName);
  const lastName =
    input.personType === 'PERSON'
      ? capitalizeCustomerName(input.lastName)
      : normalizeCustomerName(input.lastName);
  const company = normalizeCustomerName(input.company);
  const canonicalDisplayName =
    input.personType === 'PERSON'
      ? [firstName, lastName].filter(Boolean).join(' ')
      : (company ?? '');
  const displayName =
    input.personType === 'PERSON'
      ? (capitalizeCustomerName(input.displayName) ?? canonicalDisplayName)
      : (normalizeCustomerName(input.displayName) ?? canonicalDisplayName);
  return {
    ...input,
    firstName,
    lastName,
    displayName,
    company,
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
    cityName: string | null;
    fiscalResponsibilities: unknown;
  },
>(customer: T) {
  return {
    ...customer,
    fiscalResponsibilities: Array.isArray(customer.fiscalResponsibilities)
      ? customer.fiscalResponsibilities
      : [],
    location: {
      countryName: resolveCustomerCountryName(customer.country),
      regionName: resolveCustomerRegionName(customer.country, customer.region),
      cityName: resolveCustomerCityName(
        customer.country,
        customer.region,
        customer.cityCode,
        customer.cityName,
      ),
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
    private readonly customerDraftResolver: CustomerDraftResolverService,
  ) {}

  async list(query: CustomerListQuery) {
    const [customers, total] = await this.customers.list(
      query,
      query.country && query.country !== 'CO' ? [] : findCustomerColombiaCitiesByName(query.search),
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

  resolve(identification: string) {
    return this.customerDraftResolver.resolve(identification);
  }

  async create(input: CreateCustomerInput) {
    const sanitized = sanitizeCustomerInput(input);
    validateLocation(sanitized);
    if (await this.customers.findByDocumentNumber(sanitized.documentNumber)) {
      throw new ConflictException('Ya existe un cliente con ese número de documento.');
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
    if (siigoMatch && siigoMatch.prefill.personType !== sanitized.personType) {
      throw new ConflictException('El documento existe en Siigo con un tipo de persona diferente.');
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
      await this.publishNotification(this.notifications.createCustomerLocal(customer), 'creación');
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

    if (input.documentNumber !== undefined && input.documentNumber !== current.documentNumber) {
      throw new BadRequestException(
        'El número de documento no puede cambiarse hasta habilitar la sincronización con las integraciones.',
      );
    }

    const documentType = input.documentType ?? current.documentType;
    const documentTypeChanged = documentType !== current.documentType;

    const merged = createCustomerSchema.safeParse({
      personType: input.personType ?? current.personType,
      firstName: input.firstName === undefined ? current.firstName : input.firstName,
      lastName: input.lastName === undefined ? current.lastName : input.lastName,
      displayName: input.displayName ?? current.displayName,
      company: input.company === undefined ? current.company : input.company,
      documentType,
      documentNumber: current.documentNumber,
      checkDigit: documentTypeChanged
        ? null
        : input.checkDigit === undefined
          ? current.checkDigit
          : input.checkDigit,
      email: input.email === undefined ? current.email : input.email,
      phone: input.phone === undefined ? current.phone : input.phone,
      country: input.country === undefined ? current.country : input.country,
      region: input.region === undefined ? current.region : input.region,
      cityCode: input.cityCode === undefined ? current.cityCode : input.cityCode,
      cityName: input.cityName === undefined ? current.cityName : input.cityName,
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
    const results = await this.integrations.synchronize(customer, providers, input.siigoLocation);
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
    try {
      const deleted = await this.customers.delete(id);
      this.realtime.emitCustomerDeleted(deleted);
      return serializeCustomer(deleted);
    } catch (error) {
      if (isForeignKeyConstraintError(error)) {
        throw new ConflictException({
          success: false,
          error: {
            code: 'CUSTOMER_HAS_ORDERS',
            message: 'El cliente no puede eliminarse porque tiene operaciones asociadas.',
          },
        });
      }
      throw error;
    }
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
