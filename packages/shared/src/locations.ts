import catalogJson from './locations.json' with { type: 'json' };

export type LocationState = {
  name: string;
  wooCode: string | null;
  cities: Record<string, string>;
};

export type LocationCountry = {
  name: string;
  siigoCode: string | null;
  states: Record<string, LocationState>;
};

export type LocationCatalog = Record<string, LocationCountry>;

export type CountryOption = {
  code: string;
  name: string;
  siigoCode: string | null;
};

export type StateOption = {
  code: string;
  name: string;
  wooCode: string | null;
};

export type CityOption = { code: string; name: string };
export type CityMatch = { country: string; cityCode: string };

const catalog = catalogJson as LocationCatalog;
const byName = new Intl.Collator('es', { sensitivity: 'base' });

function normalizedCode(value: string): string {
  return value.trim().toUpperCase();
}

export function getCountries(): CountryOption[] {
  return Object.entries(catalog)
    .map(([code, country]) => ({ code, name: country.name, siigoCode: country.siigoCode }))
    .sort((first, second) => byName.compare(first.name, second.name));
}

export function resolveCountry(countryCode: string): LocationCountry | null {
  return catalog[normalizedCode(countryCode)] ?? null;
}

export function getStates(countryCode: string): StateOption[] {
  const country = resolveCountry(countryCode);
  if (!country) return [];
  return Object.entries(country.states)
    .map(([code, state]) => ({ code, name: state.name, wooCode: state.wooCode }))
    .sort((first, second) => byName.compare(first.name, second.name));
}

export function resolveState(countryCode: string, regionCode: string): LocationState | null {
  const country = resolveCountry(countryCode);
  if (!country) return null;
  const normalizedRegion = normalizedCode(regionCode);
  return (
    Object.values(country.states).find(
      (state) => normalizedCode(state.wooCode ?? '') === normalizedRegion,
    ) ??
    country.states[regionCode.trim()] ??
    null
  );
}

export function getCities(countryCode: string, regionCode: string): CityOption[] {
  const state = resolveState(countryCode, regionCode);
  if (!state) return [];
  return Object.entries(state.cities)
    .map(([code, name]) => ({ code, name }))
    .sort((first, second) => byName.compare(first.name, second.name));
}

export function resolveCity(
  countryCode: string,
  regionCode: string,
  cityCode: string,
): string | null {
  return resolveState(countryCode, regionCode)?.cities[cityCode.trim()] ?? null;
}

export function mapLocationToWoo(countryCode: string, regionCode: string, cityCode: string) {
  const country = normalizedCode(countryCode);
  const state = resolveState(country, regionCode);
  const city = resolveCity(country, regionCode, cityCode);
  if (!resolveCountry(country) || !state?.wooCode || !city) return null;
  return { country, state: state.wooCode, city };
}

export function mapLocationToSiigo(countryCode: string, regionCode: string, cityCode: string) {
  const country = resolveCountry(countryCode);
  const state = resolveState(countryCode, regionCode);
  const normalizedCity = cityCode.trim();
  if (!country?.siigoCode || !state?.cities[normalizedCity]) return null;
  const stateCode = Object.entries(country.states).find(
    ([, candidate]) => candidate === state,
  )?.[0];
  if (!stateCode) return null;
  return { countryCode: country.siigoCode, stateCode, cityCode: normalizedCity };
}

export function resolveLocationFromSiigo(
  siigoCountryCode: string,
  siigoStateCode: string,
  cityCode: string,
) {
  const normalizedCountry = normalizedCode(siigoCountryCode);
  const countryEntry = Object.entries(catalog).find(
    ([, country]) => normalizedCode(country.siigoCode ?? '') === normalizedCountry,
  );
  if (!countryEntry) return null;
  const [countryCode, country] = countryEntry;
  const stateCode = siigoStateCode.trim();
  const state = country.states[stateCode];
  const normalizedCity = cityCode.trim();
  if (!state?.cities[normalizedCity]) return null;
  return {
    country: countryCode,
    region: state.wooCode ?? stateCode,
    cityCode: normalizedCity,
  };
}

export function resolveLocationFromWoo(
  wooCountryCode: string,
  wooStateCode: string,
  cityName: string,
) {
  const countryCode = normalizedCode(wooCountryCode);
  const country = resolveCountry(countryCode);
  const normalizedState = normalizedCode(wooStateCode);
  const state = country
    ? (resolveState(countryCode, normalizedState) ??
      resolveState(countryCode, `${countryCode}-${normalizedState}`))
    : null;
  if (!country || !state) return null;
  const stateCode = Object.entries(country.states).find(
    ([, candidate]) => candidate === state,
  )?.[0];
  if (!stateCode) return null;
  const city = getCities(countryCode, stateCode).find(
    ({ name }) => name.localeCompare(cityName.trim(), 'es', { sensitivity: 'base' }) === 0,
  );
  return {
    country: countryCode,
    region: state.wooCode ?? stateCode,
    cityCode: city?.code ?? null,
  };
}

export function countryFlagPath(countryCode: string): string {
  return `/img/flags/${normalizedCode(countryCode)}.webp`;
}

function normalizedSearch(value: string): string {
  return value
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es')
    .trim();
}

export function findCitiesByName(search: string, countryCode?: string): CityMatch[] {
  const term = normalizedSearch(search);
  if (!term) return [];
  const countries = countryCode
    ? [[normalizedCode(countryCode), resolveCountry(countryCode)] as const]
    : Object.entries(catalog);
  const matches: CityMatch[] = [];
  for (const [countryCodeKey, country] of countries) {
    if (!country) continue;
    for (const state of Object.values(country.states)) {
      for (const [code, name] of Object.entries(state.cities)) {
        if (normalizedSearch(name).includes(term)) {
          matches.push({ country: countryCodeKey, cityCode: code });
        }
      }
    }
  }
  return matches;
}
