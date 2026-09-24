export const applicationName = 'SevaleCRM';

export { formatPhoneInternational, mapPhoneToSiigo, normalizePhoneE164 } from './customer-phone.js';
export type { SiigoPhone } from './customer-phone.js';

export {
  couponTypes,
  paymentMethods,
  resolveCouponType,
  resolvePaymentMethod,
  resolveShippingMethod,
  shippingMethods,
} from './order-commercial-catalogs.js';
export type {
  CouponTypeCode,
  PaymentMethodCode,
  ShippingMethodCode,
} from './order-commercial-catalogs.js';

export { splitShippingCents, toShippingCents } from './order-shipping.js';

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
  resolveLocationFromWoo,
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

export {
  buildCustomerSiigoLocationMapping,
  customerCountryFlagPath,
  findCustomerColombiaCitiesByName,
  getCustomerColombiaCities,
  getCustomerColombiaStates,
  getCustomerCountries,
  getCustomerSiigoCities,
  getCustomerSiigoCountries,
  getCustomerSiigoStates,
  getCustomerWooStates,
  isCustomerSiigoLocationMappingCurrent,
  readCustomerSiigoLocationMapping,
  resolveCustomerCityName,
  resolveCustomerColombiaCity,
  resolveCustomerColombiaState,
  resolveCustomerCountry,
  resolveCustomerCountryName,
  resolveCustomerRegionName,
  resolveCustomerSiigoCity,
  resolveCustomerSiigoCountry,
  resolveCustomerSiigoCountryByWooCode,
  resolveCustomerSiigoState,
  resolveCustomerWooState,
} from './customer-locations.js';
export type {
  CustomerCityOption,
  CustomerCityMatch,
  CustomerColombiaCountry,
  CustomerColombiaState,
  CustomerColombiaStateOption,
  CustomerCountryOption,
  CustomerSiigoCountry,
  CustomerSiigoCountryOption,
  CustomerSiigoLocationMapping,
  CustomerSiigoLocationSource,
  CustomerSiigoState,
  CustomerStateOption,
  CustomerWooCountry,
} from './customer-locations.js';
