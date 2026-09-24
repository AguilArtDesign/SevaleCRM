/**
 * Reparto del envío de una operación entre las tiendas que tienen productos.
 *
 * El envío pertenece a la operación, no a una tienda: se divide en partes iguales y la última absorbe
 * el resto de los centavos (mismo criterio que el descuento entre las líneas), de modo que la suma
 * coincida siempre con el total de la operación. Con una sola tienda, esa asume el valor completo.
 *
 * Se trabaja en centavos para que el reparto sea exacto y lo compartan el CRM y el formulario del
 * panel, que deben mostrar el mismo valor por tienda.
 */
export function toShippingCents(value: number): number {
  return Math.round(Number.isFinite(value) ? value * 100 : 0);
}

export function splitShippingCents(totalCents: number, stores: number): number[] {
  if (stores <= 0 || totalCents <= 0) return [];
  const shareCents = Math.round(totalCents / stores);
  const shares: number[] = [];
  let assigned = 0;
  for (let index = 1; index <= stores; index += 1) {
    const cents = index === stores ? totalCents - assigned : shareCents;
    assigned += cents;
    shares.push(cents);
  }
  return shares;
}
