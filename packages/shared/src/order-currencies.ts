/**
 * Las monedas en que se puede cobrar una operación. Cada una apunta al precio del producto que le
 * corresponde en el inventario: antes ese mapeo vivía en un ternario de cada servicio y olvidaba las
 * monedas nuevas al agregarlas.
 */
export const orderCurrencies = [
  {
    code: 'COP',
    label: 'Peso colombiano',
    flag: '/img/flags/CO.webp',
    priceField: 'wooPriceCop',
  },
  {
    code: 'USD',
    label: 'Dólar americano',
    flag: '/img/flags/US.webp',
    priceField: 'wooPriceUsd',
  },
  {
    code: 'MXN',
    label: 'Peso mexicano',
    flag: '/img/flags/MX.webp',
    priceField: 'wooPriceMxn',
  },
  {
    code: 'EUR',
    label: 'Euro',
    flag: '/img/flags/EU.webp',
    priceField: 'wooPriceEur',
  },
] as const;

export type OrderCurrency = (typeof orderCurrencies)[number]['code'];

/** Campo del producto que guarda su precio en esa moneda. */
export type OrderCurrencyPriceField = (typeof orderCurrencies)[number]['priceField'];

export function orderCurrency(code: string) {
  return orderCurrencies.find((currency) => currency.code === code) ?? null;
}

/**
 * Monedas extranjeras: las que Siigo cotiza como exportación sin IVA y para las que la cotización
 * necesita una tasa de cambio.
 */
export function isForeignOrderCurrency(code: string): boolean {
  return code !== 'COP';
}
