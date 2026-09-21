import '../apps/api/src/config/load-environment.js';
import { rolePermissions } from '../packages/permissions/src/index.js';
import {
  getCountries,
  getStates,
  mapLocationToSiigo,
  mapLocationToWoo,
  resolveCity,
} from '../packages/shared/src/index.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { CustomerIntegrationsRepository } from '../apps/api/src/customers/customer-integrations.repository.js';
import {
  CustomerIntegrationProvider,
  CustomerIntegrationStatus,
  CustomerPersonType,
} from '../apps/api/src/generated/prisma/client.js';

const prisma = new PrismaService();
const integrationsRepository = new CustomerIntegrationsRepository(prisma);
await prisma.$connect();
let customerId: number | null = null;
const documentNumber = `SMOKE-${Date.now()}`;

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

try {
  if (
    !rolePermissions.ADMIN.includes('customers.sync') ||
    !rolePermissions.ADMIN.includes('customers.delete') ||
    !rolePermissions.COMMERCIAL.includes('customers.read') ||
    !rolePermissions.COMMERCIAL.includes('customers.create') ||
    !rolePermissions.COMMERCIAL.includes('customers.update') ||
    !rolePermissions.COMMERCIAL.includes('customers.sync') ||
    rolePermissions.COMMERCIAL.some(
      (permission) => permission === ('customers.delete' as string),
    ) ||
    rolePermissions.LOGISTICS.some((permission) => permission.startsWith('customers.'))
  ) {
    throw new Error('La matriz RBAC de Clientes no coincide con la definición aprobada.');
  }

  if (getCountries().length !== 250 || getStates('CO').length !== 33) {
    throw new Error('El catálogo geográfico no contiene los países y regiones esperados.');
  }
  if (resolveCity('CO', 'CO-ANT', '05001') !== 'Medellín') {
    throw new Error('El catálogo no conservó el código de ciudad con cero inicial.');
  }
  const wooLocation = mapLocationToWoo('CO', 'CO-ANT', '05001');
  const siigoLocation = mapLocationToSiigo('CO', 'CO-ANT', '05001');
  if (
    wooLocation?.state !== 'CO-ANT' ||
    wooLocation.city !== 'Medellín' ||
    siigoLocation?.countryCode !== 'Co' ||
    siigoLocation.stateCode !== '05' ||
    siigoLocation.cityCode !== '05001'
  ) {
    throw new Error('El mapping geográfico para Colombia no devolvió los códigos esperados.');
  }

  const customer = await prisma.customer.create({
    data: {
      personType: CustomerPersonType.PERSON,
      firstName: 'Cliente',
      lastName: 'Prueba',
      displayName: 'Cliente Prueba',
      documentType: '13',
      documentNumber,
      email: `customers-${documentNumber.toLowerCase()}@example.invalid`,
      phone: '+573006003345',
      country: 'CO',
      region: 'CO-ANT',
      cityCode: '05001',
      postalCode: '050001',
      addressLine1: 'Dirección de prueba',
      vatResponsible: false,
      fiscalResponsibilities: ['R-99-PN'],
      integrations: {
        create: Object.values(CustomerIntegrationProvider).map((provider) => ({
          provider,
          status: CustomerIntegrationStatus.PENDING,
        })),
      },
    },
    include: { integrations: true },
  });
  customerId = customer.id;
  if (customer.integrations.length !== 3) {
    throw new Error('El cliente local no creó sus tres integraciones pendientes.');
  }

  const siigoExternalId = `siigo-smoke-${Date.now()}`;
  await prisma.customerIntegration.update({
    where: {
      customerId_provider: {
        customerId: customer.id,
        provider: CustomerIntegrationProvider.SIIGO,
      },
    },
    data: { externalId: siigoExternalId },
  });
  const siigoIntegration = await prisma.customerIntegration.findUnique({
    where: {
      provider_externalId: {
        provider: CustomerIntegrationProvider.SIIGO,
        externalId: siigoExternalId,
      },
    },
  });
  if (siigoIntegration?.customerId !== customer.id) {
    throw new Error('La integración no conservó el identificador externo de Siigo.');
  }

  await prisma.customerIntegration.update({
    where: {
      customerId_provider: {
        customerId: customer.id,
        provider: CustomerIntegrationProvider.SIIGO,
      },
    },
    data: { externalData: { preserved: { value: true } } },
  });
  await integrationsRepository.mergeExternalData(customer.id, CustomerIntegrationProvider.SIIGO, {
    siigoLocation: {
      source: { country: 'PA', region: 'PA-8', city: 'Ciudad de Panamá' },
      target: {
        countryCode: 'Pa',
        stateCode: '05',
        stateName: 'Ciudad de panamá',
        cityCode: '0501',
        cityName: 'Ciudad de panamá',
      },
    },
  });
  const mergedIntegration = await prisma.customerIntegration.findUniqueOrThrow({
    where: {
      customerId_provider: {
        customerId: customer.id,
        provider: CustomerIntegrationProvider.SIIGO,
      },
    },
  });
  const mergedExternalData = mergedIntegration.externalData as {
    preserved?: { value?: boolean };
    siigoLocation?: { target?: { cityCode?: string } };
  };
  if (
    mergedExternalData.preserved?.value !== true ||
    mergedExternalData.siigoLocation?.target?.cityCode !== '0501'
  ) {
    throw new Error('El merge de external_data reemplazó información previa de la integración.');
  }

  let duplicateRejected = false;
  try {
    await prisma.customer.create({
      data: {
        personType: CustomerPersonType.PERSON,
        displayName: 'Cliente Duplicado',
        documentType: '13',
        documentNumber,
        email: `duplicate-${documentNumber.toLowerCase()}@example.invalid`,
        country: 'CO',
        region: 'CO-ANT',
        cityCode: '05001',
        addressLine1: 'Dirección de prueba',
        fiscalResponsibilities: ['R-99-PN'],
      },
    });
  } catch (error) {
    duplicateRejected = isUniqueConstraintError(error);
  }
  if (!duplicateRejected) {
    throw new Error('La base de datos permitió duplicar el tipo y número de documento.');
  }

  const international = await prisma.customer.update({
    where: { id: customer.id },
    data: {
      country: 'PA',
      region: 'PA-8',
      cityCode: null,
      cityName: 'Ciudad de Panamá',
    },
  });
  if (
    international.country !== 'PA' ||
    international.region !== 'PA-8' ||
    international.cityCode !== null ||
    international.cityName !== 'Ciudad de Panamá'
  ) {
    throw new Error('El cliente internacional no conservó la ciudad libre esperada.');
  }

  process.stdout.write(
    'Customers model smoke: RBAC, locations, international city, integrations and duplicate protection checks passed.\n',
  );
} finally {
  if (customerId !== null) await prisma.customer.delete({ where: { id: customerId } });
  await prisma.$disconnect();
}
