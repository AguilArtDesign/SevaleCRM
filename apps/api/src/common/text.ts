/**
 * Normaliza un texto para compararlo contra un catálogo: sin acentos, sin mayúsculas y con los
 * separadores colapsados. Sirve para que «Cédula de ciudadanía», «cedula de ciudadania» y
 * «CÉDULA  DE  CIUDADANÍA» sean el mismo valor sin tener que enumerar variantes.
 *
 * No traduce sinónimos: solo iguala la forma de escribir lo mismo.
 */
export function normalizeComparableText(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}
