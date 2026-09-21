import colombiaCatalogJson from './colombia-locations.json' with { type: 'json' };
import siigoCatalogJson from './siigo-locations.json' with { type: 'json' };
import wooCatalogJson from './woocommerce-locations.json' with { type: 'json' };

export type CustomerWooCountry = {
  name: string;
  flag: string;
  states: Record<string, string>;
};

export type CustomerSiigoState = {
  name: string;
  cities: Record<string, string>;
};

export type CustomerSiigoCountry = {
  name: string;
  wooCountryCode: string;
  states: Record<string, CustomerSiigoState>;
};

export type CustomerColombiaState = CustomerSiigoState & { wooCode: string };
export type CustomerColombiaCountry = {
  name: string;
  siigoCode: string;
  states: Record<string, CustomerColombiaState>;
};

export type CustomerCountryOption = {
  code: string;
  name: string;
  flag: string;
};

export type CustomerStateOption = { code: string; name: string };
export type CustomerColombiaStateOption = CustomerStateOption & { siigoCode: string };
export type CustomerCityOption = { code: string; name: string };
export type CustomerCityMatch = { country: 'CO'; cityCode: string };
export type CustomerSiigoCountryOption = {
  code: string;
  name: string;
  wooCountryCode: string;
};
export type CustomerSiigoLocationSource = {
  country: string;
  region: string | null;
  city: string | null;
};
export type CustomerSiigoLocationMapping = {
  source: CustomerSiigoLocationSource;
  target: {
    countryCode: string;
    stateCode: string;
    stateName: string;
    cityCode: string;
    cityName: string;
  };
};

type WooCatalog = Record<string, CustomerWooCountry>;
type SiigoCatalog = Record<string, CustomerSiigoCountry>;
type ColombiaCatalog = Record<string, CustomerColombiaCountry>;

const wooCatalog = wooCatalogJson as WooCatalog;
const siigoCatalog = siigoCatalogJson as SiigoCatalog;
const colombiaCatalog = colombiaCatalogJson as ColombiaCatalog;
const byName = new Intl.Collator('es', { sensitivity: 'base' });

function normalizedCode(value: string): string {
  return value.trim().toUpperCase();
}

function normalizedSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es')
    .trim();
}

function exactEntry<T>(catalog: Record<string, T>, code: string): [string, T] | null {
  const normalized = normalizedCode(code);
  return Object.entries(catalog).find(([key]) => normalizedCode(key) === normalized) ?? null;
}

function sortedByName<T extends { name: string }>(options: T[]): T[] {
  return options.sort((first, second) => byName.compare(first.name, second.name));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function getCustomerCountries(): CustomerCountryOption[] {
  return sortedByName(
    Object.entries(wooCatalog).map(([code, country]) => ({
      code,
      name: country.name,
      flag: country.flag,
    })),
  );
}

export function resolveCustomerCountry(countryCode: string): CustomerWooCountry | null {
  return exactEntry(wooCatalog, countryCode)?.[1] ?? null;
}

export function customerCountryFlagPath(countryCode: string): string {
  return (
    resolveCustomerCountry(countryCode)?.flag ?? `/img/flags/${normalizedCode(countryCode)}.webp`
  );
}

export function getCustomerWooStates(countryCode: string): CustomerStateOption[] {
  const country = resolveCustomerCountry(countryCode);
  if (!country) return [];
  return sortedByName(Object.entries(country.states).map(([code, name]) => ({ code, name })));
}

export function resolveCustomerWooState(
  countryCode: string,
  regionCode: string,
): CustomerStateOption | null {
  const country = resolveCustomerCountry(countryCode);
  if (!country) return null;
  const state = exactEntry(country.states, regionCode);
  return state ? { code: state[0], name: state[1] } : null;
}

export function getCustomerColombiaStates(): CustomerColombiaStateOption[] {
  const country = colombiaCatalog.CO;
  if (!country) return [];
  return sortedByName(
    Object.entries(country.states).map(([siigoCode, state]) => ({
      code: state.wooCode,
      siigoCode,
      name: state.name,
    })),
  );
}

export function resolveCustomerColombiaState(
  regionCode: string,
): (CustomerColombiaStateOption & { cities: Record<string, string> }) | null {
  const country = colombiaCatalog.CO;
  if (!country) return null;
  const normalized = normalizedCode(regionCode);
  const state = Object.entries(country.states).find(
    ([siigoCode, candidate]) =>
      normalizedCode(siigoCode) === normalized || normalizedCode(candidate.wooCode) === normalized,
  );
  if (!state) return null;
  return {
    code: state[1].wooCode,
    siigoCode: state[0],
    name: state[1].name,
    cities: state[1].cities,
  };
}

export function getCustomerColombiaCities(regionCode: string): CustomerCityOption[] {
  const state = resolveCustomerColombiaState(regionCode);
  if (!state) return [];
  return sortedByName(Object.entries(state.cities).map(([code, name]) => ({ code, name })));
}

export function resolveCustomerColombiaCity(
  regionCode: string,
  cityCode: string,
): CustomerCityOption | null {
  const state = resolveCustomerColombiaState(regionCode);
  if (!state) return null;
  const city = exactEntry(state.cities, cityCode);
  return city ? { code: city[0], name: city[1] } : null;
}

export function findCustomerColombiaCitiesByName(search: string): CustomerCityMatch[] {
  const term = normalizedSearch(search);
  const country = colombiaCatalog.CO;
  if (!term || !country) return [];
  return Object.values(country.states).flatMap((state) =>
    Object.entries(state.cities)
      .filter(([, name]) => normalizedSearch(name).includes(term))
      .map(([cityCode]) => ({ country: 'CO' as const, cityCode })),
  );
}

export function getCustomerSiigoCountries(): CustomerSiigoCountryOption[] {
  return sortedByName(
    Object.entries(siigoCatalog).map(([code, country]) => ({
      code,
      name: country.name,
      wooCountryCode: country.wooCountryCode,
    })),
  );
}

export function resolveCustomerSiigoCountry(
  siigoCountryCode: string,
): (CustomerSiigoCountryOption & { states: Record<string, CustomerSiigoState> }) | null {
  const country = exactEntry(siigoCatalog, siigoCountryCode);
  if (!country) return null;
  return {
    code: country[0],
    name: country[1].name,
    wooCountryCode: country[1].wooCountryCode,
    states: country[1].states,
  };
}

export function resolveCustomerSiigoCountryByWooCode(
  wooCountryCode: string,
): (CustomerSiigoCountryOption & { states: Record<string, CustomerSiigoState> }) | null {
  const normalized = normalizedCode(wooCountryCode);
  const country = Object.entries(siigoCatalog).find(
    ([, candidate]) => normalizedCode(candidate.wooCountryCode) === normalized,
  );
  return country ? resolveCustomerSiigoCountry(country[0]) : null;
}

export function getCustomerSiigoStates(siigoCountryCode: string): CustomerStateOption[] {
  const country = resolveCustomerSiigoCountry(siigoCountryCode);
  if (!country) return [];
  return sortedByName(
    Object.entries(country.states).map(([code, state]) => ({ code, name: state.name })),
  );
}

export function resolveCustomerSiigoState(
  siigoCountryCode: string,
  stateCode: string,
): (CustomerStateOption & { cities: Record<string, string> }) | null {
  const country = resolveCustomerSiigoCountry(siigoCountryCode);
  if (!country) return null;
  const state = exactEntry(country.states, stateCode);
  return state ? { code: state[0], name: state[1].name, cities: state[1].cities } : null;
}

export function getCustomerSiigoCities(
  siigoCountryCode: string,
  stateCode: string,
): CustomerCityOption[] {
  const state = resolveCustomerSiigoState(siigoCountryCode, stateCode);
  if (!state) return [];
  return sortedByName(Object.entries(state.cities).map(([code, name]) => ({ code, name })));
}

export function resolveCustomerSiigoCity(
  siigoCountryCode: string,
  stateCode: string,
  cityCode: string,
): CustomerCityOption | null {
  const state = resolveCustomerSiigoState(siigoCountryCode, stateCode);
  if (!state) return null;
  const city = exactEntry(state.cities, cityCode);
  return city ? { code: city[0], name: city[1] } : null;
}

export function buildCustomerSiigoLocationMapping(
  source: CustomerSiigoLocationSource,
  selection: { stateCode: string; cityCode: string },
): CustomerSiigoLocationMapping | null {
  const country = resolveCustomerSiigoCountryByWooCode(source.country);
  if (!country) return null;
  const state = resolveCustomerSiigoState(country.code, selection.stateCode);
  const city = resolveCustomerSiigoCity(country.code, selection.stateCode, selection.cityCode);
  if (!state || !city) return null;
  return {
    source: { ...source },
    target: {
      countryCode: country.code,
      stateCode: state.code,
      stateName: state.name,
      cityCode: city.code,
      cityName: city.name,
    },
  };
}

export function readCustomerSiigoLocationMapping(
  externalData: unknown,
): CustomerSiigoLocationMapping | null {
  if (!isRecord(externalData) || !isRecord(externalData.siigoLocation)) return null;
  const mapping = externalData.siigoLocation;
  if (!isRecord(mapping.source) || !isRecord(mapping.target)) return null;
  const source = mapping.source;
  const target = mapping.target;
  if (
    typeof source.country !== 'string' ||
    (source.region !== null && typeof source.region !== 'string') ||
    (source.city !== null && typeof source.city !== 'string') ||
    typeof target.countryCode !== 'string' ||
    typeof target.stateCode !== 'string' ||
    typeof target.cityCode !== 'string'
  ) {
    return null;
  }
  const canonical = buildCustomerSiigoLocationMapping(
    { country: source.country, region: source.region, city: source.city },
    { stateCode: target.stateCode, cityCode: target.cityCode },
  );
  if (
    !canonical ||
    normalizedCode(canonical.target.countryCode) !== normalizedCode(target.countryCode)
  ) {
    return null;
  }
  return canonical;
}

export function isCustomerSiigoLocationMappingCurrent(
  mapping: CustomerSiigoLocationMapping,
  source: CustomerSiigoLocationSource,
): boolean {
  return (
    mapping.source.country === source.country &&
    mapping.source.region === source.region &&
    mapping.source.city === source.city
  );
}

export function resolveCustomerCountryName(countryCode: string | null): string | null {
  if (!countryCode) return null;
  return resolveCustomerCountry(countryCode)?.name ?? countryCode;
}

export function resolveCustomerRegionName(
  countryCode: string | null,
  regionCode: string | null,
): string | null {
  if (!regionCode) return null;
  if (!countryCode) return regionCode;
  if (normalizedCode(countryCode) === 'CO') {
    return resolveCustomerColombiaState(regionCode)?.name ?? regionCode;
  }
  return resolveCustomerWooState(countryCode, regionCode)?.name ?? regionCode;
}

export function resolveCustomerCityName(
  countryCode: string | null,
  regionCode: string | null,
  cityCode: string | null,
  cityName: string | null,
): string | null {
  if (normalizedCode(countryCode ?? '') !== 'CO') return cityName ?? cityCode;
  if (!regionCode || !cityCode) return cityName ?? cityCode;
  return resolveCustomerColombiaCity(regionCode, cityCode)?.name ?? cityName ?? cityCode;
}
