import '../apps/api/src/config/load-environment.js';
import { GatewayTimeoutException } from '@nestjs/common';
import type { CustomerIntegrationProvider } from '../apps/api/src/generated/prisma/client.js';
import {
  CustomerIntegrationService,
  customerIntegrationProviders,
} from '../apps/api/src/customers/customer-integration.service.js';
import type { CustomerIntegrationsRepository } from '../apps/api/src/customers/customer-integrations.repository.js';
import type { CustomerWithIntegrations } from '../apps/api/src/customers/customers.repository.js';
import type { SiigoCustomerService } from '../apps/api/src/customers/integrations/siigo-customer.service.js';
import type { WooCustomerService } from '../apps/api/src/customers/integrations/woo-customer.service.js';

type IntegrationState = {
  externalId: string | null;
  status: 'PENDING' | 'SYNCED' | 'ERROR';
  lastAttemptAt: Date | null;
  lastSyncedAt: Date | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

const states = new Map<CustomerIntegrationProvider, IntegrationState>(
  customerIntegrationProviders.map((provider) => [
    provider,
    {
      externalId: null,
      status: 'PENDING',
      lastAttemptAt: null,
      lastSyncedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  ]),
);

function state(provider: CustomerIntegrationProvider): IntegrationState {
  const current = states.get(provider);
  if (!current) throw new Error(`No existe estado simulado para ${provider}.`);
  return current;
}

const repository = {
  markPending: (_customerId: number, provider: CustomerIntegrationProvider, attemptedAt: Date) => {
    Object.assign(state(provider), {
      status: 'PENDING',
      lastAttemptAt: attemptedAt,
      lastErrorCode: null,
      lastErrorMessage: null,
    });
    return Promise.resolve(state(provider));
  },
  rememberExternalId: (
    _customerId: number,
    provider: CustomerIntegrationProvider,
    externalId: string,
  ) => {
    state(provider).externalId = externalId;
    return Promise.resolve(state(provider));
  },
  markSynced: (
    _customerId: number,
    provider: CustomerIntegrationProvider,
    externalId: string,
    syncedAt: Date,
  ) => {
    Object.assign(state(provider), {
      externalId,
      status: 'SYNCED',
      lastAttemptAt: syncedAt,
      lastSyncedAt: syncedAt,
      lastErrorCode: null,
      lastErrorMessage: null,
    });
    return Promise.resolve(state(provider));
  },
  markError: (
    _customerId: number,
    provider: CustomerIntegrationProvider,
    attemptedAt: Date,
    code: string,
    message: string,
  ) => {
    Object.assign(state(provider), {
      status: 'ERROR',
      lastAttemptAt: attemptedAt,
      lastErrorCode: code,
      lastErrorMessage: message,
    });
    return Promise.resolve(state(provider));
  },
} as unknown as CustomerIntegrationsRepository;

const siigoId = '377d11bb-4fce-4e80-bd6d-c593da3fccdb';
let siigoCreates = 0;
const siigo = {
  findCustomer: () =>
    Promise.resolve({ id: siigoId, identification: '13832081', personType: 'Person' as const }),
  createCustomer: () => {
    siigoCreates += 1;
    return Promise.resolve({
      id: siigoId,
      identification: '13832081',
      personType: 'Person' as const,
    });
  },
  updateCustomer: (externalId: string) =>
    Promise.resolve({
      id: externalId,
      identification: '13832081',
      personType: 'Person' as const,
    }),
} as unknown as SiigoCustomerService;

let paliExists = false;
let paliCreates = 0;
let paliUpdates = 0;
let delayNextSeratusUpdate = false;
const releaseSeratusUpdates: Array<() => void> = [];
const seratusUpdateEmails: string[] = [];
const woo = {
  findCustomer: (store: 'SERATUS' | 'PALI') => {
    if (store === 'PALI' && paliExists) {
      return Promise.resolve({
        id: '220',
        email: 'marcos.castillo@example.com',
        username: '13832081',
      });
    }
    return Promise.resolve(null);
  },
  createCustomer: (store: 'SERATUS' | 'PALI') => {
    if (store === 'PALI') {
      paliCreates += 1;
      throw new GatewayTimeoutException({
        success: false,
        error: { code: 'INTEGRATION_TIMEOUT', message: 'Pali tardó demasiado en responder.' },
      });
    }
    return Promise.resolve({
      id: '110',
      email: 'marcos.castillo@example.com',
      username: '13832081',
    });
  },
  updateCustomer: (
    store: 'SERATUS' | 'PALI',
    externalId: string,
    customer: CustomerWithIntegrations,
  ) => {
    if (store === 'PALI') paliUpdates += 1;
    const response = {
      id: externalId,
      email: customer.email!,
      username: customer.documentNumber,
    };
    if (store !== 'SERATUS') return Promise.resolve(response);
    seratusUpdateEmails.push(customer.email!);
    if (!delayNextSeratusUpdate) return Promise.resolve(response);
    delayNextSeratusUpdate = false;
    return new Promise<typeof response>((resolve) => {
      releaseSeratusUpdates.push(() => resolve(response));
    });
  },
} as unknown as WooCustomerService;

function customerFromState(): CustomerWithIntegrations {
  const now = new Date();
  return {
    id: 701,
    personType: 'PERSON',
    firstName: 'Marcos',
    lastName: 'Castillo',
    displayName: 'Marcos Castillo',
    company: null,
    documentType: '13',
    documentNumber: '13832081',
    checkDigit: null,
    email: 'marcos.castillo@example.com',
    phone: '+573006003345',
    country: 'CO',
    region: 'CO-ANT',
    cityCode: '05001',
    postalCode: '050001',
    addressLine1: 'Cra. 18 #79A - 42',
    addressLine2: null,
    vatResponsible: false,
    fiscalResponsibilities: ['R-99-PN'],
    active: true,
    createdAt: now,
    updatedAt: now,
    deletedAt: null,
    integrations: customerIntegrationProviders.map((provider, index) => ({
      id: index + 1,
      customerId: 701,
      provider,
      externalId: state(provider).externalId,
      externalData: null,
      status: state(provider).status,
      lastAttemptAt: state(provider).lastAttemptAt,
      lastSyncedAt: state(provider).lastSyncedAt,
      lastErrorCode: state(provider).lastErrorCode,
      lastErrorMessage: state(provider).lastErrorMessage,
      createdAt: now,
      updatedAt: now,
    })),
  };
}

const service = new CustomerIntegrationService(repository, siigo, woo);
const first = await service.synchronize(customerFromState(), customerIntegrationProviders);
if (
  first.find(({ provider }) => provider === 'SIIGO')?.status !== 'SYNCED' ||
  first.find(({ provider }) => provider === 'SERATUS')?.status !== 'SYNCED' ||
  first.find(({ provider }) => provider === 'PALI')?.status !== 'ERROR'
) {
  throw new Error('La orquestación no conservó el resultado parcial por proveedor.');
}
if (
  state('SIIGO').externalId !== siigoId ||
  state('SERATUS').externalId !== '110' ||
  state('PALI').lastErrorCode !== 'INTEGRATION_TIMEOUT' ||
  siigoCreates !== 0 ||
  paliCreates !== 1
) {
  throw new Error('El preflight, los external_id o el error sanitizado no se registraron.');
}

paliExists = true;
const retry = await service.synchronize(customerFromState(), ['PALI']);
if (
  retry[0]?.status !== 'SYNCED' ||
  state('PALI').externalId !== '220' ||
  state('PALI').lastSyncedAt === null ||
  paliCreates !== 1 ||
  paliUpdates !== 1
) {
  throw new Error('El retry no recuperó el cliente existente de Pali de forma idempotente.');
}

delayNextSeratusUpdate = true;
const firstVersion = {
  ...customerFromState(),
  email: 'primera-version@example.com',
};
const secondVersion = {
  ...customerFromState(),
  email: 'segunda-version@example.com',
};
const firstConcurrent = service.synchronize(firstVersion, ['SERATUS']);
while (releaseSeratusUpdates.length === 0) await new Promise((resolve) => setTimeout(resolve, 0));
const secondConcurrent = service.synchronize(secondVersion, ['SERATUS']);
await new Promise((resolve) => setTimeout(resolve, 0));
if (seratusUpdateEmails.at(-1) !== firstVersion.email) {
  throw new Error('La segunda versión comenzó antes de finalizar la primera sincronización.');
}
releaseSeratusUpdates.shift()?.();
await Promise.all([firstConcurrent, secondConcurrent]);
if (seratusUpdateEmails.slice(-2).join(',') !== `${firstVersion.email},${secondVersion.email}`) {
  throw new Error(
    'Las ediciones concurrentes no conservaron su orden ni su payload independiente.',
  );
}

process.stdout.write(
  'Customer orchestration smoke: partial results, preflight linking, external IDs, sanitized errors, idempotent retry and serialized concurrent updates passed.\n',
);
