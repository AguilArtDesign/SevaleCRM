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
import { CustomersRepository } from '../apps/api/src/customers/customers.repository.js';
import { createCustomersWorkbook } from '../apps/api/src/customers/customer-export.js';
import { customerExportSchema, customerListQuerySchema } from '../packages/validation/src/index.js';
import {
  CustomerIntegrationProvider,
  CustomerIntegrationStatus,
  CustomerPersonType,
} from '../apps/api/src/generated/prisma/client.js';

const prisma = new PrismaService();
const integrationsRepository = new CustomerIntegrationsRepository(prisma);
const customersRepository = new CustomersRepository(prisma);
await prisma.$connect();
let customerId: number | null = null;
const documentNumber = `SMOKE-${Date.now()}`;

/**
 * Comprueba qué devuelve el listado para el filtro de estado de sincronización. El estado no se
 * guarda: se deduce de las tres integraciones con la prioridad que muestra el panel
 * (error > sincronizado > desactualizado > pendiente), así que conviene verificar cada caso.
 */
async function appearsWithStatus(status: string) {
  const query = customerListQuerySchema.parse({ status, pageSize: 100 });
  const [rows] = await customersRepository.list(query, []);
  return rows.some((row) => row.id === customerId);
}

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

  // --- Filtro de estado de sincronización -------------------------------------------------  // Recién creado, todo está pendiente y nada se ha sincronizado nunca.
  if (!(await appearsWithStatus('PENDING'))) {
    throw new Error('El filtro «Pendiente» no devolvió un cliente recién creado.');
  }
  if (await appearsWithStatus('SYNCED')) {
    throw new Error('El filtro «Sincronizado» devolvió un cliente con integraciones pendientes.');
  }
  if (await appearsWithStatus('OUT_OF_SYNC')) {
    throw new Error('El filtro «Desactualizado» devolvió un cliente que nunca se sincronizó.');
  }

  // Todas sincronizadas: pasa a «Sincronizado».
  await prisma.customerIntegration.updateMany({
    where: { customerId: customer.id },
    data: { status: CustomerIntegrationStatus.SYNCED, lastSyncedAt: new Date() },
  });
  if (!(await appearsWithStatus('SYNCED'))) {
    throw new Error('El filtro «Sincronizado» no devolvió un cliente con todo sincronizado.');
  }
  if (await appearsWithStatus('PENDING')) {
    throw new Error('El filtro «Pendiente» devolvió un cliente con todo sincronizado.');
  }

  // Una integración que vuelve a pendiente tras haberse sincronizado es «Desactualizado».
  await prisma.customerIntegration.update({
    where: {
      customerId_provider: {
        customerId: customer.id,
        provider: CustomerIntegrationProvider.PALI,
      },
    },
    data: { status: CustomerIntegrationStatus.PENDING },
  });
  if (!(await appearsWithStatus('OUT_OF_SYNC'))) {
    throw new Error('El filtro «Desactualizado» no detectó el cambio pendiente sin enviar.');
  }

  // Un error manda sobre «desactualizado», igual que en la tabla.
  await prisma.customerIntegration.update({
    where: {
      customerId_provider: {
        customerId: customer.id,
        provider: CustomerIntegrationProvider.SERATUS,
      },
    },
    data: { status: CustomerIntegrationStatus.ERROR },
  });
  if (!(await appearsWithStatus('ERROR'))) {
    throw new Error('El filtro «Con error» no devolvió el cliente con una integración fallida.');
  }
  if (await appearsWithStatus('OUT_OF_SYNC')) {
    throw new Error('El filtro «Desactualizado» incluyó un cliente que además tiene error.');
  }

  // Se deja como estaba para el resto de comprobaciones del smoke.
  await prisma.customerIntegration.updateMany({
    where: { customerId: customer.id },
    data: {
      status: CustomerIntegrationStatus.PENDING,
      lastSyncedAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    },
  });

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

  // --- Exportación a Excel ----------------------------------------------------------------
  // Se usa el servicio de exportación con el repositorio real para comprobar el archivo completo:
  // cabeceras exactas, nombres en lugar de códigos y las once columnas pedidas.
  if (customerExportSchema.safeParse({ ids: [] }).success) {
    throw new Error('La exportación aceptó una selección vacía.');
  }
  const exportIds = customerExportSchema.parse({ ids: [customer.id, customer.id] });
  if (exportIds.ids.length !== 1) {
    throw new Error('La exportación no eliminó los identificadores repetidos.');
  }
  const exported = await customersRepository.findByIds(exportIds.ids);
  if (exported.length !== 1) {
    throw new Error('La exportación no encontró el cliente seleccionado.');
  }
  const workbook = createCustomersWorkbook(exported);
  if (workbook.subarray(0, 2).toString('latin1') !== 'PK') {
    throw new Error('El archivo exportado no es un xlsx válido.');
  }
  // El ZIP guarda los XML sin comprimir, así que la hoja se puede leer directamente del buffer.
  const sheet = workbook.toString('utf8');
  const expectedHeaders = [
    'Nombres',
    'Apellidos',
    'Tipo de documento',
    'Número de documento',
    'Teléfono',
    'Correo electrónico',
    'País',
    'Región / Provincia',
    'Ciudad',
    'Código postal',
    'Dirección 1',
    'Dirección 2',
  ];
  for (const header of expectedHeaders) {
    if (!sheet.includes(`>${header}<`)) {
      throw new Error(`La exportación no incluye la columna «${header}».`);
    }
  }
  const expectedValues = [
    'Cédula de ciudadanía',
    'Panamá',
    'Ciudad de Panamá',
    '+573006003345',
    `customers-${documentNumber.toLowerCase()}@example.invalid`,
  ];
  for (const value of expectedValues) {
    if (!sheet.includes(`>${value}<`)) {
      throw new Error(`La exportación no resolvió el valor legible «${value}».`);
    }
  }
  for (const code of ['>CO<', '>PA<', '>13<', '>PA-8<']) {
    if (sheet.includes(code)) {
      throw new Error(`La exportación incluyó el código interno ${code.replaceAll('>', '')}.`);
    }
  }
  if (!sheet.includes('autoFilter ref="A1:L2"')) {
    throw new Error('La exportación no ajustó el filtro al número de columnas.');
  }
  // El encabezado va en negro y sin alto propio: debe medir lo mismo que las filas de datos.
  if (!sheet.includes('<fgColor rgb="FF000000"/>')) {
    throw new Error('El encabezado de la exportación no usa el relleno negro.');
  }
  if (/<row r="1"[^>]*customHeight/.test(sheet)) {
    throw new Error('El encabezado de la exportación conserva un alto distinto al de las filas.');
  }

  process.stdout.write(
    'Customers model smoke: RBAC, locations, international city, integrations, duplicate protection, sync-status filter and Excel export checks passed.\n',
  );
} finally {
  if (customerId !== null) await prisma.customer.delete({ where: { id: customerId } });
  await prisma.$disconnect();
}
