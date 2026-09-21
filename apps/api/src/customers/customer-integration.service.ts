import { BadRequestException, ConflictException, HttpException, Injectable } from '@nestjs/common';
import {
  buildCustomerSiigoLocationMapping,
  isCustomerSiigoLocationMappingCurrent,
  readCustomerSiigoLocationMapping,
  resolveCustomerSiigoCountryByWooCode,
} from '@sevale/shared';
import { createCustomerSchema } from '@sevale/validation';
import type { CustomerIntegrationProvider } from '../generated/prisma/client.js';
import { CustomerIntegrationsRepository } from './customer-integrations.repository.js';
import type { CustomerWithIntegrations } from './customers.repository.js';
import { SiigoCustomerService } from './integrations/siigo-customer.service.js';
import { WooCustomerService } from './integrations/woo-customer.service.js';
import type { CustomerMappingSource } from './mapping/customer-mapping.types.js';
import type { SiigoLocationSelection } from './mapping/customer-mapping.types.js';

export const customerIntegrationProviders = ['SIIGO', 'SERATUS', 'PALI'] as const;

export type CustomerIntegrationResult = {
  provider: CustomerIntegrationProvider;
  status: 'SYNCED' | 'ERROR';
  externalId: string | null;
  message: string | null;
};

type SafeError = { code: string; message: string };

function mappingSource(customer: CustomerWithIntegrations): CustomerMappingSource {
  const result = createCustomerSchema.safeParse({
    personType: customer.personType,
    firstName: customer.firstName,
    lastName: customer.lastName,
    displayName: customer.displayName,
    company: customer.company,
    documentType: customer.documentType,
    documentNumber: customer.documentNumber,
    checkDigit: customer.checkDigit,
    email: customer.email,
    phone: customer.phone,
    country: customer.country,
    region: customer.region,
    cityCode: customer.cityCode,
    cityName: customer.cityName,
    postalCode: customer.postalCode,
    addressLine1: customer.addressLine1,
    addressLine2: customer.addressLine2,
    vatResponsible: customer.vatResponsible,
    fiscalResponsibilities: customer.fiscalResponsibilities,
  });
  if (!result.success) {
    throw new Error('El cliente local contiene datos que no pueden sincronizarse.');
  }
  return { ...result.data, active: customer.active };
}

function providerLabel(provider: CustomerIntegrationProvider): string {
  if (provider === 'SIIGO') return 'Siigo';
  return provider === 'SERATUS' ? 'Seratus' : 'Pali';
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function safeError(error: unknown, provider: CustomerIntegrationProvider): SafeError {
  if (isUniqueConstraintError(error)) {
    return {
      code: 'EXTERNAL_CUSTOMER_CONFLICT',
      message: `El cliente externo ya está vinculado a otro registro del CRM en ${providerLabel(provider)}.`,
    };
  }
  if (error instanceof HttpException) {
    const response: unknown = error.getResponse();
    if (typeof response === 'object' && response !== null && 'error' in response) {
      const detail = (response as { error?: unknown }).error;
      if (typeof detail === 'object' && detail !== null) {
        const code = 'code' in detail ? detail.code : null;
        const message = 'message' in detail ? detail.message : null;
        if (
          typeof code === 'string' &&
          /^[A-Z][A-Z0-9_]{1,99}$/.test(code) &&
          typeof message === 'string' &&
          message.length <= 500
        ) {
          return { code, message };
        }
      }
    }
  }
  return {
    code: `${provider}_CUSTOMER_SYNC_FAILED`,
    message: `No fue posible sincronizar el cliente con ${providerLabel(provider)}.`,
  };
}

@Injectable()
export class CustomerIntegrationService {
  private readonly inFlight = new Map<
    string,
    { fingerprint: string; promise: Promise<CustomerIntegrationResult> }
  >();

  constructor(
    private readonly integrations: CustomerIntegrationsRepository,
    private readonly siigo: SiigoCustomerService,
    private readonly woo: WooCustomerService,
  ) {}

  async synchronize(
    customer: CustomerWithIntegrations,
    providers: readonly CustomerIntegrationProvider[],
    siigoLocation?: SiigoLocationSelection,
  ): Promise<CustomerIntegrationResult[]> {
    const source = mappingSource(customer);
    const settled = await Promise.allSettled(
      providers.map((provider) => this.withLock(customer, source, provider, siigoLocation)),
    );
    return settled.map((result, index) => {
      if (result.status === 'fulfilled') return result.value;
      const provider = providers[index] as CustomerIntegrationProvider;
      const error = safeError(result.reason, provider);
      return { provider, status: 'ERROR', externalId: null, message: error.message };
    });
  }

  private withLock(
    customer: CustomerWithIntegrations,
    source: CustomerMappingSource,
    provider: CustomerIntegrationProvider,
    siigoLocation?: SiigoLocationSelection,
  ): Promise<CustomerIntegrationResult> {
    const key = `${customer.id}:${provider}`;
    const fingerprint = JSON.stringify({
      source,
      siigoLocation: provider === 'SIIGO' ? siigoLocation : undefined,
    });
    const current = this.inFlight.get(key);
    if (current?.fingerprint === fingerprint) return current.promise;

    const synchronize = () => this.synchronizeProvider(customer, source, provider, siigoLocation);
    const operation = current ? current.promise.then(synchronize, synchronize) : synchronize();
    const entry = { fingerprint, promise: operation };
    this.inFlight.set(key, entry);
    const release = () => {
      if (this.inFlight.get(key) === entry) this.inFlight.delete(key);
    };
    void operation.then(release, release);
    return operation;
  }

  private async synchronizeProvider(
    customer: CustomerWithIntegrations,
    source: CustomerMappingSource,
    provider: CustomerIntegrationProvider,
    siigoLocation?: SiigoLocationSelection,
  ): Promise<CustomerIntegrationResult> {
    const attemptedAt = new Date();
    const integration = customer.integrations.find((item) => item.provider === provider);
    let externalId = integration?.externalId ?? null;
    await this.integrations.markPending(customer.id, provider, attemptedAt);

    try {
      const effectiveSiigoLocation = await this.resolveSiigoLocation(
        customer,
        provider,
        siigoLocation,
      );
      externalId = await this.send(
        provider,
        source,
        externalId,
        customer.id,
        effectiveSiigoLocation,
      );
      const syncedAt = new Date();
      await this.integrations.markSynced(customer.id, provider, externalId, syncedAt);
      return { provider, status: 'SYNCED', externalId, message: null };
    } catch (error) {
      const safe = safeError(error, provider);
      await this.integrations.markError(
        customer.id,
        provider,
        attemptedAt,
        safe.code,
        safe.message,
      );
      return { provider, status: 'ERROR', externalId, message: safe.message };
    }
  }

  private async resolveSiigoLocation(
    customer: CustomerWithIntegrations,
    provider: CustomerIntegrationProvider,
    selection?: SiigoLocationSelection,
  ): Promise<SiigoLocationSelection | undefined> {
    if (provider !== 'SIIGO' || customer.country === 'CO') return undefined;
    if (!customer.country) return selection;

    const source = {
      country: customer.country,
      region: customer.region,
      city: customer.cityName,
    };
    if (selection) {
      if (!resolveCustomerSiigoCountryByWooCode(customer.country)) {
        throw new BadRequestException({
          success: false,
          error: {
            code: 'SIIGO_CUSTOMER_COUNTRY_NOT_MAPPED',
            message: 'El país del cliente no está disponible en el catálogo de Siigo.',
          },
        });
      }
      const mapping = buildCustomerSiigoLocationMapping(source, selection);
      if (!mapping) {
        throw new BadRequestException({
          success: false,
          error: {
            code: 'SIIGO_CUSTOMER_LOCATION_INVALID',
            message: 'La ciudad seleccionada no pertenece a la región de Siigo.',
          },
        });
      }
      await this.integrations.mergeExternalData(customer.id, 'SIIGO', {
        siigoLocation: mapping,
      });
      return { stateCode: mapping.target.stateCode, cityCode: mapping.target.cityCode };
    }

    const integration = customer.integrations.find(({ provider: item }) => item === 'SIIGO');
    const mapping = readCustomerSiigoLocationMapping(integration?.externalData);
    if (!mapping || !isCustomerSiigoLocationMappingCurrent(mapping, source)) return undefined;
    return { stateCode: mapping.target.stateCode, cityCode: mapping.target.cityCode };
  }

  private async send(
    provider: CustomerIntegrationProvider,
    customer: CustomerMappingSource,
    externalId: string | null,
    customerId: number,
    siigoLocation?: SiigoLocationSelection,
  ): Promise<string> {
    if (provider === 'SIIGO') {
      if (externalId) {
        return (await this.siigo.updateCustomer(externalId, customer, siigoLocation)).id;
      }
      const existing = await this.siigo.findCustomer(customer.documentNumber);
      if (existing) {
        const expectedType = customer.personType === 'PERSON' ? 'Person' : 'Company';
        if (existing.personType !== expectedType) throw this.conflict('Siigo');
        await this.integrations.rememberExternalId(customerId, provider, existing.id);
        return (await this.siigo.updateCustomer(existing.id, customer, siigoLocation)).id;
      }
      return (await this.siigo.createCustomer(customer, siigoLocation)).id;
    }

    if (externalId) {
      return (await this.woo.updateCustomer(provider, externalId, customer)).id;
    }
    const existing = await this.woo.findCustomer(provider, customer);
    if (existing) {
      await this.integrations.rememberExternalId(customerId, provider, existing.id);
      return (await this.woo.updateCustomer(provider, existing.id, customer)).id;
    }
    return (await this.woo.createCustomer(provider, customer)).id;
  }

  private conflict(label: string): ConflictException {
    return new ConflictException({
      success: false,
      error: {
        code: 'EXTERNAL_CUSTOMER_CONFLICT',
        message: `La identidad encontrada en ${label} no corresponde inequívocamente al cliente del CRM.`,
      },
    });
  }
}
