import {
  buildCustomerSiigoLocationMapping,
  getCustomerColombiaCities,
  getCustomerColombiaStates,
  getCustomerCountries,
  findCustomerColombiaCitiesByName,
  getCustomerSiigoCountries,
  getCustomerSiigoStates,
  getCustomerWooStates,
  isCustomerSiigoLocationMappingCurrent,
  readCustomerSiigoLocationMapping,
  resolveCustomerCityName,
  resolveCustomerCountry,
  resolveCustomerRegionName,
  resolveCustomerSiigoCountryByWooCode,
  resolveCustomerWooState,
} from '../packages/shared/src/index.js';

if (getCustomerCountries().length !== 250) {
  throw new Error('El catálogo de WooCommerce no contiene los 250 países esperados.');
}
if (getCustomerWooStates('PA').length !== 13) {
  throw new Error('El catálogo de WooCommerce no contiene los 13 estados de Panamá.');
}
if (getCustomerWooStates('AD').length !== 0) {
  throw new Error('Un país sin estados de WooCommerce recibió estados inexistentes.');
}
if (resolveCustomerWooState('PA', '05') !== null) {
  throw new Error('Un código de estado de Siigo fue inferido incorrectamente como estado de Woo.');
}
if (resolveCustomerRegionName('PA', 'PA-8') !== 'Panamá') {
  throw new Error('El estado de WooCommerce de Panamá no se resolvió por su código exacto.');
}
if (resolveCustomerRegionName('PA', 'Provincia libre') !== 'Provincia libre') {
  throw new Error('La región internacional libre no se conservó sin inferencias.');
}
if (resolveCustomerCityName('PA', 'PA-8', null, 'Ciudad de Panamá') !== 'Ciudad de Panamá') {
  throw new Error('La ciudad internacional libre no se conservó.');
}
if (
  getCustomerColombiaStates().length !== 33 ||
  getCustomerColombiaCities('CO-ANT').find(({ code }) => code === '05001')?.name !== 'Medellín' ||
  !findCustomerColombiaCitiesByName('medellin').some(({ cityCode }) => cityCode === '05001') ||
  resolveCustomerCityName('CO', 'CO-ANT', '05001', null) !== 'Medellín'
) {
  throw new Error('El catálogo especial de Colombia no conservó su jerarquía completa.');
}

const siigoCountries = getCustomerSiigoCountries();
const wooCrosswalks = new Set(siigoCountries.map(({ wooCountryCode }) => wooCountryCode));
if (
  siigoCountries.length !== 220 ||
  wooCrosswalks.size !== siigoCountries.length ||
  siigoCountries.some(({ wooCountryCode }) => !resolveCustomerCountry(wooCountryCode))
) {
  throw new Error('El cruce de países Siigo a WooCommerce no es completo o no es unívoco.');
}
const siigoPanama = resolveCustomerSiigoCountryByWooCode('PA');
if (!siigoPanama || siigoPanama.code !== 'Pa' || getCustomerSiigoStates('Pa').length !== 6) {
  throw new Error('El catálogo independiente de Siigo para Panamá no coincide con lo esperado.');
}

const source = { country: 'PA', region: 'PA-8', city: 'Ciudad de Panamá' };
const mapping = buildCustomerSiigoLocationMapping(source, {
  stateCode: '05',
  cityCode: '0501',
});
const restoredMapping = readCustomerSiigoLocationMapping({
  preserved: { value: true },
  siigoLocation: mapping,
});
if (
  !mapping ||
  mapping.target.countryCode !== 'Pa' ||
  mapping.target.stateName !== 'Ciudad de panamá' ||
  mapping.target.cityName !== 'Ciudad de panamá' ||
  !restoredMapping ||
  !isCustomerSiigoLocationMappingCurrent(restoredMapping, source) ||
  isCustomerSiigoLocationMappingCurrent(restoredMapping, {
    ...source,
    city: 'Otra ciudad',
  }) ||
  isCustomerSiigoLocationMappingCurrent(restoredMapping, {
    ...source,
    region: 'PA-3',
  }) ||
  isCustomerSiigoLocationMappingCurrent(restoredMapping, {
    ...source,
    country: 'CO',
  }) ||
  readCustomerSiigoLocationMapping({
    siigoLocation: {
      ...mapping,
      target: { ...mapping.target, cityCode: '0101' },
    },
  }) !== null
) {
  throw new Error('El mapping Siigo no se validó, restauró o invalidó correctamente.');
}

process.stdout.write(
  'Customer location catalogs smoke: Woo, Siigo, Colombia and exact crosswalk checks passed.\n',
);
