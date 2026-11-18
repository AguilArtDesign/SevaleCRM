import type { Prisma } from '../generated/prisma/client.js';

/**
 * Un `Decimal` nulo del cliente de Prisma se convierte a `null`, no a 0: `Number(null)` daría 0 y
 * un producto sin precio parecería tenerlo.
 */
export function decimalOrNull(value: Prisma.Decimal | null | undefined): number | null {
  return value === null || value === undefined ? null : Number(value);
}

/**
 * Dos precios son iguales cuando coinciden, o cuando ninguno de los dos existe. Un nulo contra un
 * número es una diferencia real: la moneda está publicada en un lado y no en el otro.
 */
export function samePrice(left: number | null, right: number | null): boolean {
  return left === right;
}

/** Cambio entre dos valores, o null cuando son iguales. Se usa para los eventos de realtime. */
export function numericChange(
  previous: number,
  current: number,
): { previous: number; current: number } | null;
export function numericChange(
  previous: number | null,
  current: number | null,
): { previous: number | null; current: number | null } | null;
export function numericChange(previous: number | null, current: number | null) {
  return previous === current ? null : { previous, current };
}

export type ProductPriceSet = {
  priceCop: number | null;
  priceUsd: number | null;
  priceMxn: number | null;
  priceEur: number | null;
};

/** El producto está sincronizado cuando las cuatro monedas y el stock coinciden en ambos lados. */
export function pricesAndStockMatch(
  siigo: ProductPriceSet,
  store: ProductPriceSet,
  siigoStock: number | null,
  storeStock: number | null,
): boolean {
  return (
    samePrice(siigo.priceCop, store.priceCop) &&
    samePrice(siigo.priceUsd, store.priceUsd) &&
    samePrice(siigo.priceMxn, store.priceMxn) &&
    samePrice(siigo.priceEur, store.priceEur) &&
    siigoStock === storeStock
  );
}
