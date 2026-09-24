import '../apps/api/src/config/load-environment.js';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword } from 'better-auth/crypto';
import { AppModule } from '../apps/api/src/app.module.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { OperationStatus, OrderSource, Role } from '../apps/api/src/generated/prisma/client.js';
import { SiigoCustomerService } from '../apps/api/src/customers/integrations/siigo-customer.service.js';
import { WooCustomerService } from '../apps/api/src/customers/integrations/woo-customer.service.js';
import { NotificationsService } from '../apps/api/src/notifications/notifications.service.js';

process.env.BETTER_AUTH_SECRET ||= 'local-customers-smoke-secret-at-least-32-characters';

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
  logger: false,
});
app.setGlobalPrefix('api');
const origin = process.env.FRONTEND_URL || 'http://localhost:5173';
app.enableCors({ origin, credentials: true });
await app.listen(0, '127.0.0.1');

const prisma = app.get(PrismaService);
const siigoCustomers = app.get(SiigoCustomerService);
const wooCustomers = app.get(WooCustomerService);
const notifications = app.get(NotificationsService);
const baseUrl = await app.getUrl();
const runId = randomUUID();
const password = `C-${randomUUID()}-9a!`;
const userIds: string[] = [];
const customerIds: number[] = [];
const siigoExternalId = randomUUID();
const incompleteSiigoExternalId = randomUUID();
const commercialSiigoExternalId = randomUUID();
const documentNumber = String(Date.now()).slice(-12);
const incompleteDocumentNumber = String(Number(documentNumber) + 1);
const commercialDocumentNumber = String(Number(documentNumber) + 2);
let siigoCreateCalls = 0;
let wooCreateCalls = 0;
let siigoUpdateCalls = 0;
let wooUpdateCalls = 0;

function wooReference(
  store: 'SERATUS' | 'PALI',
  id: string,
  identification: string,
  email: string,
) {
  return {
    id,
    email,
    first_name: 'Marcos',
    last_name: 'Castillo',
    username: identification,
    billing: {
      first_name: 'Marcos',
      last_name: 'Castillo',
      company: '',
      address_1: 'Cra. 18 #79A - 42',
      address_2: 'Apto 301',
      city: 'Medellín',
      postcode: '050001',
      country: 'CO',
      state: 'CO-ANT',
      email,
      phone: '+57 300 600 3345',
    },
    meta_data: [
      {
        id: store === 'SERATUS' ? 316 : 65,
        key: 'billing_type_document' as const,
        value: 'Documento Extranjero',
      },
      {
        id: store === 'SERATUS' ? 317 : 66,
        key: 'billing_identification' as const,
        value: identification,
      },
    ],
  };
}

siigoCustomers.findCustomer = () => Promise.resolve(null);
siigoCustomers.lookupCustomer = (identification) =>
  Promise.resolve(
    identification === 'missing-customer'
      ? null
      : {
          reference: {
            id:
              identification === incompleteDocumentNumber
                ? incompleteSiigoExternalId
                : identification === commercialDocumentNumber
                  ? commercialSiigoExternalId
                  : siigoExternalId,
            identification,
            personType: 'Person',
            checkDigit: null,
          },
          prefill: {
            personType: 'PERSON',
            firstName: 'Marcos',
            lastName: 'Castillo',
            displayName: `Marcos Castillo ${runId}`,
            company: null,
            documentType: '13',
            documentNumber: identification,
            checkDigit: null,
            email:
              identification === incompleteDocumentNumber
                ? null
                : `marcos-${runId}@example.invalid`,
            phone: identification === incompleteDocumentNumber ? null : '+573006003345',
            country: identification === incompleteDocumentNumber ? null : 'CO',
            region: identification === incompleteDocumentNumber ? null : 'CO-ANT',
            cityCode: identification === incompleteDocumentNumber ? null : '05001',
            postalCode: identification === incompleteDocumentNumber ? null : '050001',
            addressLine1: identification === incompleteDocumentNumber ? null : 'Cra. 18 #79A - 42',
            addressLine2: null,
            vatResponsible: false,
            fiscalResponsibilities: ['R-99-PN'],
            active: true,
          },
        },
  );
siigoCustomers.createCustomer = (customer) => {
  siigoCreateCalls += 1;
  return Promise.resolve({
    id: siigoExternalId,
    identification: customer.documentNumber,
    personType: customer.personType === 'PERSON' ? 'Person' : 'Company',
    checkDigit: customer.personType === 'COMPANY' ? '7' : null,
  });
};
siigoCustomers.updateCustomer = (_externalId, customer) => {
  siigoUpdateCalls += 1;
  return Promise.resolve({
    id: siigoExternalId,
    identification: customer.documentNumber,
    personType: customer.personType === 'PERSON' ? 'Person' : 'Company',
    checkDigit: customer.personType === 'COMPANY' ? '7' : null,
  });
};
wooCustomers.findCustomer = () => Promise.resolve(null);
wooCustomers.findCustomerByDocument = (store, documentType, identification) =>
  Promise.resolve(
    identification === 'missing-customer'
      ? ({ status: 'NOT_FOUND' } as const)
      : ({
          status: 'FOUND',
          customer: wooReference(
            store,
            identification === incompleteDocumentNumber
              ? store === 'SERATUS'
                ? '31002'
                : '41002'
              : identification === commercialDocumentNumber
                ? store === 'SERATUS'
                  ? '31003'
                  : '41003'
                : store === 'SERATUS'
                  ? '31001'
                  : '41001',
            identification,
            `marcos-${runId}@example.invalid`,
          ),
        } as const),
  );
wooCustomers.createCustomer = (store, customer) => {
  wooCreateCalls += 1;
  return Promise.resolve(
    wooReference(
      store,
      store === 'SERATUS' ? '31001' : '41001',
      customer.documentNumber,
      customer.email!,
    ),
  );
};
wooCustomers.updateCustomer = (store, externalId, customer) => {
  wooUpdateCalls += 1;
  return Promise.resolve(
    wooReference(
      store,
      externalId || (store === 'SERATUS' ? '31001' : '41001'),
      customer.documentNumber,
      customer.email!,
    ),
  );
};

function expectStatus(response: Response, status: number, context: string) {
  if (response.status !== status) {
    throw new Error(`${context}: se esperaba ${status} y se recibió ${response.status}.`);
  }
}

async function createUser(role: Role) {
  const id = randomUUID();
  const email = `customers-${role.toLowerCase()}-${runId}@example.invalid`;
  userIds.push(id);
  await prisma.user.create({
    data: {
      id,
      name: `Customers Smoke ${role}`,
      email,
      emailVerified: true,
      role,
      active: true,
      accounts: {
        create: {
          id: randomUUID(),
          accountId: id,
          providerId: 'credential',
          issuer: 'local:credential',
          password: await hashPassword(password),
        },
      },
    },
  });
  const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      'x-captcha-response': 'XXXX.DUMMY.TOKEN.XXXX',
    },
    body: JSON.stringify({ email, password }),
  });
  expectStatus(response, 200, `Inicio de sesión ${role}`);
  const cookie = response.headers.getSetCookie()[0]?.split(';')[0];
  if (!cookie) throw new Error(`No se creó la sesión ${role}.`);
  return cookie;
}

async function api(path: string, cookie?: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      origin,
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...(cookie ? { cookie } : {}),
      ...init?.headers,
    },
  });
}

const payload = {
  personType: 'PERSON',
  firstName: 'Marcos',
  lastName: 'Castillo',
  displayName: `Marcos Castillo ${runId}`,
  company: null,
  documentType: '13',
  documentNumber,
  checkDigit: null,
  email: `marcos-${runId}@example.invalid`,
  phone: '+57 300 600 3345',
  country: 'CO',
  region: 'CO-ANT',
  cityCode: '05001',
  postalCode: '00000',
  addressLine1: 'Cra. 18 #79A - 42',
  addressLine2: null,
  vatResponsible: false,
  fiscalResponsibilities: ['R-99-PN'],
};

try {
  const [adminCookie, commercialCookie, logisticsCookie] = await Promise.all([
    createUser(Role.ADMIN),
    createUser(Role.COMMERCIAL),
    createUser(Role.LOGISTICS),
  ]);

  expectStatus(await api('/api/customers'), 401, 'Listado anónimo');
  expectStatus(await api('/api/customers', logisticsCookie), 403, 'Listado logística');
  expectStatus(await api('/api/customers', commercialCookie), 200, 'Listado comercial');
  expectStatus(
    await api(
      `/api/customers/resolve?identification=${documentNumber}&documentType=13`,
      commercialCookie,
    ),
    200,
    'Consulta Siigo comercial',
  );

  const lookupResponse = await api(
    `/api/customers/resolve?identification=${documentNumber}&documentType=13`,
    adminCookie,
  );
  expectStatus(lookupResponse, 200, 'Consulta Siigo administrativa');
  const lookup = (await lookupResponse.json()) as {
    existsLocally: boolean;
    found: boolean;
    customer?: {
      documentNumber: string;
      country: string | null;
      region: string | null;
      cityCode: string | null;
      cityName: string | null;
      addressLine2: string | null;
    };
    integrations: Array<{ provider: string; status: string; externalId: string | null }>;
  };
  if (
    lookup.existsLocally ||
    !lookup.found ||
    lookup.customer?.documentNumber !== documentNumber ||
    lookup.customer.country !== null ||
    lookup.customer.region !== null ||
    lookup.customer.cityCode !== null ||
    lookup.customer.cityName !== null ||
    lookup.customer.addressLine2 !== null ||
    lookup.integrations.find(({ provider }) => provider === 'SERATUS')?.externalId !== '31001' ||
    lookup.integrations.find(({ provider }) => provider === 'PALI')?.externalId !== '41001'
  ) {
    throw new Error('La consulta externa no devolvió el formulario y los vínculos esperados.');
  }

  const resolvedResponse = await api(
    `/api/customers/resolve?identification=${documentNumber}&documentType=13`,
    adminCookie,
  );
  expectStatus(resolvedResponse, 200, 'Resolución canónica administrativa');
  const resolved = (await resolvedResponse.json()) as {
    existsLocally: boolean;
    found: boolean;
    customer?: { documentNumber: string };
    conflicts: { address?: { options: unknown[] } };
    integrations: Array<Record<string, unknown>>;
  };
  if (
    resolved.existsLocally ||
    !resolved.found ||
    resolved.customer?.documentNumber !== documentNumber ||
    resolved.conflicts.address?.options.length !== 2 ||
    resolved.integrations.some((integration) => 'externalData' in integration)
  ) {
    throw new Error('La resolución no devolvió un draft canónico y conflictos temporales.');
  }

  const incompleteLookupResponse = await api(
    `/api/customers/resolve?identification=${incompleteDocumentNumber}&documentType=13`,
    adminCookie,
  );
  expectStatus(incompleteLookupResponse, 200, 'Consulta con datos incompletos en Siigo');
  const incompleteLookup = (await incompleteLookupResponse.json()) as {
    customer?: {
      email: string | null;
      phone: string | null;
      country: string | null;
      region: string | null;
      cityCode: string | null;
      addressLine1: string | null;
      addressLine2: string | null;
    };
  };
  if (
    incompleteLookup.customer?.email !== `marcos-${runId}@example.invalid` ||
    incompleteLookup.customer.phone !== '+573006003345' ||
    incompleteLookup.customer.country !== null ||
    incompleteLookup.customer.region !== null ||
    incompleteLookup.customer.cityCode !== null ||
    incompleteLookup.customer.addressLine1 !== 'Cra. 18 #79A - 42' ||
    incompleteLookup.customer.addressLine2 !== 'Apto 301'
  ) {
    throw new Error('WooCommerce no completó exclusivamente los vacíos devueltos por Siigo.');
  }

  const missingLookupResponse = await api(
    '/api/customers/resolve?identification=missing-customer&documentType=13',
    adminCookie,
  );
  expectStatus(missingLookupResponse, 200, 'Consulta Siigo sin resultado');
  const missingLookup = (await missingLookupResponse.json()) as {
    existsLocally: boolean;
    found: boolean;
  };
  if (missingLookup.existsLocally || missingLookup.found)
    throw new Error('La consulta inexistente devolvió un cliente.');

  const commercialCreate = await api('/api/customers', commercialCookie, {
    method: 'POST',
    body: JSON.stringify({
      ...payload,
      documentNumber: commercialDocumentNumber,
      firstName: 'Cliente',
      lastName: 'Comercial',
      displayName: `Cliente Comercial ${commercialDocumentNumber}`,
      email: `commercial-${commercialDocumentNumber}@example.invalid`,
    }),
  });
  expectStatus(commercialCreate, 201, 'Creación comercial');
  const commercialCustomer = (await commercialCreate.json()) as { id: number };
  customerIds.push(commercialCustomer.id);

  const invalidLocation = await api('/api/customers', adminCookie, {
    method: 'POST',
    body: JSON.stringify({ ...payload, cityCode: '999999' }),
  });
  expectStatus(invalidLocation, 400, 'Ubicación inválida');

  const invalidPhone = await api('/api/customers', adminCookie, {
    method: 'POST',
    body: JSON.stringify({
      ...payload,
      phone: '+12071910805',
      country: 'US',
      region: 'CA',
      cityCode: null,
      cityName: 'Los Ángeles',
    }),
  });
  expectStatus(invalidPhone, 400, 'Teléfono inválido');
  const invalidPhoneBody = (await invalidPhone.json()) as {
    error?: { code?: string; message?: string };
  };
  if (
    invalidPhoneBody.error?.code !== 'CUSTOMER_PHONE_INVALID' ||
    invalidPhoneBody.error.message !== 'El teléfono no es válido para el país seleccionado.'
  ) {
    throw new Error('La API no explicó de forma segura por qué rechazó el teléfono.');
  }

  const internalEmail = await api('/api/customers', adminCookie, {
    method: 'POST',
    body: JSON.stringify({ ...payload, email: 'usuario@sevale.com' }),
  });
  expectStatus(internalEmail, 400, 'Email interno descartado');

  const incompleteResponse = await api('/api/customers', adminCookie, {
    method: 'POST',
    body: JSON.stringify({
      ...payload,
      documentNumber: incompleteDocumentNumber,
      documentType: '22',
      displayName: '',
      email: null,
      phone: null,
      country: null,
      region: null,
      cityCode: null,
      addressLine1: 'No aplica',
      fiscalResponsibilities: [],
    }),
  });
  expectStatus(incompleteResponse, 201, 'Cliente local incompleto');
  const incompleteCustomer = (await incompleteResponse.json()) as {
    id: number;
    displayName: string;
    email: string | null;
    country: string | null;
    addressLine1: string | null;
    fiscalResponsibilities: string[];
  };
  customerIds.push(incompleteCustomer.id);
  if (
    incompleteCustomer.displayName !== 'Marcos Castillo' ||
    incompleteCustomer.email !== null ||
    incompleteCustomer.country !== null ||
    incompleteCustomer.addressLine1 !== null ||
    incompleteCustomer.fiscalResponsibilities.length !== 0
  ) {
    throw new Error('El CRM inventó o conservó datos inválidos en un cliente incompleto.');
  }

  const createResponse = await api('/api/customers', adminCookie, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  expectStatus(createResponse, 201, 'Creación local');
  const created = (await createResponse.json()) as {
    id: number;
    phone: string | null;
    postalCode: string | null;
    location: { cityName: string };
    integrations: Array<{
      provider: string;
      status: string;
      externalId: string | null;
      externalData: {
        username: string;
        billing: { address_1: string };
        meta_data: Array<{ id: number | null; key: string; value: string }>;
      } | null;
    }>;
  };
  customerIds.push(created.id);

  const localResolveResponse = await api(
    `/api/customers/resolve?identification=${documentNumber}&documentType=13`,
    adminCookie,
  );
  expectStatus(localResolveResponse, 200, 'Resolución de cliente local existente');
  const localResolve = (await localResolveResponse.json()) as {
    existsLocally: boolean;
    customerId?: number;
  };
  if (!localResolve.existsLocally || localResolve.customerId !== created.id) {
    throw new Error('La resolución no detuvo el flujo al encontrar el cliente local.');
  }
  const seratusIntegration = created.integrations.find(
    (integration) => integration.provider === 'SERATUS',
  );
  const seratusDocumentType = seratusIntegration?.externalData?.meta_data.find(
    ({ key }) => key === 'billing_type_document',
  );
  if (
    created.location.cityName !== 'Medellín' ||
    created.integrations.length !== 3 ||
    created.integrations.some((integration) => integration.status !== 'PENDING') ||
    created.integrations.filter((integration) => integration.externalId !== null).length !== 3 ||
    seratusIntegration?.externalData?.username !== documentNumber ||
    seratusIntegration.externalData.billing.address_1 !== 'Cra. 18 #79A - 42' ||
    seratusDocumentType?.id !== 316 ||
    seratusDocumentType.value !== 'Documento Extranjero' ||
    created.phone !== '+573006003345' ||
    created.postalCode !== null ||
    siigoCreateCalls !== 0 ||
    wooCreateCalls !== 0
  ) {
    throw new Error(
      'El alta local intentó crear clientes externos o no conservó el vínculo de Siigo.',
    );
  }

  const duplicate = await api('/api/customers', adminCookie, {
    method: 'POST',
    body: JSON.stringify({ ...payload, email: `other-${runId}@example.invalid` }),
  });
  expectStatus(duplicate, 409, 'Documento duplicado');

  const listResponse = await api(
    `/api/customers?search=${encodeURIComponent(runId)}&country=CO&page=1&pageSize=1&sort=displayName&order=asc`,
    commercialCookie,
  );
  expectStatus(listResponse, 200, 'Búsqueda, filtro y orden');
  const list = (await listResponse.json()) as {
    data: Array<{ id: number }>;
    pagination: { total: number; pageSize: number };
  };
  if (
    list.pagination.total !== 1 ||
    list.pagination.pageSize !== 1 ||
    list.data[0]?.id !== created.id
  ) {
    throw new Error('El listado no respetó búsqueda por ciudad, filtro o paginación.');
  }

  await prisma.customerIntegration.update({
    where: { customerId_provider: { customerId: created.id, provider: 'SIIGO' } },
    data: {
      status: 'ERROR',
      lastErrorCode: 'INTEGRATION_REQUEST_FAILED',
      lastErrorMessage: "The city doesn't exist: Us|05|08811",
    },
  });
  const commercialDetailResponse = await api(`/api/customers/${created.id}`, commercialCookie);
  expectStatus(commercialDetailResponse, 200, 'Detalle comercial');
  const commercialDetail = (await commercialDetailResponse.json()) as {
    integrations: Array<{
      provider: string;
      lastErrorCode: string | null;
      lastErrorMessage: string | null;
    }>;
  };
  const commercialSiigo = commercialDetail.integrations.find(
    ({ provider }) => provider === 'SIIGO',
  );
  if (commercialSiigo?.lastErrorCode !== null || commercialSiigo.lastErrorMessage !== null) {
    throw new Error('El detalle comercial expuso el diagnóstico técnico de la integración.');
  }
  const adminDetailResponse = await api(`/api/customers/${created.id}`, adminCookie);
  expectStatus(adminDetailResponse, 200, 'Detalle administrativo');
  const adminDetail = (await adminDetailResponse.json()) as typeof commercialDetail;
  const adminSiigo = adminDetail.integrations.find(({ provider }) => provider === 'SIIGO');
  if (
    adminSiigo?.lastErrorCode !== 'INTEGRATION_REQUEST_FAILED' ||
    adminSiigo.lastErrorMessage !== "The city doesn't exist: Us|05|08811"
  ) {
    throw new Error('El detalle administrativo ocultó el diagnóstico técnico de la integración.');
  }
  expectStatus(
    await api(`/api/customers/${created.id}`, commercialCookie, {
      method: 'PATCH',
      body: JSON.stringify({ phone: '+573001112233' }),
    }),
    200,
    'Edición comercial',
  );
  expectStatus(
    await api(`/api/customers/${created.id}`, adminCookie, {
      method: 'PATCH',
      body: JSON.stringify({ documentNumber: `${documentNumber}9` }),
    }),
    400,
    'Cambio de documento bloqueado',
  );

  const updateResponse = await api(`/api/customers/${created.id}`, adminCookie, {
    method: 'PATCH',
    body: JSON.stringify({
      documentType: '22',
      phone: '+573001112233',
      firstName: 'MARCOS ANDRÉS',
      lastName: 'CASTILLO GÓMEZ',
      displayName: 'MARCOS ANDRÉS CASTILLO GÓMEZ',
    }),
  });
  expectStatus(updateResponse, 200, 'Edición local');
  const updated = (await updateResponse.json()) as {
    firstName: string | null;
    lastName: string | null;
    displayName: string;
    documentType: string;
    checkDigit: string | null;
    phone: string;
    integrations: Array<{ status: string }>;
  };
  if (
    updated.firstName !== 'Marcos Andrés' ||
    updated.lastName !== 'Castillo Gómez' ||
    updated.displayName !== 'Marcos Andrés Castillo Gómez' ||
    updated.phone !== '+573001112233' ||
    updated.documentType !== '22' ||
    updated.checkDigit !== null ||
    updated.integrations.filter((integration) => integration.status === 'PENDING').length !== 3 ||
    siigoUpdateCalls !== 0 ||
    wooUpdateCalls !== 0
  ) {
    throw new Error('La edición local modificó una integración externa o no la dejó pendiente.');
  }

  expectStatus(
    await api(`/api/customers/${created.id}/sync`, commercialCookie, {
      method: 'POST',
      body: JSON.stringify({ provider: 'PALI' }),
    }),
    201,
    'Reintento comercial',
  );
  expectStatus(
    await api(`/api/customers/${created.id}/sync`, adminCookie, {
      method: 'POST',
      body: JSON.stringify({ provider: 'PALI' }),
    }),
    201,
    'Reintento administrativo específico',
  );
  expectStatus(
    await api(`/api/customers/${created.id}/sync`, adminCookie, { method: 'POST' }),
    201,
    'Reintento sin provider y sin body',
  );
  const createCustomerRetrySummary = notifications.createCustomerRetrySummary.bind(notifications);
  notifications.createCustomerRetrySummary = () =>
    Promise.reject(new Error('Fallo interno simulado del sistema de notificaciones.'));
  expectStatus(
    await api(`/api/customers/${created.id}/sync`, adminCookie, {
      method: 'POST',
      body: JSON.stringify({ provider: 'SERATUS' }),
    }),
    201,
    'Sincronización aislada de un fallo de notificaciones',
  );
  notifications.createCustomerRetrySummary = createCustomerRetrySummary;
  await prisma.customer.update({
    where: { id: created.id },
    data: {
      personType: 'COMPANY',
      company: updated.displayName,
      documentType: '31',
      checkDigit: null,
    },
  });
  const companySyncResponse = await api(`/api/customers/${created.id}/sync`, adminCookie, {
    method: 'POST',
    body: JSON.stringify({ provider: 'SIIGO' }),
  });
  expectStatus(companySyncResponse, 201, 'Dígito de verificación devuelto por Siigo');
  const companySynchronized = (await companySyncResponse.json()) as { checkDigit: string | null };
  if (companySynchronized.checkDigit !== '7') {
    throw new Error('El CRM no guardó el dígito de verificación devuelto por Siigo.');
  }
  expectStatus(
    await api(`/api/customers/${created.id}/sync`, adminCookie, {
      method: 'POST',
      body: JSON.stringify({ provider: 'UNKNOWN' }),
    }),
    400,
    'Provider de reintento inválido',
  );

  expectStatus(await api('/api/customers/not-a-number', adminCookie), 400, 'ID inválido');
  expectStatus(await api('/api/customers/2147483647', adminCookie), 404, 'Cliente inexistente');

  expectStatus(
    await api(`/api/customers/${created.id}`, commercialCookie, { method: 'DELETE' }),
    403,
    'Eliminación comercial',
  );
  const wooCreatesBeforeDelete = wooCreateCalls;
  const siigoCreatesBeforeDelete = siigoCreateCalls;
  expectStatus(
    await api(`/api/customers/${created.id}`, adminCookie, { method: 'DELETE' }),
    200,
    'Eliminación local administrativa',
  );
  if (wooCreateCalls !== wooCreatesBeforeDelete || siigoCreateCalls !== siigoCreatesBeforeDelete) {
    throw new Error('La eliminación local intentó modificar una integración externa.');
  }
  expectStatus(
    await api(`/api/customers/${created.id}`, adminCookie),
    404,
    'Detalle después de eliminar',
  );

  const recreateResponse = await api('/api/customers', adminCookie, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
  expectStatus(recreateResponse, 201, 'Recreación del mismo documento');
  const recreated = (await recreateResponse.json()) as { id: number };
  customerIds.push(recreated.id);

  const associatedOperation = await prisma.orderOperation.create({
    data: {
      operationCode: `OP${Date.now()}TST`,
      source: OrderSource.CRM,
      status: OperationStatus.PENDING,
      customerId: recreated.id,
      currency: 'COP',
      subtotal: 0,
      discountTotal: 0,
      shippingTotal: 0,
      total: 0,
    },
  });
  expectStatus(
    await api(`/api/customers/${recreated.id}`, adminCookie, { method: 'DELETE' }),
    409,
    'Cliente con operación válida',
  );
  await prisma.orderOperation.update({
    where: { id: associatedOperation.id },
    data: { deletedAt: new Date() },
  });
  expectStatus(
    await api(`/api/customers/${recreated.id}`, adminCookie, { method: 'DELETE' }),
    200,
    'Cliente con únicamente operación eliminada heredada',
  );
  const [removedCustomer, removedOperation, remainingIntegrations] = await Promise.all([
    prisma.customer.findUnique({ where: { id: recreated.id } }),
    prisma.orderOperation.findUnique({ where: { id: associatedOperation.id } }),
    prisma.customerIntegration.count({ where: { customerId: recreated.id } }),
  ]);
  if (removedCustomer !== null || removedOperation !== null || remainingIntegrations !== 0) {
    throw new Error('La eliminación física no limpió el cliente y sus registros asociados.');
  }

  process.stdout.write(
    'Customers smoke: safe Siigo lookup, physical deletion, valid-operation protection, legacy cleanup, same-document recreation, RBAC, duplicates, geography, search, pagination, detail, update and notification isolation checks passed.\n',
  );
} finally {
  if (customerIds.length > 0) {
    await prisma.notification.deleteMany({ where: { customerId: { in: customerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: customerIds } } });
  }
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await app.close();
}
