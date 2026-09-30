/**
 * Hora de Colombia. El país no aplica horario de verano, así que el huso es UTC-5 todo el año y
 * alcanza con un desplazamiento fijo para interpretar las fechas que las tiendas envían sin huso.
 */
export const bogotaTimeZone = 'America/Bogota';

const bogotaOffset = '-05:00';
const explicitOffset = /(?:Z|[+-]\d{2}:?\d{2})$/i;
const dateOnly = /^\d{4}-\d{2}-\d{2}$/;

/**
 * WooCommerce entrega sus fechas en la hora local de la tienda y sin huso horario
 * ("2026-09-24T14:19:59"). `new Date` las interpretaría con el huso del servidor, de modo que un
 * servidor en UTC guardaría una hora corrida cinco horas. Cuando la fecha no trae huso explícito se
 * asume la hora de Colombia. Devuelve null si el valor viene vacío o no es una fecha válida.
 */
export function parseBogotaDateTime(value: string): Date | null {
  const trimmed = value.trim();
  if (!trimmed) return null;

  const withTime = dateOnly.test(trimmed) ? `${trimmed}T00:00:00` : trimmed;
  const date = new Date(explicitOffset.test(withTime) ? withTime : `${withTime}${bogotaOffset}`);

  return Number.isNaN(date.getTime()) ? null : date;
}
