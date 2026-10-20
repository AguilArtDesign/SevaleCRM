import '../apps/api/src/config/load-environment.js';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword } from 'better-auth/crypto';
import { AppModule } from '../apps/api/src/app.module.js';
import { SiigoCustomerService } from '../apps/api/src/customers/integrations/siigo-customer.service.js';
import { WooCustomerService } from '../apps/api/src/customers/integrations/woo-customer.service.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { Role } from '../apps/api/src/generated/prisma/client.js';

process.env.BETTER_AUTH_SECRET ||= 'local-prospects-smoke-secret-at-least-32-chars';

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
  logger: false,
});
app.setGlobalPrefix('api');
app.enableCors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
});
await app.listen(0, '127.0.0.1');

const prisma = app.get(PrismaService);
const origin = process.env.FRONTEND_URL || 'http://localhost:5173';
const baseUrl = await app.getUrl();
const runId = randomUUID();
const password = `P-${randomUUID()}-9a!`;

// La conversión reutiliza `CustomersService`, que consulta Siigo y WooCommerce. En la prueba ambas
// se sustituyen para que el smoke no dependa de servicios externos.
const siigoCustomers = app.get(SiigoCustomerService);
siigoCustomers.lookupCustomer = () => Promise.resolve(null);
const wooCustomers = app.get(WooCustomerService);
wooCustomers.findCustomerByDocument = () => Promise.resolve({ status: 'NOT_FOUND' } as const);

const adminId = randomUUID();
const commercialId = randomUUID();
const logisticsId = randomUUID();
const createdUserIds = [adminId, commercialId, logisticsId];
const createdProspectIds: number[] = [];
const createdTagIds: number[] = [];
const createdCustomerIds: number[] = [];
const createdAgreementIds: number[] = [];

const documentNumber = `${Date.now()}`.slice(-10);
const companyName = `Convenio Prospectos ${runId.slice(0, 8)}`;
const customerDocumentNumber = `${documentNumber}1`;

type ProspectBody = {
  id: number;
  personType: 'PERSON' | 'COMPANY' | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  company: string | null;
  documentNumber: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  region: string | null;
  cityCode: string | null;
  cityName: string | null;
  status: 'NEW' | 'IN_PROGRESS' | 'QUALIFIED' | 'CONVERTED' | 'LOST';
  source: 'MANUAL' | 'WHATSAPP' | 'WEB' | 'REFERRAL' | 'OTHER';
  notes: string | null;
  agreement: { id: number; companyName: string; active: boolean } | null;
  assignedUser: { id: string; name: string } | null;
  createdBy: { id: string; name: string } | null;
  convertedCustomer: { id: number; displayName: string } | null;
  convertedAt: string | null;
  tags: Array<{ id: number; name: string; active: boolean }>;
  completeness: { complete: boolean; missing: string[] };
  location: { countryName: string | null; regionName: string | null; cityName: string | null };
};

type TagBody = { id: number; name: string; active: boolean };

type PageBody = {
  data: ProspectBody[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

async function expectStatus(response: Response, status: number, context: string) {
  if (response.status !== status) {
    const detail = await response
      .clone()
      .text()
      .catch(() => '');
    throw new Error(
      `${context}: se esperaba ${status} y se recibió ${response.status}. ${detail.slice(0, 400)}`,
    );
  }
}

async function api(path: string, cookie?: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      origin,
      ...(cookie ? { cookie } : {}),
      ...init?.headers,
    },
  });
}

async function json<T>(response: Response, context: string, status = 200): Promise<T> {
  await expectStatus(response, status, context);
  return (await response.json()) as T;
}

async function expectError(response: Response, status: number, code: string, context: string) {
  await expectStatus(response, status, context);
  const body = (await response.json()) as { error?: { code?: string } };
  if (body.error?.code !== code) {
    throw new Error(`${context}: se esperaba el código ${code} y llegó ${body.error?.code}.`);
  }
}

async function login(email: string): Promise<string> {
  const response = await api('/api/auth/sign-in/email', undefined, {
    method: 'POST',
    headers: { 'x-captcha-response': 'XXXX.DUMMY.TOKEN.XXXX' },
    body: JSON.stringify({ email, password }),
  });
  await expectStatus(response, 200, `Inicio de sesión de ${email}`);
  const cookie = response.headers.getSetCookie()[0]?.split(';')[0];
  if (!cookie) throw new Error('Better Auth no creó la cookie de sesión.');
  return cookie;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

try {
  const passwordHash = await hashPassword(password);
  const users = [
    { id: adminId, role: Role.ADMIN, label: 'admin' },
    { id: commercialId, role: Role.COMMERCIAL, label: 'commercial' },
    { id: logisticsId, role: Role.LOGISTICS, label: 'logistics' },
  ];
  for (const user of users) {
    await prisma.user.create({
      data: {
        id: user.id,
        name: `Prospects Smoke ${user.label}`,
        email: `prospects-${user.label}-${runId}@example.invalid`,
        emailVerified: true,
        role: user.role,
        active: true,
        accounts: {
          create: {
            id: randomUUID(),
            accountId: user.id,
            providerId: 'credential',
            issuer: 'local:credential',
            password: passwordHash,
          },
        },
      },
    });
  }

  const agreement = await prisma.agreement.create({ data: { companyName } });
  createdAgreementIds.push(agreement.id);

  // --- Autenticación y RBAC ---------------------------------------------------------------
  await expectStatus(await api('/api/prospects'), 401, 'Listado anónimo');
  const adminCookie = await login(`prospects-admin-${runId}@example.invalid`);
  const commercialCookie = await login(`prospects-commercial-${runId}@example.invalid`);
  const logisticsCookie = await login(`prospects-logistics-${runId}@example.invalid`);
  await expectStatus(await api('/api/prospects', logisticsCookie), 403, 'Listado como logística');
  await expectStatus(
    await api('/api/tags', logisticsCookie),
    403,
    'Listado de etiquetas como logística',
  );

  // --- Alta mínima: solo teléfono ----------------------------------------------------------
  const minimal = await json<ProspectBody>(
    await api('/api/prospects', commercialCookie, {
      method: 'POST',
      body: JSON.stringify({ phone: '3001112233', country: 'CO' }),
    }),
    'Alta con solo teléfono',
    201,
  );
  createdProspectIds.push(minimal.id);
  assert(minimal.phone === '+573001112233', 'El teléfono no se normalizó a E.164.');
  assert(minimal.displayName === '+573001112233', 'displayName no cayó al teléfono.');
  assert(minimal.status === 'NEW', 'El estado inicial no es NEW.');
  assert(minimal.source === 'MANUAL', 'El origen por defecto no es MANUAL.');
  assert(minimal.createdBy?.id === commercialId, 'No se registró al comercial como creador.');
  assert(!minimal.completeness.complete, 'Un prospecto con solo teléfono no puede estar completo.');
  assert(
    minimal.completeness.missing.includes('firstName'),
    'La lista de datos faltantes no menciona el nombre.',
  );

  // --- Rechazo del formulario vacío -------------------------------------------------------
  await expectError(
    await api('/api/prospects', commercialCookie, {
      method: 'POST',
      body: JSON.stringify({ notes: 'sin datos', status: 'NEW', source: 'MANUAL' }),
    }),
    400,
    'VALIDATION_ERROR',
    'Alta sin ningún dato identificable',
  );

  // --- Etiquetas ---------------------------------------------------------------------------
  const tagName = `MAYORISTA ${runId.slice(0, 6)}`;
  const tag = await json<TagBody>(
    await api('/api/tags', adminCookie, {
      method: 'POST',
      body: JSON.stringify({ name: tagName }),
    }),
    'Alta de etiqueta',
    201,
  );
  createdTagIds.push(tag.id);
  const secondTag = await json<TagBody>(
    await api('/api/tags', adminCookie, {
      method: 'POST',
      body: JSON.stringify({ name: `${tagName} VIP` }),
    }),
    'Alta de segunda etiqueta',
    201,
  );
  createdTagIds.push(secondTag.id);
  await expectError(
    await api('/api/tags', adminCookie, {
      method: 'POST',
      body: JSON.stringify({ name: tagName.toLocaleLowerCase('es-CO') }),
    }),
    409,
    'TAG_NAME_TAKEN',
    'Etiqueta duplicada ignorando mayúsculas',
  );
  await expectStatus(
    await api('/api/tags', commercialCookie, {
      method: 'POST',
      body: JSON.stringify({ name: `${tagName} comercial` }),
    }),
    403,
    'Alta de etiqueta como comercial',
  );
  const listedTags = await json<TagBody[]>(await api('/api/tags', commercialCookie), 'Etiquetas');
  assert(
    listedTags.some((item) => item.id === tag.id),
    'El comercial necesita leer las etiquetas para asignarlas.',
  );

  // --- Alta completa -----------------------------------------------------------------------
  const full = await json<ProspectBody>(
    await api('/api/prospects', commercialCookie, {
      method: 'POST',
      body: JSON.stringify({
        personType: 'COMPANY',
        firstName: '  Ana ',
        lastName: 'Pérez',
        company: '  Comercializadora Smoke SAS ',
        documentType: '31',
        documentNumber: `${documentNumber}2`,
        checkDigit: '7',
        email: 'ANA.PEREZ@Example.INVALID',
        phone: '3004445566',
        country: 'CO',
        region: 'CO-ANT',
        cityCode: '05001',
        postalCode: '050001',
        addressLine1: 'Carrera 43A #1-50',
        addressLine2: 'Torre Sur',
        agreementId: agreement.id,
        assignedUserId: commercialId,
        status: 'QUALIFIED',
        notes: 'Prospecto de prueba',
        tagIds: [tag.id, secondTag.id],
      }),
    }),
    'Alta completa',
    201,
  );
  createdProspectIds.push(full.id);
  assert(full.displayName === 'Ana Pérez', `displayName inesperado: ${full.displayName}.`);
  assert(full.firstName === 'Ana', 'El nombre no se recortó.');
  assert(full.company === 'Comercializadora Smoke SAS', 'La empresa no se recortó.');
  assert(full.email === 'ana.perez@example.invalid', 'El correo no se normalizó.');
  assert(full.phone === '+573004445566', 'El teléfono no se normalizó.');
  assert(full.location.regionName === 'Antioquia', 'No se resolvió el departamento.');
  assert(full.location.cityName === 'Medellín', 'No se resolvió la ciudad.');
  assert(full.agreement?.id === agreement.id, 'No se guardó el convenio.');
  assert(full.assignedUser?.id === commercialId, 'No se guardó el comercial asignado.');
  assert(full.tags.length === 2, 'No se guardaron las dos etiquetas.');
  assert(full.completeness.complete, 'El prospecto completo reportó datos faltantes.');

  // --- Validaciones de ubicación y contacto ------------------------------------------------
  await expectError(
    await api('/api/prospects', commercialCookie, {
      method: 'POST',
      body: JSON.stringify({ firstName: 'Sin región', cityCode: '05001' }),
    }),
    400,
    'PROSPECT_COUNTRY_REQUIRED',
    'Ciudad sin país',
  );
  await expectError(
    await api('/api/prospects', commercialCookie, {
      method: 'POST',
      body: JSON.stringify({ firstName: 'País raro', country: 'ZZ' }),
    }),
    400,
    'PROSPECT_COUNTRY_INVALID',
    'País inexistente',
  );
  await expectError(
    await api('/api/prospects', commercialCookie, {
      method: 'POST',
      body: JSON.stringify({ firstName: 'Internacional', country: 'PA', cityCode: '05001' }),
    }),
    400,
    'PROSPECT_CITY_INVALID',
    'Ciudad con código fuera de Colombia',
  );
  await expectError(
    await api('/api/prospects', commercialCookie, {
      method: 'POST',
      body: JSON.stringify({ firstName: 'Correo', email: 'no-es-correo' }),
    }),
    400,
    'VALIDATION_ERROR',
    'Correo con formato inválido',
  );
  await expectError(
    await api('/api/prospects', commercialCookie, {
      method: 'POST',
      body: JSON.stringify({ firstName: 'Correo', email: 'ana@seratus.com.co' }),
    }),
    400,
    'PROSPECT_EMAIL_INVALID',
    'Correo de dominio interno',
  );
  await expectError(
    await api('/api/prospects', commercialCookie, {
      method: 'POST',
      body: JSON.stringify({ firstName: 'Comercial', assignedUserId: randomUUID() }),
    }),
    400,
    'PROSPECT_ASSIGNEE_NOT_FOUND',
    'Comercial inexistente',
  );
  await expectError(
    await api('/api/prospects', commercialCookie, {
      method: 'POST',
      body: JSON.stringify({ firstName: 'Convenio', agreementId: 999_999_999 }),
    }),
    400,
    'PROSPECT_AGREEMENT_NOT_FOUND',
    'Convenio inexistente',
  );
  await expectError(
    await api('/api/prospects', commercialCookie, {
      method: 'POST',
      body: JSON.stringify({ firstName: 'Etiqueta', tagIds: [999_999_999] }),
    }),
    400,
    'PROSPECT_TAG_NOT_FOUND',
    'Etiqueta inexistente',
  );

  // --- Prospecto internacional --------------------------------------------------------------
  const international = await json<ProspectBody>(
    await api('/api/prospects', commercialCookie, {
      method: 'POST',
      body: JSON.stringify({
        firstName: 'John',
        lastName: 'Smith',
        country: 'PA',
        region: 'PA-8',
        cityName: 'Ciudad de Panamá',
      }),
    }),
    'Alta internacional',
    201,
  );
  createdProspectIds.push(international.id);
  assert(international.cityCode === null, 'El prospecto internacional guardó código de ciudad.');
  assert(international.location.cityName === 'Ciudad de Panamá', 'No se conservó la ciudad libre.');
  assert(
    international.completeness.missing.includes('cityCode') === false,
    'La ciudad internacional marcó cityCode como faltante.',
  );

  // --- Edición: estado, asignación, etiquetas y recálculo de displayName --------------------
  const updated = await json<ProspectBody>(
    await api(`/api/prospects/${full.id}`, commercialCookie, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'IN_PROGRESS', assignedUserId: null, tagIds: [secondTag.id] }),
    }),
    'Edición parcial',
  );
  assert(updated.status === 'IN_PROGRESS', 'El cambio de estado no se aplicó.');
  assert(updated.assignedUser === null, 'No se pudo dejar el prospecto sin comercial.');
  assert(updated.tags.length === 1, 'Las etiquetas no se reemplazaron por el conjunto enviado.');
  assert(updated.displayName === 'Ana Pérez', 'displayName cambió sin cambiar los datos base.');

  const renamed = await json<ProspectBody>(
    await api(`/api/prospects/${full.id}`, commercialCookie, {
      method: 'PATCH',
      body: JSON.stringify({ firstName: 'Ana María', lastName: null, company: null }),
    }),
    'Edición del nombre',
  );
  assert(renamed.displayName === 'Ana María', 'displayName no se recalculó.');
  assert(renamed.completeness.missing.includes('lastName'), 'No se detectó el apellido faltante.');

  // Sin datos base el prospecto debe volver a su respaldo: empresa, teléfono, correo o documento.
  // Se prueba al final del bloque de búsqueda para no borrar el nombre antes de buscarlo.

  await expectError(
    await api(`/api/prospects/${full.id}`, commercialCookie, {
      method: 'PATCH',
      body: JSON.stringify({ country: null }),
    }),
    400,
    'PROSPECT_COUNTRY_REQUIRED',
    'Quitar el país conservando la ciudad',
  );
  await expectError(
    await api(`/api/prospects/${full.id}`, commercialCookie, {
      method: 'PATCH',
      body: JSON.stringify({}),
    }),
    400,
    'VALIDATION_ERROR',
    'PATCH vacío',
  );

  // --- Búsqueda, filtros y paginación -------------------------------------------------------
  const byName = await json<PageBody>(
    await api('/api/prospects?search=Ana%20Mar%C3%ADa', adminCookie),
    'Búsqueda por nombre',
  );
  assert(
    byName.data.some((item) => item.id === full.id),
    'La búsqueda por nombre no encontró el prospecto.',
  );
  const byPhone = await json<PageBody>(
    await api('/api/prospects?search=3001112233', adminCookie),
    'Búsqueda por teléfono',
  );
  assert(
    byPhone.data.some((item) => item.id === minimal.id),
    'La búsqueda por teléfono no encontró el prospecto.',
  );
  const byEmail = await json<PageBody>(
    await api('/api/prospects?search=ana.perez', adminCookie),
    'Búsqueda por correo',
  );
  assert(
    byEmail.data.some((item) => item.id === full.id),
    'La búsqueda por correo no encontró el prospecto.',
  );
  const byDocument = await json<PageBody>(
    await api(`/api/prospects?search=${documentNumber}2`, adminCookie),
    'Búsqueda por documento',
  );
  assert(
    byDocument.data.some((item) => item.id === full.id),
    'La búsqueda por documento no encontró el prospecto.',
  );
  const unassigned = await json<PageBody>(
    await api('/api/prospects?unassigned=true', adminCookie),
    'Filtro sin asignar',
  );
  assert(
    unassigned.data.some((item) => item.id === full.id),
    'El filtro de sin asignar no devolvió el prospecto.',
  );
  const byAgreement = await json<PageBody>(
    await api(`/api/prospects?agreementId=${agreement.id}`, adminCookie),
    'Filtro por convenio',
  );
  assert(
    byAgreement.data.some((item) => item.id === full.id),
    'El filtro por convenio no devolvió el prospecto.',
  );
  const byTag = await json<PageBody>(
    await api(`/api/prospects?tagId=${secondTag.id}`, adminCookie),
    'Filtro por etiqueta',
  );
  assert(
    byTag.data.some((item) => item.id === full.id),
    'El filtro por etiqueta no devolvió el prospecto.',
  );
  const byStatus = await json<PageBody>(
    await api('/api/prospects?status=QUALIFIED', adminCookie),
    'Filtro por estado',
  );
  assert(
    byStatus.data.every((item) => item.status === 'QUALIFIED'),
    'El filtro por estado devolvió otros estados.',
  );
  const paged = await json<PageBody>(
    await api('/api/prospects?page=1&pageSize=1', adminCookie),
    'Paginación',
  );
  assert(paged.data.length === 1, 'La paginación no respetó pageSize.');
  assert(paged.pagination.totalPages >= 2, 'La paginación no calculó las páginas totales.');

  // El respaldo de `displayName` se comprueba al final para no borrar el nombre antes de buscarlo.
  const fallback = await json<ProspectBody>(
    await api(`/api/prospects/${full.id}`, commercialCookie, {
      method: 'PATCH',
      body: JSON.stringify({ firstName: null, company: 'Comercializadora Smoke SAS' }),
    }),
    'Edición con respaldo de empresa',
  );
  assert(
    fallback.displayName === 'Comercializadora Smoke SAS',
    'displayName no cayó a la empresa.',
  );

  // --- Conversión: rechazo cuando el cuerpo está incompleto --------------------------------
  await expectError(
    await api(`/api/prospects/${minimal.id}/convert`, commercialCookie, {
      method: 'POST',
      body: JSON.stringify({ personType: 'PERSON', documentType: '13', documentNumber: '123' }),
    }),
    400,
    'VALIDATION_ERROR',
    'Conversión sin los datos que exige Clientes',
  );
  // El cuerpo puede ser válido para Clientes y aun así no servir: un prospecto solo pasa a cliente
  // cuando la ficha está completa.
  await expectError(
    await api(`/api/prospects/${minimal.id}/convert`, commercialCookie, {
      method: 'POST',
      body: JSON.stringify({
        personType: 'PERSON',
        firstName: 'Solo',
        lastName: 'Teléfono',
        displayName: '',
        documentType: '13',
        documentNumber: `${customerDocumentNumber}8`,
        email: `incompleto.${runId.slice(0, 6)}@example.invalid`,
        phone: '+573001112233',
        country: 'CO',
        region: null,
        cityCode: null,
        cityName: null,
        postalCode: null,
        addressLine1: null,
        addressLine2: null,
        vatResponsible: false,
        fiscalResponsibilities: ['R-99-PN'],
      }),
    }),
    400,
    'PROSPECT_INCOMPLETE',
    'Conversión con ficha incompleta',
  );

  // --- Conversión a cliente nuevo -----------------------------------------------------------
  // Mismo contrato que `POST /customers`. Ojo: `createCustomerSchema` exige las claves `email` y
  // `country` (admiten null) porque en Clientes no llevan `.optional()`.
  const conversionPayload = {
    personType: 'PERSON',
    firstName: 'Ana María',
    lastName: 'Pérez',
    // El formulario de Clientes envía `displayName` vacío y el backend lo deriva; se replica aquí
    // para probar el mismo contrato.
    displayName: '',
    documentType: '13',
    documentNumber: customerDocumentNumber,
    email: `ana.convertida.${runId.slice(0, 6)}@example.invalid`,
    phone: '+573004445566',
    country: 'CO',
    region: 'CO-ANT',
    cityCode: '05001',
    postalCode: '050001',
    addressLine1: 'Carrera 43A #1-50',
    addressLine2: 'Torre Sur',
    vatResponsible: false,
    fiscalResponsibilities: ['R-99-PN'],
  };
  const converted = await json<{
    prospect: ProspectBody;
    customer: {
      id: number;
      displayName: string;
      integrations: Array<{ provider: string }>;
    };
  }>(
    await api(`/api/prospects/${full.id}/convert`, commercialCookie, {
      method: 'POST',
      body: JSON.stringify(conversionPayload),
    }),
    'Conversión a cliente',
    201,
  );
  createdCustomerIds.push(converted.customer.id);
  assert(converted.prospect.status === 'CONVERTED', 'El prospecto no quedó en CONVERTED.');
  assert(
    converted.prospect.convertedCustomer?.id === converted.customer.id,
    'No se guardó el cliente convertido.',
  );
  assert(Boolean(converted.prospect.convertedAt), 'No se guardó la fecha de conversión.');
  assert(
    converted.customer.displayName === 'Ana María Pérez',
    'El cliente no se creó con su nombre.',
  );
  // El convenio se queda en el prospecto histórico: Clientes no lo recibe en esta fase.
  assert(
    converted.prospect.agreement?.id === agreement.id,
    'La conversión perdió el convenio del prospecto.',
  );
  // El prospecto no crea integraciones: el cliente recibe las tres estándar del flujo de Clientes.
  assert(
    converted.customer.integrations.length === 3,
    'El cliente convertido no recibió las integraciones estándar de Clientes.',
  );

  const defaultList = await json<PageBody>(await api('/api/prospects', adminCookie), 'Listado');
  assert(
    !defaultList.data.some((item) => item.id === full.id),
    'El prospecto convertido sigue apareciendo en el listado normal.',
  );
  const convertedFilter = await json<PageBody>(
    await api('/api/prospects?status=CONVERTED', adminCookie),
    'Filtro de convertidos',
  );
  assert(
    convertedFilter.data.some((item) => item.id === full.id),
    'El filtro de convertidos no devolvió el prospecto convertido.',
  );

  await expectError(
    await api(`/api/prospects/${full.id}/convert`, commercialCookie, {
      method: 'POST',
      body: JSON.stringify({
        ...conversionPayload,
        documentNumber: `${customerDocumentNumber}9`,
      }),
    }),
    409,
    'PROSPECT_ALREADY_CONVERTED',
    'Segunda conversión',
  );
  await expectError(
    await api(`/api/prospects/${full.id}`, commercialCookie, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'NEW' }),
    }),
    409,
    'PROSPECT_ALREADY_CONVERTED',
    'Edición de un convertido',
  );
  await expectError(
    await api(`/api/prospects/${full.id}`, adminCookie, { method: 'DELETE' }),
    409,
    'PROSPECT_ALREADY_CONVERTED',
    'Borrado de un convertido',
  );

  // --- Vincular a un cliente existente ------------------------------------------------------
  const linked = await json<{ prospect: ProspectBody; customer: { id: number } }>(
    await api(`/api/prospects/${international.id}/convert/link`, commercialCookie, {
      method: 'POST',
      body: JSON.stringify({ customerId: converted.customer.id }),
    }),
    'Vinculación a cliente existente',
    201,
  );
  assert(
    linked.prospect.status === 'CONVERTED' &&
      linked.prospect.convertedCustomer?.id === converted.customer.id,
    'La vinculación no marcó el prospecto como convertido.',
  );
  await expectError(
    await api(`/api/prospects/${minimal.id}/convert/link`, commercialCookie, {
      method: 'POST',
      body: JSON.stringify({ customerId: 999_999_999 }),
    }),
    404,
    'CUSTOMER_NOT_FOUND',
    'Vinculación a un cliente inexistente',
  );

  // --- Borrado físico: solo ADMIN y solo si no está convertido ------------------------------
  await expectStatus(
    await api(`/api/prospects/${minimal.id}`, commercialCookie, { method: 'DELETE' }),
    403,
    'Borrado como comercial',
  );
  const deleted = await json<ProspectBody>(
    await api(`/api/prospects/${minimal.id}`, adminCookie, { method: 'DELETE' }),
    'Borrado como administrador',
  );
  createdProspectIds.splice(createdProspectIds.indexOf(minimal.id), 1);
  assert(deleted.id === minimal.id, 'El borrado no devolvió el prospecto eliminado.');
  await expectStatus(
    await api(`/api/prospects/${minimal.id}`, adminCookie),
    404,
    'Consulta del prospecto borrado',
  );
  await expectError(
    await api(`/api/prospects/${minimal.id}`, adminCookie, { method: 'DELETE' }),
    404,
    'PROSPECT_NOT_FOUND',
    'Borrado repetido',
  );

  // --- Supervivencia del prospecto al borrar al comercial asignado -------------------------
  const orphanCandidate = await json<ProspectBody>(
    await api('/api/prospects', adminCookie, {
      method: 'POST',
      body: JSON.stringify({ firstName: 'Huérfano', assignedUserId: commercialId }),
    }),
    'Alta para probar el borrado del comercial',
    201,
  );
  createdProspectIds.push(orphanCandidate.id);
  await prisma.user.delete({ where: { id: commercialId } });
  createdUserIds.splice(createdUserIds.indexOf(commercialId), 1);
  const survivor = await json<ProspectBody>(
    await api(`/api/prospects/${orphanCandidate.id}`, adminCookie),
    'Prospecto tras borrar al comercial',
  );
  assert(survivor.assignedUser === null, 'El prospecto no sobrevivió al borrado del comercial.');

  process.stdout.write(
    'Prospects smoke: auth, RBAC (admin/commercial/logistics), minimal and full create, empty-form rejection, phone/email normalization, displayName fallback chain, CO/international location rules, tags (unique name, admin-only writes), edit (status, unassigned, tag replacement, displayName recalculation), search, filters, pagination, conversion to new customer, link to existing customer, double-conversion guard, admin-only physical delete and survival after assignee deletion passed.\n',
  );
} finally {
  if (createdProspectIds.length) {
    await prisma.prospect.deleteMany({ where: { id: { in: createdProspectIds } } });
  }
  if (createdCustomerIds.length) {
    await prisma.notification.deleteMany({ where: { customerId: { in: createdCustomerIds } } });
    await prisma.customer.deleteMany({ where: { id: { in: createdCustomerIds } } });
  }
  if (createdTagIds.length) await prisma.tag.deleteMany({ where: { id: { in: createdTagIds } } });
  if (createdAgreementIds.length) {
    await prisma.agreement.deleteMany({ where: { id: { in: createdAgreementIds } } });
  }
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await app.close();
}
