import countries, { isIso2 } from 'intl-tel-input/data';
import phoneUtils from 'intl-tel-input/utils';

export type SiigoPhone = { indicative: string; number: string };

function countryIso2(countryCode: string) {
  const iso2 = countryCode.trim().toLowerCase();
  return isIso2(iso2) ? iso2 : null;
}

export function normalizePhoneE164(phone: string, countryCode: string): string | null {
  const iso2 = countryIso2(countryCode);
  if (!iso2) return null;
  const formatted = phoneUtils.formatNumber(phone.trim(), iso2, 'E164');
  if (!/^\+[1-9]\d{6,14}$/.test(formatted)) return null;
  return phoneUtils.isValidNumber(formatted, iso2) ? formatted : null;
}

export function mapPhoneToSiigo(phone: string, countryCode: string): SiigoPhone | null {
  const iso2 = countryIso2(countryCode);
  const normalized = normalizePhoneE164(phone, countryCode);
  const country = iso2 ? countries.find((candidate) => candidate.iso2 === iso2) : null;
  if (!normalized || !country) return null;
  const prefix = `+${country.dialCode}`;
  if (!normalized.startsWith(prefix)) return null;
  const number = normalized.slice(prefix.length);
  if (!/^\d{4,15}$/.test(number)) return null;
  return { indicative: country.dialCode, number };
}
