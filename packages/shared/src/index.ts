export const applicationName = 'SevaleCRM';

export { mapPhoneToSiigo, normalizePhoneE164 } from './customer-phone.js';
export type { SiigoPhone } from './customer-phone.js';

export {
  countryFlagPath,
  findCitiesByName,
  getCities,
  getCountries,
  getStates,
  mapLocationToSiigo,
  mapLocationToWoo,
  resolveCity,
  resolveCountry,
  resolveLocationFromSiigo,
  resolveState,
} from './locations.js';
export type {
  CityMatch,
  CityOption,
  CountryOption,
  LocationCatalog,
  LocationCountry,
  LocationState,
  StateOption,
} from './locations.js';
