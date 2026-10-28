import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import {
  createCustomerSchema,
  type CreateCustomerInput,
  type CustomerActivityQuery,
  type CustomerListQuery,
  type CustomerSyncInput,
  type N8nCustomerLookupInput,
  type N8nCustomerUpsertInput,
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
import { createCustomersWorkbook } from './customer-export.js';
import { CustomerIntegrationService } from './customer-integration.service.js';
import { CustomerEventsService } from './customer-events.service.js';
import { CustomerDraftResolverService } from './customer-draft-resolver.service.js';
import { documentTypeToWoo } from './customer-document-type.mapping.js';
import { integrationErrorCode } from '../integrations/integration-http.js';
import { SiigoCustomerService } from './integrations/siigo-customer.service.js';
import {
  WooCustomerService,
  type WooCustomerReference,
} from './integrations/woo-customer.service.js';
import type { CustomerWithIntegrations } from './customers.repository.js';
type WooLookupProvider = 'SERATUS' | 'PALI';
type WooCustomerData = Omit<WooCustomerReference, 'id'> & { id: number };
type CustomerSourceLookup = {
  provider: 'SIIGO' | WooLookupProvider;
  status: 'FOUND' | 'NOT_FOUND' | 'AMBIGUOUS' | 'ERROR';
  externalId: string | null;
  externalData: WooCustomerData | null;
  // Cuántos clientes coincidieron: 1 al encontrar y N cuando la tienda tiene duplicados.
  candidates: number;
};

function customerBadRequest(code: string, message: string): BadRequestException {
  return new BadRequestException({ success: false, error: { code, message } });
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

/** El cliente tiene pedidos: no se borra, ni aquí ni en las tiendas. */
function customerHasOrders() {
  return new ConflictException({
    success: false,
    error: {
      code: 'CUSTOMER_HAS_ORDERS',
      message: 'El cliente no puede eliminarse porque tiene operaciones asociadas.',
    },
  });
}

function validateLocation(
  input: Pick<CreateCustomerInput, 'country' | 'region' | 'cityCode' | 'cityName'>,
) {
  if (!input.country) {
    if (input.region || input.cityCode || input.cityName) {
      throw customerBadRequest(
        'CUSTOMER_COUNTRY_REQUIRED',
        'Selecciona un país para guardar la ubicación.',
      );
    }
    return;
  }
  if (!resolveCustomerCountry(input.country)) {
    throw customerBadRequest(
      'CUSTOMER_COUNTRY_INVALID',
      'El país no existe en el catálogo geográfico.',
    );
  }
  if (input.country === 'CO') {
    if (input.region && !resolveCustomerColombiaState(input.region)) {
      throw customerBadRequest(
        'CUSTOMER_REGION_INVALID',
        'El departamento no pertenece a Colombia.',
      );
    }
    if (
      input.cityCode &&
      (!input.region || !resolveCustomerColombiaCity(input.region, input.cityCode))
    ) {
      throw customerBadRequest(
        'CUSTOMER_CITY_INVALID',
        'La ciudad no pertenece al departamento seleccionado.',
      );
    }
    return;
  }
  if (input.cityCode) {
    throw customerBadRequest(
      'CUSTOMER_CITY_INVALID',
      'Las ciudades internacionales deben guardarse como texto libre.',
    );
  }
  if (
    input.region &&
    getCustomerWooStates(input.country).length > 0 &&
    !resolveCustomerWooState(input.country, input.region)
  ) {
    throw customerBadRequest(
      'CUSTOMER_REGION_INVALID',
      'La región no pertenece al país seleccionado.',
    );
  }
}

function normalizedPhone(
  phone: string | null | undefined,
  country: string | null | undefined,
): string | null {
  if (!phone) return null;
  const normalized = normalizeCustomerPhone(phone, country);
  if (!normalized) {
    throw customerBadRequest(
      'CUSTOMER_PHONE_INVALID',
      'El teléfono no es válido para el país seleccionado.',
    );
  }
  return normalized;
}

function sanitizeCustomerInput(input: CreateCustomerInput): CreateCustomerInput {
  const email = input.email ? sanitizeCustomerEmail(input.email) : null;
  if (input.email && !email) {
    throw customerBadRequest(
      'CUSTOMER_EMAIL_INVALID',
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
    integrations: Array<{
      lastErrorCode: string | null;
      lastErrorMessage: string | null;
    }>;
  },
>(customer: T, includeIntegrationErrors = false) {
  return {
    ...customer,
    integrations: customer.integrations.map((integration) =>
      includeIntegrationErrors
        ? integration
        : { ...integration, lastErrorCode: null, lastErrorMessage: null },
    ),
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
    private readonly realtime: RealtimeGateway,
    private readonly siigoCustomers: SiigoCustomerService,
    private readonly wooCustomers: WooCustomerService,
    private readonly customerDraftResolver: CustomerDraftResolverService,
    private readonly events: CustomerEventsService,
  ) {}

  async list(query: CustomerListQuery, includeIntegrationErrors = false) {
    const [customers, total] = await this.customers.list(
      query,
      query.country && query.country !== 'CO' ? [] : findCustomerColombiaCitiesByName(query.search),
    );
    return {
      data: customers.map((customer) => serializeCustomer(customer, includeIntegrationErrors)),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async detail(id: number, includeIntegrationErrors = false) {
    const customer = await this.customers.findById(id);
    if (!customer) throw new NotFoundException('El cliente no existe.');
    return serializeCustomer(customer, includeIntegrationErrors);
  }

  /**
   * Traza de la ficha. Se comprueba primero el cliente para no devolver una lista vacía cuando el
   * identificador no existe: "sin actividad" y "no existe" no significan lo mismo para quien audita.
   */
  async activity(id: number, query: CustomerActivityQuery) {
    const customer = await this.customers.findById(id);
    if (!customer) throw new NotFoundException('El cliente no existe.');
    return this.events.list(id, query);
  }

  /** Exporta los clientes seleccionados a un `.xlsx` legible, con nombres en vez de códigos. */
  async export(ids: number[]) {
    const customers = await this.customers.findByIds(ids);
    if (customers.length !== ids.length) {
      throw new NotFoundException({
        success: false,
        error: {
          code: 'CUSTOMERS_NOT_FOUND',
          message: 'Uno o más clientes seleccionados ya no existen.',
        },
      });
    }
    const buffer = createCustomersWorkbook(customers);
    const date = new Date().toISOString().slice(0, 10);
    return { buffer, filename: `clientes-seleccionados-${date}.xlsx` };
  }

  resolve(identification: string, documentType: CreateCustomerInput['documentType']) {
    return this.customerDraftResolver.resolve(identification, documentType);
  }

  async create(
    input: CreateCustomerInput,
    userId: string | null,
    includeIntegrationErrors = false,
  ) {
    const sanitized = sanitizeCustomerInput(input);
    validateLocation(sanitized);
    await this.validateAgreement(sanitized.agreementId);
    if (await this.customers.findByDocumentNumber(sanitized.documentNumber)) {
      throw new ConflictException('Ya existe un cliente con ese número de documento.');
    }
    const [siigoMatch, seratusLookup, paliLookup] = await Promise.all([
      this.siigoCustomers.lookupCustomer(sanitized.documentNumber),
      this.lookupWooCustomer('SERATUS', sanitized.documentType, sanitized.documentNumber),
      this.lookupWooCustomer('PALI', sanitized.documentType, sanitized.documentNumber),
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
        // Queda en la ficha y en la traza: es el dato que responde "quién lo dio de alta".
        createdByUserId: userId,
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
      await this.events.recordCreated(customer, userId);
      return serializeCustomer(customer, includeIntegrationErrors);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('Ya existe un cliente con ese tipo y número de documento.');
      }
      throw error;
    }
  }

  async update(
    id: number,
    input: UpdateCustomerInput,
    userId: string,
    includeIntegrationErrors = false,
  ) {
    const current = await this.customers.findById(id);
    if (!current) throw new NotFoundException('El cliente no existe.');

    if (input.documentNumber !== undefined && input.documentNumber !== current.documentNumber) {
      throw customerBadRequest(
        'CUSTOMER_DOCUMENT_IMMUTABLE',
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
      agreementId: input.agreementId === undefined ? current.agreementId : input.agreementId,
      vatResponsible: input.vatResponsible ?? current.vatResponsible,
      fiscalResponsibilities:
        input.fiscalResponsibilities ?? (current.fiscalResponsibilities as string[]),
    });
    if (!merged.success) {
      throw customerBadRequest(
        'CUSTOMER_VALIDATION_ERROR',
        merged.error.issues[0]?.message || 'Los datos no son válidos.',
      );
    }
    const sanitized = sanitizeCustomerInput(merged.data);
    validateLocation(sanitized);
    await this.validateAgreement(sanitized.agreementId);

    const data: Prisma.CustomerUncheckedUpdateInput = {
      ...sanitized,
      fiscalResponsibilities: sanitized.fiscalResponsibilities,
    };
    try {
      const customer = await this.customers.update(id, data);
      this.realtime.emitCustomerUpdated(customer);
      for (const integration of customer.integrations) {
        this.realtime.emitCustomerIntegrationUpdated(customer, integration);
      }
      await this.events.recordUpdated(current, customer, userId);
      return serializeCustomer(customer, includeIntegrationErrors);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException('Ya existe un cliente con ese tipo y número de documento.');
      }
      throw error;
    }
  }

  async sync(
    id: number,
    input: CustomerSyncInput,
    userId: string | null,
    includeIntegrationErrors = false,
  ) {
    const customer = await this.customers.findById(id);
    if (!customer) throw new NotFoundException('El cliente no existe.');
    const providers = input.provider
      ? [input.provider]
      : customer.integrations
          .filter((integration) => integration.status !== 'SYNCED')
          .map((integration) => integration.provider);
    if (providers.length === 0) return serializeCustomer(customer, includeIntegrationErrors);
    // El vendedor de Siigo sale de quien sincroniza, no de la ficha: así la tienda sabe a quién
    // asociar el cliente aunque después lo edite otro comercial.
    const sellerId = userId ? await this.customers.siigoSellerId(userId) : null;
    const results = await this.integrations.synchronize(customer, providers, {
      siigoLocation: input.siigoLocation,
      sellerId,
    });
    const siigoResult = results.find(
      (result) => result.provider === 'SIIGO' && result.status === 'SYNCED',
    );
    if (customer.personType === 'COMPANY' && siigoResult?.checkDigit) {
      await this.customers.updateCheckDigit(customer.id, siigoResult.checkDigit);
    }
    const synchronized = await this.customers.findById(customer.id);
    if (!synchronized) throw new NotFoundException('El cliente no existe.');
    for (const result of results) {
      this.realtime.emitCustomerIntegrationUpdated(synchronized, result);
    }
    await this.events.recordSynced(synchronized, results, userId);
    return serializeCustomer(synchronized, includeIntegrationErrors);
  }

  async remove(id: number, userId: string | null, includeIntegrationErrors = false) {
    const customer = await this.customers.findById(id);
    if (!customer) throw new NotFoundException('El cliente no existe.');
    // El bloqueo por pedidos se comprueba antes de tocar las tiendas: si el borrado local va a
    // rechazarse, no puede haberse borrado ya al cliente en remoto.
    if ((await this.customers.blockingOperations(id)) > 0) throw customerHasOrders();
    await this.removeFromStores(customer);
    try {
      const deleted = await this.customers.delete(id);
      if (!deleted) throw customerHasOrders();
      this.realtime.emitCustomerDeleted(deleted);
      await this.events.recordDeleted(customer, userId);
      return serializeCustomer(deleted, includeIntegrationErrors);
    } catch (error) {
      if (isForeignKeyConstraintError(error)) throw customerHasOrders();
      throw error;
    }
  }

  /**
   * Borra al cliente en Pali y Seratus, en las tiendas donde tenga vínculo. Las tiendas sin
   * `externalId` o sin configurar se omiten porque no hay nada que borrar allá.
   *
   * Se aborta al primer fallo real en lugar de continuar: el cliente ya no existiría en el CRM pero
   * seguiría vivo en la otra tienda, y ese huérfano no lo ve nadie. Al abortar, la tienda que falló
   * queda nombrada en el error y el cliente se conserva entero en el CRM.
   */
  private async removeFromStores(customer: CustomerWithIntegrations) {
    const stores: Array<{ provider: 'SERATUS' | 'PALI'; label: string }> = [
      { provider: 'SERATUS', label: 'Seratus' },
      { provider: 'PALI', label: 'Pali' },
    ];
    for (const { provider, label } of stores) {
      const integration = customer.integrations.find((item) => item.provider === provider);
      if (!integration?.externalId) continue;
      try {
        await this.wooCustomers.deleteCustomer(provider, integration.externalId);
      } catch (error) {
        // Una integración ausente en este entorno no es un fallo del borrado: no hay tienda a la
        // que pedirle nada.
        if (integrationErrorCode(error) === 'INTEGRATION_NOT_CONFIGURED') {
          this.logger.warn(`El borrado en ${label} se omite: la integración no está configurada.`);
          continue;
        }
        throw new BadGatewayException({
          success: false,
          error: {
            code: 'CUSTOMER_REMOTE_DELETE_FAILED',
            message: `No pudimos eliminar el cliente en ${label}. El cliente se conserva en el CRM.`,
          },
        });
      }
    }
  }

  /** Consulta para n8n: responde si el cliente existe y devuelve sus vínculos por tienda. */
  async lookupForIntegration(input: N8nCustomerLookupInput) {
    const match = await this.customers.findByDocumentNumber(input.documentNumber);
    const customer = match ? await this.customers.findById(match.id) : null;
    if (!customer) return { success: true, found: false, customer: null };
    return { success: true, found: true, customer: serializeCustomer(customer, true) };
  }

  /**
   * Alta o vinculación de un cliente desde n8n. Si el documento ya existe no se sobrescriben sus datos:
   * solo se vinculan los identificadores de cada tienda (las demás quedan pendientes de sincronizar).
   */
  async upsertForIntegration(input: N8nCustomerUpsertInput) {
    const { integrations, ...customerInput } = input;
    const match = await this.customers.findByDocumentNumber(input.documentNumber);
    const existing = match ? await this.customers.findById(match.id) : null;
    const created = existing ? null : await this.createForIntegration(customerInput);
    const customerId = existing?.id ?? created?.id;
    if (!customerId) throw new ConflictException('No pudimos registrar el cliente.');

    for (const { provider, externalId } of integrations) {
      const owner = await this.customers.findIntegrationOwner(provider, externalId);
      if (owner && owner.customerId !== customerId) {
        throw new ConflictException({
          success: false,
          error: {
            code: 'CUSTOMER_INTEGRATION_LINK_CONFLICT',
            message: `El identificador ${externalId} de ${provider} ya está vinculado con otro cliente.`,
          },
        });
      }
    }

    const linked =
      integrations.length > 0
        ? await this.customers.linkIntegrations(customerId, integrations)
        : await this.customers.findById(customerId);
    if (!linked) throw new ConflictException('No pudimos registrar el cliente.');
    // Sin usuario: el alta la hizo una integración, y la traza lo dice así en vez de inventar autor.
    if (created) await this.events.recordCreated(created, null);
    return { success: true, created: !existing, customer: serializeCustomer(linked, true) };
  }

  /**
   * Alta local del cliente para la integración: se sanea igual que en el panel, pero **sin** consultar
   * Siigo ni las tiendas, y con las tres integraciones pendientes de sincronizar.
   */
  private createForIntegration(input: CreateCustomerInput) {
    const sanitized = sanitizeCustomerInput(input);
    return this.customers.create({
      ...sanitized,
      active: true,
      fiscalResponsibilities: sanitized.fiscalResponsibilities,
      integrations: {
        create: [
          { provider: 'SIIGO', externalId: null },
          { provider: 'SERATUS', externalId: null },
          { provider: 'PALI', externalId: null },
        ],
      },
    });
  }

  /** El convenio se elige en el formulario, así que un id inexistente se rechaza antes de guardar. */
  private async validateAgreement(agreementId: number | null | undefined) {
    if (!agreementId) return;
    if (!(await this.customers.agreementExists(agreementId))) {
      throw customerBadRequest(
        'CUSTOMER_AGREEMENT_NOT_FOUND',
        'El convenio seleccionado no existe.',
      );
    }
  }

  /** Hereda el convenio al vincular un prospecto con un cliente existente. */
  async linkAgreement(customerId: number, agreementId: number) {
    await this.validateAgreement(agreementId);
    await this.customers.setAgreement(customerId, agreementId);
  }

  private async lookupWooCustomer(
    provider: WooLookupProvider,
    documentType: string,
    identification: string,
  ): Promise<CustomerSourceLookup> {
    try {
      const result = await this.wooCustomers.findCustomerByDocument(
        provider,
        documentType,
        identification,
      );
      if (result.status === 'FOUND') {
        return {
          provider,
          status: 'FOUND',
          externalId: result.customer.id,
          externalData: canonicalWooData(result.customer, null, identification),
          candidates: 1,
        };
      }
      return {
        provider,
        status: result.status,
        externalId: null,
        externalData: null,
        candidates: result.status === 'AMBIGUOUS' ? result.candidates : 0,
      };
    } catch (error) {
      this.logger.warn(
        `No se pudo consultar el cliente ${identification} en ${provider}: ${integrationErrorCode(error) ?? 'sin código'}.`,
      );
      return { provider, status: 'ERROR', externalId: null, externalData: null, candidates: 0 };
    }
  }
}
