import { randomUUID } from 'node:crypto';
import { CustomerDraftResolverService } from '../apps/api/src/customers/customer-draft-resolver.service.js';
import type { CustomersRepository } from '../apps/api/src/customers/customers.repository.js';
import type { SiigoCustomerService } from '../apps/api/src/customers/integrations/siigo-customer.service.js';
import type { WooCustomerService } from '../apps/api/src/customers/integrations/woo-customer.service.js';

type Scenario = {
  localId?: number;
  siigo?: ReturnType<typeof siigo> | null;
  seratus?: ReturnType<typeof woo> | null;
  pali?: ReturnType<typeof woo> | null;
};

let scenario: Scenario = {};

function equal(actual: unknown, expected: unknown, context: string) {
  if (actual !== expected) {
    throw new Error(`${context}: se esperaba ${String(expected)} y se recibió ${String(actual)}.`);
  }
}

function assert(condition: unknown, context: string): asserts condition {
  if (!condition) throw new Error(context);
}

function siigo(overrides: Record<string, unknown> = {}) {
  return {
    reference: { id: randomUUID(), identification: '904940', personType: 'Person' as const },
    prefill: {
      personType: 'PERSON' as const,
      firstName: 'YOHANDER DAVID',
      lastName: 'AGUILAR GUEVARA',
      displayName: 'YOHANDER DAVID AGUILAR GUEVARA',
      company: null,
      documentType: '22' as const,
      documentNumber: '904940',
      checkDigit: '0',
      email: 'cliente@gmail.com',
      phone: '+573044251788',
      country: 'CO',
      region: 'CO-ANT',
      cityCode: '05001',
      postalCode: '050040',
      addressLine1: 'CRA 79B #92-155, INT 201, ROBLEDO MIRAMAR',
      addressLine2: null,
      vatResponsible: false,
      fiscalResponsibilities: ['R-99-PN' as const],
      active: true,
      ...overrides,
    },
  };
}

function woo(overrides: Record<string, unknown> = {}) {
  return {
    id: '8',
    email: 'cliente@gmail.com',
    first_name: 'Yohander',
    last_name: 'Aguilar',
    username: '904940',
    billing: {
      first_name: 'Yohander David',
      last_name: 'Aguilar Guevara',
      company: 'AguilArt Design',
      address_1: 'CRA 79B #92-155 INT 201',
      address_2: 'Robledo Miramar',
      city: 'Medellín',
      postcode: '050040',
      country: 'CO',
      state: 'CO-ANT',
      email: 'cliente@gmail.com',
      phone: '+57 304 4251788',
      ...((overrides.billing as Record<string, unknown> | undefined) ?? {}),
    },
    meta_data: [
      { id: 1, key: 'billing_type_document' as const, value: 'Documento Extranjero' },
      { id: 2, key: 'billing_identification' as const, value: '904940' },
    ],
    ...Object.fromEntries(Object.entries(overrides).filter(([key]) => key !== 'billing')),
  };
}

const repository = {
  findByDocumentNumber: () => Promise.resolve(scenario.localId ? { id: scenario.localId } : null),
} as unknown as CustomersRepository;
const siigoService = {
  lookupCustomer: () => Promise.resolve(scenario.siigo ?? null),
} as unknown as SiigoCustomerService;
const wooService = {
  findCustomerByDocument: (store: 'SERATUS' | 'PALI') => {
    const customer = store === 'SERATUS' ? (scenario.seratus ?? null) : (scenario.pali ?? null);
    return Promise.resolve(
      customer ? ({ status: 'FOUND', customer } as const) : ({ status: 'NOT_FOUND' } as const),
    );
  },
} as unknown as WooCustomerService;
const resolver = new CustomerDraftResolverService(repository, siigoService, wooService);

scenario = { localId: 91, siigo: siigo(), seratus: woo(), pali: woo() };
const local = await resolver.resolve('904940', '22');
assert(local.existsLocally, 'La búsqueda local debe detener las consultas externas.');
equal(local.customerId, 91, 'Debe devolver el ID local existente');

scenario = { siigo: siigo() };
const onlySiigo = await resolver.resolve('904940', '22');
assert(!onlySiigo.existsLocally && onlySiigo.customer, 'Siigo debe construir un draft.');
equal(onlySiigo.customer.email, 'cliente@gmail.com', 'Debe conservar el correo único de Siigo');
equal(onlySiigo.customer.country, null, 'Siigo no debe autocompletar el país');
equal(onlySiigo.customer.region, null, 'Siigo no debe autocompletar la región');
equal(onlySiigo.customer.cityCode, null, 'Siigo no debe autocompletar el código de ciudad');
equal(Object.keys(onlySiigo.conflicts).length, 0, 'Siigo único no debe generar conflictos');

scenario = { seratus: woo() };
const onlyWoo = await resolver.resolve('904940', '22');
assert(!onlyWoo.existsLocally && onlyWoo.customer, 'WooCommerce debe construir un draft.');
equal(onlyWoo.customer.documentType, '22', 'Debe usar el tipo de documento pedido en la búsqueda');
equal(onlyWoo.customer.firstName, 'Yohander David', 'Billing debe ganar sobre top-level');
equal(onlyWoo.customer.addressLine2, 'Robledo Miramar', 'Debe preservar el complemento Billing');
equal(onlyWoo.customer.country, null, 'WooCommerce no debe autocompletar el país');
equal(onlyWoo.customer.region, null, 'WooCommerce no debe autocompletar la región');
equal(onlyWoo.customer.cityName, null, 'WooCommerce no debe autocompletar la ciudad');

scenario = {
  seratus: woo({
    meta_data: [
      { id: 1, key: 'billing_type_document', value: 'Valor todavía no mapeado' },
      { id: 2, key: 'billing_identification', value: '904940' },
    ],
  }),
};
const unknownDocumentType = await resolver.resolve('904940', '22');
assert(
  !unknownDocumentType.existsLocally && unknownDocumentType.customer,
  'WooCommerce debe construir un draft aunque el tipo no esté mapeado.',
);
equal(
  unknownDocumentType.customer.documentType,
  '22',
  'El tipo pedido en la búsqueda debe mandar sobre un valor Woo no mapeado',
);

scenario = { siigo: siigo(), seratus: woo(), pali: woo({ id: '2' }) };
const equivalent = await resolver.resolve('904940', '22');
assert(
  !equivalent.existsLocally && equivalent.customer,
  'Las fuentes equivalentes deben resolverse.',
);
equal(
  Object.keys(equivalent.conflicts).length,
  0,
  'Los valores equivalentes no deben generar conflicto',
);
equal(
  equivalent.customer.addressLine2,
  'Robledo Miramar',
  'Una dirección equivalente debe preferir la estructura Billing',
);

scenario = {
  siigo: siigo({
    firstName: 'YOHANDER D',
    lastName: 'AGUILAR G',
    displayName: 'YOHANDER D AGUILAR G',
  }),
  seratus: woo(),
  pali: woo({ id: '2' }),
};
const completeNames = await resolver.resolve('904940', '22');
assert(!completeNames.existsLocally && completeNames.customer, 'Debe resolver los nombres.');
equal(completeNames.customer.firstName, null, 'Un conflicto debe dejar los nombres vacíos');
equal(completeNames.customer.lastName, null, 'Un conflicto debe dejar los apellidos vacíos');
equal(completeNames.customer.displayName, '', 'Un conflicto debe dejar el nombre público vacío');
equal(
  completeNames.conflicts.name?.options.length,
  2,
  'Los nombres externos diferentes deben permitir selección manual',
);

scenario = {
  siigo: siigo({ email: null }),
  seratus: woo({ billing: { email: 'compras@gmail.com' } }),
};
const invalidSiigoEmail = await resolver.resolve('904940', '22');
assert(
  !invalidSiigoEmail.existsLocally && invalidSiigoEmail.customer,
  'Debe resolver el email Woo.',
);
equal(invalidSiigoEmail.customer.email, 'compras@gmail.com', 'El candidato válido debe ganar');

scenario = {
  siigo: siigo(),
  seratus: woo({ billing: { email: 'otro@hotmail.com', phone: '+57 310 555 1234' } }),
  pali: woo({ id: '2', billing: { email: 'otro@hotmail.com', phone: '+57 310 555 1234' } }),
};
const scalarConflicts = await resolver.resolve('904940', '22');
assert(!scalarConflicts.existsLocally, 'Debe resolver fuentes externas.');
equal(scalarConflicts.conflicts.email?.options.length, 2, 'Debe detectar dos correos distintos');
equal(scalarConflicts.conflicts.phone?.options.length, 2, 'Debe detectar dos teléfonos distintos');
equal(
  scalarConflicts.conflicts.email?.options[1]?.sources.join(','),
  'SERATUS,PALI',
  'Debe colapsar candidatos iguales de ambas tiendas',
);

scenario = {
  siigo: siigo({ addressLine1: 'CALLE 50 #20-30' }),
  seratus: woo(),
  pali: woo({ id: '2', billing: { address_1: 'AVENIDA 10 #1-20', address_2: '' } }),
};
const addressConflict = await resolver.resolve('904940', '22');
assert(!addressConflict.existsLocally, 'Debe resolver fuentes externas.');
equal(
  addressConflict.conflicts.address?.options.length,
  3,
  'Debe conservar tres direcciones distintas',
);

console.log('Customer draft resolver smoke: OK');
