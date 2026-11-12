export type InventoryCurrencyCode = 'COP' | 'USD' | 'MXN' | 'EUR';
export type InventoryPriceKey = 'priceCop' | 'priceUsd' | 'priceMxn' | 'priceEur';

/**
 * Las cuatro monedas del inventario. Cada una lleva su símbolo porque el euro no se escribe con
 * «$», y su bandera: la de la Unión Europea vive en el catálogo junto a las de los países.
 */
export const inventoryCurrencies: ReadonlyArray<{
  code: InventoryCurrencyCode;
  key: InventoryPriceKey;
  label: string;
  symbol: string;
  flag: string;
}> = [
  {
    code: 'COP',
    key: 'priceCop',
    label: 'Peso colombiano',
    symbol: '$',
    flag: '/img/flags/CO.webp',
  },
  {
    code: 'USD',
    key: 'priceUsd',
    label: 'Dólar estadounidense',
    symbol: '$',
    flag: '/img/flags/US.webp',
  },
  { code: 'MXN', key: 'priceMxn', label: 'Peso mexicano', symbol: '$', flag: '/img/flags/MX.webp' },
  { code: 'EUR', key: 'priceEur', label: 'Euro', symbol: '€', flag: '/img/flags/EU.webp' },
];

const amountFormat = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });

/** Importe con el símbolo de su moneda. Nulo cuando la moneda todavía no existe en el producto. */
export function formatCurrencyPrice(
  value: number | null,
  code: InventoryCurrencyCode,
): string | null {
  if (value === null) return null;
  const currency = inventoryCurrencies.find((item) => item.code === code);
  return `${currency?.symbol ?? ''}${amountFormat.format(value)}`;
}
