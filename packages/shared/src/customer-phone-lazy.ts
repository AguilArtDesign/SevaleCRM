/**
 * Variantes diferidas del formateo de teléfono, solo para el navegador.
 *
 * `customer-phone.ts` importa `intl-tel-input` de forma estática y esa librería aporta unos 270 kB al
 * paquete inicial, además de anular las cargas diferidas que ya hacían el selector de teléfono y el
 * listado de clientes. Aquí se carga en cuanto hay un teléfono que formatear o validar.
 *
 * Las dos versiones siguen la misma secuencia, así que devuelven el mismo resultado.
 */
const E164 = /^\+[1-9]\d{6,14}$/;

async function loadPhoneTools() {
  const [{ default: phoneUtils }, { isIso2 }] = await Promise.all([
    import('intl-tel-input/utils'),
    import('intl-tel-input/data'),
  ]);

  return { phoneUtils, isIso2 };
}

export async function normalizePhoneE164Lazy(
  phone: string,
  countryCode: string,
): Promise<string | null> {
  const iso2 = countryCode.trim().toLowerCase();
  if (!iso2 || !phone.trim()) return null;

  const { phoneUtils, isIso2 } = await loadPhoneTools();
  if (!isIso2(iso2)) return null;

  const formatted = phoneUtils.formatNumber(phone.trim(), iso2, 'E164');
  if (!E164.test(formatted)) return null;

  return phoneUtils.isValidNumber(formatted, iso2) ? formatted : null;
}

export async function formatPhoneInternationalLazy(
  phone: string,
  countryCode: string,
): Promise<string | null> {
  const normalized = await normalizePhoneE164Lazy(phone, countryCode);
  if (!normalized) return null;

  const { phoneUtils } = await loadPhoneTools();
  const iso2 = countryCode.trim().toLowerCase();

  return phoneUtils.formatNumber(normalized, iso2, 'INTERNATIONAL') || null;
}
