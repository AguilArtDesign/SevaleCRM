import '../apps/api/src/config/load-environment.js';
import { ConflictException } from '@nestjs/common';
import type { CreateCustomerInput } from '../packages/validation/src/index.js';
import { CustomerLocationsService } from '../apps/api/src/customers/mapping/customer-locations.service.js';
import { WooCustomerMapper } from '../apps/api/src/customers/mapping/woo-customer.mapper.js';
import { WooCustomerService } from '../apps/api/src/customers/integrations/woo-customer.service.js';

type RecordedRequest = { url: string; init?: RequestInit };

const requests: RecordedRequest[] = [];
const customerResponse = (id: number, email = 'marcos.castillo@example.com') => ({
  id,
  email,
  first_name: 'Marcos',
  last_name: 'Castillo',
  username: '13832081',
  billing: {
    first_name: 'Marcos',
    last_name: 'Castillo',
    company: 'Ejemplo S.A.S.',
    address_1: 'Cra. 18 #79A - 42',
    address_2: 'Apto 301',
    city: 'Medellín',
    postcode: '050001',
    country: 'CO',
    state: 'CO-ANT',
    email,
    phone: '+57 300 600 3345',
  },
  shipping: { address_1: 'Este dato no debe conservarse' },
  meta_data: [
    { id: 65, key: 'billing_type_document', value: '13' },
    { id: 66, key: 'billing_identification', value: '13832081' },
    { id: 67, key: 'wc_last_active', value: '1788290866' },
  ],
});
const responses: Response[] = [
  Response.json([customerResponse(8)]),
  Response.json([customerResponse(21)]),
  Response.json([customerResponse(21)]),
  Response.json([]),
  Response.json([]),
  Response.json(customerResponse(31), { status: 201 }),
  Response.json(customerResponse(41), { status: 201 }),
  Response.json([customerResponse(31)]),
  Response.json([customerResponse(31)]),
  Response.json(customerResponse(31)),
  Response.json([customerResponse(41)]),
  Response.json([customerResponse(41)]),
  Response.json(customerResponse(41)),
  Response.json([]),
  Response.json([customerResponse(31)]),
  Response.json(customerResponse(31, 'marcos.nuevo@example.com')),
  Response.json([
    {
      id: 50,
      email: 'ocupado@example.com',
      username: 'otro-documento',
    },
  ]),
  Response.json([customerResponse(41)]),
  Response.json([
    {
      id: 50,
      email: 'marcos.castillo@example.com',
      username: 'otro-documento',
    },
  ]),
  Response.json([]),
];

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function requestBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== 'string') throw new Error('La petición no incluyó un body JSON válido.');
  return JSON.parse(body) as Record<string, unknown>;
}

globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
  requests.push({ url: requestUrl(input), init });
  const response = responses.shift();
  if (!response) throw new Error('La prueba recibió una petición HTTP inesperada.');
  return Promise.resolve(response);
};

process.env.SERATUS_API_URL = 'https://seratus.test/wp-json/wc/v3';
process.env.WOOCOMMERCE_SERATUS_CK = 'seratus-key';
process.env.WOOCOMMERCE_SERATUS_CS = 'seratus-secret';
process.env.PALI_API_URL = 'https://pali.test/wp-json/wc/v3';
process.env.WOOCOMMERCE_PALI_CK = 'pali-key';
process.env.WOOCOMMERCE_PALI_CS = 'pali-secret';

const mapper = new WooCustomerMapper(new CustomerLocationsService());
const service = new WooCustomerService(mapper);
const customer: CreateCustomerInput = {
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
  addressLine2: 'Apto 301',
  vatResponsible: false,
  fiscalResponsibilities: ['R-99-PN'],
};

const existingByDocument = await service.findCustomerByDocument('SERATUS', '13832081');
if (
  existingByDocument?.id !== '8' ||
  existingByDocument.billing.city !== 'Medellín' ||
  existingByDocument.meta_data.length !== 2 ||
  'shipping' in existingByDocument
) {
  throw new Error('La búsqueda por documento no vinculó el username exacto de Seratus.');
}

const existing = await service.findCustomer('SERATUS', customer);
if (existing?.id !== '21') {
  throw new Error('El preflight no vinculó la coincidencia exacta de Seratus.');
}
if ((await service.findCustomer('PALI', customer)) !== null) {
  throw new Error('El preflight de Pali debe devolver null cuando el cliente no existe.');
}

const seratusCreated = await service.createCustomer('SERATUS', customer);
const paliCreated = await service.createCustomer('PALI', customer);
if (seratusCreated.id !== '31' || paliCreated.id !== '41') {
  throw new Error('La creación no conservó los IDs externos de ambas tiendas.');
}
if (
  (await service.updateCustomer('SERATUS', seratusCreated.id, customer)).id !== '31' ||
  (await service.updateCustomer('PALI', paliCreated.id, customer)).id !== '41'
) {
  throw new Error('La actualización no confirmó los IDs externos de ambas tiendas.');
}

const changedEmailCustomer = { ...customer, email: 'marcos.nuevo@example.com' };
const changedEmail = await service.updateCustomer('SERATUS', '31', changedEmailCustomer);
if (changedEmail.id !== '31' || changedEmail.email !== changedEmailCustomer.email) {
  throw new Error('La actualización rechazó el cambio de correo del mismo cliente externo.');
}

let updateConflictRejected = false;
try {
  await service.updateCustomer('PALI', '41', { ...customer, email: 'ocupado@example.com' });
} catch (error) {
  updateConflictRejected = error instanceof ConflictException;
}
if (!updateConflictRejected) {
  throw new Error('La actualización permitió usar el correo de otro cliente externo.');
}

let conflictRejected = false;
try {
  await service.findCustomer('PALI', customer);
} catch (error) {
  conflictRejected =
    error instanceof ConflictException &&
    (error.getResponse() as { error?: { code?: string } }).error?.code ===
      'EXTERNAL_CUSTOMER_CONFLICT';
}
if (!conflictRejected) {
  throw new Error('El preflight permitió que el mismo correo perteneciera a otro usuario.');
}

if (responses.length !== 0 || requests.length !== 20) {
  throw new Error('La cantidad de peticiones WooCommerce no coincide con el flujo esperado.');
}
const [
  seratusDocument,
  seratusEmail,
  seratusUsername,
  paliEmail,
  paliUsername,
  seratusPost,
  paliPost,
] = requests;
if (
  !seratusDocument?.url.includes('/customers?search=13832081') ||
  !seratusDocument.url.includes('role=all') ||
  !seratusEmail?.url.includes('/customers?email=marcos.castillo%40example.com') ||
  !seratusEmail.url.includes('role=all') ||
  !seratusUsername?.url.includes('/customers?search=13832081') ||
  !paliEmail?.url.startsWith('https://pali.test/') ||
  !paliUsername?.url.startsWith('https://pali.test/')
) {
  throw new Error('El preflight no consultó email y username en la tienda correcta.');
}
const seratusAuthorization = new Headers(seratusPost?.init?.headers).get('authorization');
const paliAuthorization = new Headers(paliPost?.init?.headers).get('authorization');
if (
  seratusAuthorization !==
    `Basic ${Buffer.from('seratus-key:seratus-secret').toString('base64')}` ||
  paliAuthorization !== `Basic ${Buffer.from('pali-key:pali-secret').toString('base64')}`
) {
  throw new Error('Cada tienda no utilizó sus propias credenciales WooCommerce.');
}
const payload = requestBody(seratusPost?.init?.body);
const paliPayload = requestBody(paliPost?.init?.body);
const billing = payload.billing as Record<string, unknown>;
const metadata = payload.meta_data as Array<Record<string, unknown>>;
const password = payload.password;
const paliPassword = paliPayload.password;
if (
  payload.username !== customer.documentNumber ||
  payload.email !== customer.email ||
  billing.city !== 'Medellín' ||
  billing.state !== 'CO-ANT' ||
  billing.country !== 'CO' ||
  billing.address_1 !== 'CRA. 18 #79A - 42' ||
  billing.address_2 !== 'APTO 301' ||
  metadata.find((entry) => entry.key === 'billing_type_document')?.value !== '13' ||
  metadata.find((entry) => entry.key === 'billing_identification')?.value !== '13832081' ||
  'shipping' in payload
) {
  throw new Error('WooCustomerMapper envió un payload distinto al contrato aprobado.');
}
if (
  typeof password !== 'string' ||
  password.length < 32 ||
  !/[a-z]/.test(password) ||
  !/[A-Z]/.test(password) ||
  !/\d/.test(password) ||
  !/[^A-Za-z0-9]/.test(password) ||
  typeof paliPassword !== 'string' ||
  password === paliPassword
) {
  throw new Error('La creación no generó una contraseña segura y diferente para cada tienda.');
}
for (const request of requests.filter((entry) => entry.init?.method === 'PUT')) {
  if ('password' in requestBody(request.init?.body)) {
    throw new Error('La actualización no debe cambiar la contraseña de WooCommerce.');
  }
}
if (
  seratusPost?.init?.method !== 'POST' ||
  new URL(seratusPost.url).pathname !== '/wp-json/wc/v3/customers' ||
  paliPost?.init?.method !== 'POST' ||
  new URL(paliPost.url).pathname !== '/wp-json/wc/v3/customers'
) {
  throw new Error('La creación no utilizó el endpoint de clientes en ambas tiendas.');
}

process.stdout.write(
  'Woo customer smoke: Seratus/Pali preflight, conflicts, create, email update, credentials, IDs and payload checks passed.\n',
);
