import '../apps/api/src/config/load-environment.js';
import type { CreateCustomerInput } from '../packages/validation/src/index.js';
import { CustomerLocationsService } from '../apps/api/src/customers/mapping/customer-locations.service.js';
import { SiigoCustomerMapper } from '../apps/api/src/customers/mapping/siigo-customer.mapper.js';
import { SiigoCustomerService } from '../apps/api/src/customers/integrations/siigo-customer.service.js';
import type { SiigoTokenService } from '../apps/api/src/integrations/siigo/siigo-token.service.js';

const personId = '377d11bb-4fce-4e80-bd6d-c593da3fccdb';
const companyId = 'ecb64ac4-c887-4d3c-a9ec-7056393ab22e';
const primaryBranchId = '1a4d18a8-993f-4a21-a5af-cfa42075ae11';

function lookupCandidate(id: string, identification: string, branchOffice: number) {
  return {
    id,
    type: 'Customer',
    person_type: 'Person',
    id_type: { code: '13', name: 'Cédula de ciudadanía' },
    identification,
    branch_office: branchOffice,
    name: ['CLIENTE', `SEDE ${branchOffice}`],
    active: true,
    vat_responsible: false,
    fiscal_responsibilities: [{ code: 'R-99-PN', name: 'No aplica - Otros' }],
    address: {
      address: 'Calle 10 #20-30',
      city: { country_code: 'Co', state_code: '05', city_code: '05001' },
      postal_code: '050001',
    },
    contacts: [{ email: 'cliente@example.com' }],
  };
}
const requests: Array<{ url: string; init?: RequestInit }> = [];
const responses: Response[] = [
  new Response(JSON.stringify({ message: 'Unauthorized' }), { status: 401 }),
  Response.json({
    pagination: { page: 1, page_size: 25, total_results: 1 },
    results: [
      {
        id: personId,
        type: 'Customer',
        person_type: 'Person',
        identification: '904940',
      },
    ],
  }),
  Response.json({
    pagination: { page: 1, page_size: 25, total_results: 1 },
    results: [
      {
        id: personId,
        type: 'Supplier',
        person_type: 'Person',
        id_type: { code: '22', name: 'Cédula de extranjería' },
        identification: '904940',
        check_digit: '0',
        name: ['YOHANDER DAVID', 'AGUILAR GUEVARA'],
        vat_responsible: false,
        fiscal_responsibilities: [{ code: 'R-99-PN', name: 'No aplica - Otros' }],
        address: {
          address: 'CRA 79B #92-155, INT 201',
          city: {
            country_code: 'Co',
            state_code: '05',
            city_code: '05001',
          },
          postal_code: '050040',
        },
        phones: [{ indicative: '57', number: '3044251788', extension: '9988' }],
        contacts: [
          {
            first_name: 'YOHANDER DAVID',
            last_name: 'AGUILAR GUEVARA',
            email: 'info@aguilartdesign.com',
          },
        ],
      },
    ],
  }),
  Response.json(
    {
      id: companyId,
      type: 'Customer',
      person_type: 'Company',
      identification: '900746054',
    },
    { status: 201 },
  ),
  Response.json({
    id: companyId,
    type: 'Customer',
    person_type: 'Company',
    identification: '900746054',
  }),
  Response.json({ pagination: { page: 1, page_size: 25, total_results: 0 }, results: [] }),
  Response.json({
    pagination: { page: 1, page_size: 25, total_results: 2 },
    results: [
      lookupCandidate('5e45d101-2700-4639-96f4-9b69d669868d', '11223344', 1),
      lookupCandidate(primaryBranchId, '11223344', 0),
    ],
  }),
  Response.json({
    pagination: { page: 1, page_size: 25, total_results: 2 },
    results: [
      lookupCandidate('284b9c22-0f60-4885-9f52-cecc14f5d5a4', '55667788', 1),
      lookupCandidate('88e771f6-5cf1-4424-a1a3-d8893322358b', '55667788', 2),
    ],
  }),
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

process.env.SIIGO_API_URL = 'https://api.siigo.test/v1';
process.env.SIIGO_PARTNER_ID = 'partner-smoke';

let refreshes = 0;
const tokens = {
  getAccessToken: () => Promise.resolve('expired-token'),
  refreshAccessToken: (rejectedToken?: string) => {
    if (rejectedToken !== 'expired-token') {
      throw new Error('El servicio no informó el token rechazado durante la renovación.');
    }
    refreshes += 1;
    return Promise.resolve('renewed-token');
  },
} as unknown as SiigoTokenService;

const mapper = new SiigoCustomerMapper(new CustomerLocationsService());
const service = new SiigoCustomerService(tokens, mapper);

const person = await service.findCustomer('904940');
if (person?.id !== personId || person.personType !== 'Person' || refreshes !== 1) {
  throw new Error('findCustomer no normalizó el cliente o no renovó el token rechazado.');
}

const lookup = await service.lookupCustomer('904940');
if (
  lookup?.reference.id !== personId ||
  lookup.prefill.documentType !== '22' ||
  lookup.prefill.firstName !== 'YOHANDER DAVID' ||
  lookup.prefill.lastName !== 'AGUILAR GUEVARA' ||
  lookup.prefill.country !== 'CO' ||
  lookup.prefill.region !== null ||
  lookup.prefill.cityCode !== null ||
  lookup.prefill.phone !== '+573044251788'
) {
  throw new Error('lookupCustomer no normalizó el formulario recibido desde Siigo.');
}

const company: CreateCustomerInput = {
  personType: 'COMPANY',
  firstName: null,
  lastName: null,
  displayName: '@PC MAYORISTA S.A.S.',
  company: '@PC MAYORISTA S.A.S.',
  documentType: '31',
  documentNumber: '900746054',
  checkDigit: '4',
  email: 'facturacion@example.com',
  phone: '+573006003345',
  country: 'CO',
  region: 'CO-ATL',
  cityCode: '08001',
  cityName: null,
  postalCode: null,
  addressLine1: 'Calle 16 No 45 85',
  addressLine2: null,
  vatResponsible: true,
  fiscalResponsibilities: ['R-99-PN'],
};

const created = await service.createCustomer(company);
if (created.id !== companyId || created.personType !== 'Company') {
  throw new Error('createCustomer no conservó el UUID confirmado por Siigo.');
}
const updated = await service.updateCustomer(companyId, company);
if (updated.id !== companyId) {
  throw new Error('updateCustomer no confirmó el mismo UUID externo.');
}
if ((await service.findCustomer('000000000')) !== null) {
  throw new Error('findCustomer debe devolver null cuando Siigo no encuentra coincidencias.');
}
const branchLookup = await service.lookupCustomer('11223344');
if (branchLookup?.reference.id !== primaryBranchId) {
  throw new Error('lookupCustomer no priorizó branch_office = 0 entre varias sedes.');
}
let ambiguousLookupRejected = false;
try {
  await service.lookupCustomer('55667788');
} catch {
  ambiguousLookupRejected = true;
}
if (!ambiguousLookupRejected) {
  throw new Error('lookupCustomer seleccionó silenciosamente una respuesta ambigua.');
}

if (responses.length !== 0 || requests.length !== 8) {
  throw new Error('La cantidad de peticiones Siigo no coincide con el flujo esperado.');
}
const [
  firstFind,
  retriedFind,
  lookupRequest,
  createRequest,
  updateRequest,
  missingRequest,
  branchRequest,
  ambiguousRequest,
] = requests;
const retriedHeaders = new Headers(retriedFind?.init?.headers);
if (
  firstFind?.init?.method !== 'GET' ||
  !firstFind.url.includes('/v1/customers?identification=904940') ||
  retriedHeaders.get('authorization') !== 'Bearer renewed-token' ||
  retriedHeaders.get('partner-id') !== 'partner-smoke'
) {
  throw new Error('findCustomer no utilizó endpoint, filtros o headers correctos.');
}
if (
  lookupRequest?.init?.method !== 'GET' ||
  !lookupRequest.url.includes('/v1/customers?identification=904940') ||
  new URL(lookupRequest.url).searchParams.has('type')
) {
  throw new Error('lookupCustomer no utilizó la consulta amplia por identificación esperada.');
}
const createBody = requestBody(createRequest?.init?.body);
if (
  createRequest?.init?.method !== 'POST' ||
  new URL(createRequest.url).pathname !== '/v1/customers' ||
  createBody.type !== 'Customer' ||
  createBody.person_type !== 'Company' ||
  createBody.identification !== company.documentNumber
) {
  throw new Error('createCustomer no envió el payload completo esperado por Siigo.');
}
const updateBody = requestBody(updateRequest?.init?.body);
if (
  updateRequest?.init?.method !== 'PUT' ||
  new URL(updateRequest.url).pathname !== `/v1/customers/${companyId}` ||
  updateBody.identification !== company.documentNumber ||
  !Array.isArray(updateBody.fiscal_responsibilities) ||
  typeof updateBody.address !== 'object'
) {
  throw new Error('updateCustomer no envió el recurso completo al UUID externo.');
}
if (
  missingRequest?.init?.method !== 'GET' ||
  !missingRequest.url.includes('identification=000000000')
) {
  throw new Error('La búsqueda sin coincidencias utilizó un contrato inesperado.');
}
if (
  !branchRequest?.url.includes('identification=11223344') ||
  !ambiguousRequest?.url.includes('identification=55667788')
) {
  throw new Error('Las búsquedas con sucursales utilizaron un contrato inesperado.');
}

process.stdout.write(
  'Siigo customer smoke: lookup prefill, find, create, update, external UUID, payload, timeout path and token renewal checks passed.\n',
);
