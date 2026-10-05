export const applicationName = 'SevaleCRM';

export { bogotaTimeZone, parseBogotaDateTime } from './bogota-datetime.js';

export { formatPhoneInternational, mapPhoneToSiigo, normalizePhoneE164 } from './customer-phone.js';
export type { SiigoPhone } from './customer-phone.js';
// El navegador no puede usar las anteriores: arrastran `intl-tel-input` al paquete inicial. Estas
// cargan la librería cuando hacen falta, y se exportan desde los dos puntos de entrada para que los
// tipos y el código de ejecución coincidan.
export { formatPhoneInternationalLazy, normalizePhoneE164Lazy } from './customer-phone-lazy.js';

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
export { wooCustomerUsername } from './customer-username.js';
export type { WooUsernameSource } from './customer-username.js';

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
