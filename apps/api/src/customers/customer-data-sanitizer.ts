import {
  isSupportedCountry,
  parsePhoneNumberFromString,
  type CountryCode,
} from 'libphonenumber-js/max';
import { emailSchema } from '@sevale/validation';

type UnknownRecord = Record<string, unknown>;

export const INTERNAL_CUSTOMER_EMAIL_DOMAINS = new Set([
  'seratus.com.co',
  'pali.com.co',
  'joem.com.co',
  'sevale.com',
]);

const ADDRESS_PLACEHOLDERS = new Set([
  'no aplica',
  'n/a',
  'na',
  'sin direccion',
  'sin informacion',
  '-',
]);

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function compactWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, ' ');
}

function comparableText(value: string): string {
  return compactWhitespace(value)
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .toLocaleLowerCase('es');
}

function supportedCountry(countryCode: string): CountryCode | undefined {
  const normalized = countryCode.trim().toUpperCase();
  return isSupportedCountry(normalized) ? normalized : undefined;
}

function unknownArray(value: unknown): unknown[] {
  return Array.isArray(value) ? value.map((item: unknown) => item) : [];
}

function isZeroPlaceholder(value: string): boolean {
  const digits = value.replace(/\D/g, '');
  return Boolean(digits) && /^0+$/.test(digits);
}

function validE164(value: string, countryCode?: CountryCode): string | null {
  const parsed = parsePhoneNumberFromString(value, countryCode);
  return parsed?.isPossible() && parsed.isValid() ? parsed.number : null;
}

export function normalizeCustomerName(value: unknown): string | null {
  return typeof value === 'string' && compactWhitespace(value) ? compactWhitespace(value) : null;
}

export function normalizeCustomerPhone(
  value: string | null | undefined,
  countryCode: string | null | undefined,
): string | null {
  if (!value) return null;
  const normalized = compactWhitespace(value);
  if (!normalized || isZeroPlaceholder(normalized)) return null;
  return validE164(normalized, supportedCountry(countryCode ?? ''));
}

function normalizeSiigoPhoneCandidate(candidate: unknown, countryCode: string): string | null {
  if (!isRecord(candidate)) return null;
  const rawNumber = normalizeCustomerName(candidate.number);
  if (!rawNumber || isZeroPlaceholder(rawNumber)) return null;

  if (rawNumber.startsWith('+')) {
    const international = validE164(rawNumber);
    if (international) return international;
  }

  const number = rawNumber.replace(/\D/g, '');
  if (!number || /^0+$/.test(number)) return null;
  const indicative = normalizeCustomerName(candidate.indicative)?.replace(/\D/g, '') ?? '';
  if (indicative && !/^0+$/.test(indicative)) {
    const international = validE164(`+${indicative}${number}`);
    if (international) return international;
  }

  return validE164(number, supportedCountry(countryCode));
}

export function resolveSiigoPhone(value: unknown, countryCode: string): string | null {
  if (!isRecord(value)) return null;
  const primaryCandidates = unknownArray(value.phones);
  const contactCandidates = unknownArray(value.contacts).flatMap((contact) =>
    isRecord(contact) && isRecord(contact.phone) ? [contact.phone] : [],
  );

  for (const candidate of [...primaryCandidates, ...contactCandidates]) {
    const normalized = normalizeSiigoPhoneCandidate(candidate, countryCode);
    if (normalized) return normalized;
  }
  return null;
}

export function sanitizeCustomerEmail(value: unknown): string | null {
  const candidate = normalizeCustomerName(value);
  if (!candidate) return null;
  const parsed = emailSchema.safeParse(candidate);
  if (!parsed.success) return null;
  const domain = parsed.data.slice(parsed.data.lastIndexOf('@') + 1);
  return INTERNAL_CUSTOMER_EMAIL_DOMAINS.has(domain) ? null : parsed.data;
}

export function sanitizePostalCode(value: unknown): string | null {
  const candidate = normalizeCustomerName(value);
  if (!candidate || isZeroPlaceholder(candidate)) return null;
  return candidate;
}

export function sanitizeSiigoAddress(value: unknown): string | null {
  const candidate = normalizeCustomerName(value);
  if (!candidate || ADDRESS_PLACEHOLDERS.has(comparableText(candidate))) return null;
  return candidate;
}
