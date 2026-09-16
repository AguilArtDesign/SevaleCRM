import '../apps/api/src/config/load-environment.js';
import { BadRequestException } from '@nestjs/common';
import {
  createCustomerSchema,
  customerDocumentError,
  customerDocumentTypes,
  type CreateCustomerInput,
} from '../packages/validation/src/index.js';
import { mapPhoneToSiigo, normalizePhoneE164 } from '../packages/shared/src/customer-phone.js';
import {
  getCities,
  getCountries,
  getStates,
  resolveLocationFromSiigo,
} from '../packages/shared/src/locations.js';
import { CustomerLocationsService } from '../apps/api/src/customers/mapping/customer-locations.service.js';
import { SiigoCustomerMapper } from '../apps/api/src/customers/mapping/siigo-customer.mapper.js';
import { WooCustomerMapper } from '../apps/api/src/customers/mapping/woo-customer.mapper.js';

const customer: CreateCustomerInput = {
  personType: 'PERSON',
  firstName: 'Marcos',
  lastName: 'Castillo',
  displayName: 'Marcos Castillo',
  company: null,
  documentType: '13',
  documentNumber: '013832081',
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

const locations = new CustomerLocationsService();
const siigoMapper = new SiigoCustomerMapper(locations);
const wooMapper = new WooCustomerMapper(locations);

const resolved = locations.resolve('CO', 'CO-ANT', '05001');
if (
  resolved.display.city !== 'Medellín' ||
  resolved.woo.state !== 'CO-ANT' ||
  resolved.siigo.countryCode !== 'Co' ||
  resolved.siigo.stateCode !== '05' ||
  resolved.siigo.cityCode !== '05001'
) {
  throw new Error('LocationsService no conservó el mapping completo de Medellín.');
}
const inverseLocation = resolveLocationFromSiigo('Co', '05', '05001');
if (
  inverseLocation?.country !== 'CO' ||
  inverseLocation.region !== 'CO-ANT' ||
  inverseLocation.cityCode !== '05001'
) {
  throw new Error('El mapping inverso de Siigo no resolvió Medellín al formulario local.');
}

const countries = getCountries();
if (countries.length !== 250) {
  throw new Error(`El catálogo debe contener 250 países y contiene ${countries.length}.`);
}
for (const country of countries) {
  const stateIds = getStates(country.code).map((state) => state.code);
  if (new Set(stateIds).size !== stateIds.length) {
    throw new Error(`El país ${country.code} contiene códigos de región duplicados.`);
  }
  for (const stateId of stateIds) {
    const cityIds = getCities(country.code, stateId).map((city) => city.code);
    if (new Set(cityIds).size !== cityIds.length) {
      throw new Error(
        `La región ${country.code}/${stateId} contiene códigos de ciudad duplicados.`,
      );
    }
  }
}

let unmappedLocationRejected = false;
try {
  locations.resolve('AF', '10', '1001');
} catch (error) {
  unmappedLocationRejected = error instanceof BadRequestException;
}
if (!unmappedLocationRejected) {
  throw new Error('LocationsService permitió una región sin mapping WooCommerce.');
}

const numericTypes = new Set(['13', '31', '11']);
for (const { value } of customerDocumentTypes) {
  const valid = numericTypes.has(value) ? '123' : 'ABC123';
  if (customerDocumentError(value, valid) !== null) {
    throw new Error(`El documento válido fue rechazado para el tipo ${value}.`);
  }
  if (customerDocumentError(value, 'ABC 123') === null) {
    throw new Error(`El documento con espacios fue aceptado para el tipo ${value}.`);
  }
}
if (
  customerDocumentError('13', '12') === null ||
  customerDocumentError('13', '12345678901234') === null ||
  customerDocumentError('R-00-PN', 'ABCDEFGHIJKLMN') === null
) {
  throw new Error('Los límites de documento no se aplicaron correctamente.');
}

const parsedCustomer = createCustomerSchema.safeParse({
  ...customer,
  phone: '+57 (300) 600-3345',
});
if (!parsedCustomer.success || parsedCustomer.data.phone !== '+573006003345') {
  throw new Error('El schema no normalizó los separadores permitidos del teléfono.');
}

const customerWithoutDocument = createCustomerSchema.safeParse({
  ...customer,
  documentType: '',
  documentNumber: '',
});
if (
  customerWithoutDocument.success ||
  customerWithoutDocument.error.issues.find((issue) => issue.path[0] === 'documentType')
    ?.message !== 'Selecciona el tipo de documento.' ||
  customerWithoutDocument.error.issues.find((issue) => issue.path[0] === 'documentNumber')
    ?.message !== 'Ingresa el número de documento.'
) {
  throw new Error('El schema no presentó mensajes claros para el documento obligatorio.');
}

const customerWithoutPublicName = createCustomerSchema.safeParse({
  ...customer,
  displayName: undefined,
});
if (!customerWithoutPublicName.success) {
  throw new Error('El esquema local exigió el nombre público opcional.');
}

const customerWithoutLastName = createCustomerSchema.safeParse({
  ...customer,
  lastName: null,
});
if (customerWithoutLastName.success) {
  throw new Error('El esquema local permitió una persona sin apellidos.');
}

const customerWithMultipleFiscalResponsibilities = createCustomerSchema.safeParse({
  ...customer,
  fiscalResponsibilities: ['R-99-PN', 'O-13'],
});
if (customerWithMultipleFiscalResponsibilities.success) {
  throw new Error('El esquema local permitió varias responsabilidades fiscales.');
}

const incompleteCustomer = createCustomerSchema.safeParse({
  ...customer,
  email: null,
  phone: null,
  country: null,
  region: null,
  cityCode: null,
  postalCode: null,
  addressLine1: null,
  addressLine2: null,
  fiscalResponsibilities: [],
});
if (!incompleteCustomer.success) {
  throw new Error('El esquema local rechazó un cliente válido con datos opcionales ausentes.');
}

let incompleteSiigoRejected = false;
try {
  siigoMapper.map(incompleteCustomer.data);
} catch (error) {
  const response = error instanceof BadRequestException ? error.getResponse() : null;
  incompleteSiigoRejected =
    typeof response === 'object' &&
    response !== null &&
    'error' in response &&
    (response as { error?: { code?: string } }).error?.code ===
      'SIIGO_CUSTOMER_REQUIRED_DATA_MISSING';
}
if (!incompleteSiigoRejected) {
  throw new Error('SiigoCustomerMapper permitió sincronizar sin sus campos obligatorios.');
}

const siigoWithoutStreetAddress = siigoMapper.map({
  ...customer,
  addressLine1: null,
  addressLine2: null,
  postalCode: null,
});
if (
  'address' in siigoWithoutStreetAddress.address ||
  siigoWithoutStreetAddress.address.city.country_code !== 'Co' ||
  siigoWithoutStreetAddress.address.city.state_code !== '05' ||
  siigoWithoutStreetAddress.address.city.city_code !== '05001'
) {
  throw new Error(
    'SiigoCustomerMapper no generó correctamente la ubicación sin dirección textual.',
  );
}

let incompleteWooRejected = false;
try {
  wooMapper.map(incompleteCustomer.data);
} catch (error) {
  const response = error instanceof BadRequestException ? error.getResponse() : null;
  incompleteWooRejected =
    typeof response === 'object' &&
    response !== null &&
    'error' in response &&
    (response as { error?: { code?: string } }).error?.code ===
      'WOOCOMMERCE_CUSTOMER_EMAIL_REQUIRED';
}
if (!incompleteWooRejected) {
  throw new Error('WooCustomerMapper permitió sincronizar sin el correo que requiere.');
}
if (
  normalizePhoneE164('+57 (300) 600-3345', 'CO') !== '+573006003345' ||
  normalizePhoneE164('+57300', 'CO') !== null
) {
  throw new Error('La normalización no procesó correctamente el teléfono.');
}
const siigoPhone = mapPhoneToSiigo('+573006003345', 'CO');
if (siigoPhone?.indicative !== '57' || siigoPhone.number !== '3006003345') {
  throw new Error('El teléfono no se separó correctamente para Siigo.');
}

const siigo = siigoMapper.map(customer);
if (
  siigo.type !== 'Customer' ||
  siigo.person_type !== 'Person' ||
  siigo.id_type !== '13' ||
  siigo.identification !== '013832081' ||
  siigo.name.join('|') !== 'MARCOS|CASTILLO' ||
  siigo.address.address !== 'CRA. 18 #79A - 42, APTO 301' ||
  siigo.address.city.state_code !== '05' ||
  siigo.phones?.[0]?.indicative !== '57' ||
  siigo.contacts?.[0]?.first_name !== 'MARCOS' ||
  siigo.contacts[0].last_name !== 'CASTILLO' ||
  siigo.fiscal_responsibilities[0]?.code !== 'R-99-PN'
) {
  throw new Error('SiigoCustomerMapper generó un payload distinto al contrato aprobado.');
}
if ('commercial_name' in siigo || 'check_digit' in siigo) {
  throw new Error('SiigoCustomerMapper incluyó campos opcionales vacíos o redundantes.');
}

const company = siigoMapper.map({
  ...customer,
  personType: 'COMPANY',
  firstName: null,
  lastName: null,
  company: 'Sevale S.A.S.',
  displayName: 'Sevale',
  documentType: '31',
});
if (
  company.person_type !== 'Company' ||
  company.name[0] !== 'SEVALE S.A.S.' ||
  company.commercial_name !== 'Sevale' ||
  company.contacts !== undefined
) {
  throw new Error('SiigoCustomerMapper no distinguió correctamente una empresa.');
}

const woo = wooMapper.map(customer);
if (
  woo.username !== customer.documentNumber ||
  woo.email !== customer.email ||
  woo.billing.city !== 'Medellín' ||
  woo.billing.state !== 'CO-ANT' ||
  woo.billing.country !== 'CO' ||
  woo.billing.phone !== '+573006003345' ||
  woo.billing.address_1 !== 'CRA. 18 #79A - 42' ||
  woo.billing.address_2 !== 'APTO 301' ||
  woo.meta_data.find((entry) => entry.key === 'billing_type_document')?.value !== '13' ||
  woo.meta_data.find((entry) => entry.key === 'billing_identification')?.value !== '013832081' ||
  'password' in woo ||
  'shipping' in woo
) {
  throw new Error('WooCustomerMapper generó un payload distinto al contrato aprobado.');
}

const wooWithUppercaseNames = wooMapper.map({
  ...customer,
  firstName: 'MARCOS ANDRÉS',
  lastName: 'CASTILLO GÓMEZ',
});
if (
  wooWithUppercaseNames.first_name !== 'Marcos Andrés' ||
  wooWithUppercaseNames.last_name !== 'Castillo Gómez' ||
  wooWithUppercaseNames.billing.first_name !== 'Marcos Andrés' ||
  wooWithUppercaseNames.billing.last_name !== 'Castillo Gómez'
) {
  throw new Error('WooCustomerMapper no convirtió los nombres a Capitalize.');
}

process.stdout.write(
  'Customer mapping smoke: locations, all document types, E.164 phone, Siigo and WooCommerce payload checks passed.\n',
);
