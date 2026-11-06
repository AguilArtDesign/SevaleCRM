/**
 * Valor de un punto en pesos al redimir. Es la regla que el comercial aplicaba a mano en la
 * calculadora del punto de venta (dividir entre 6), y no la de acumular, que suma un punto por cada
 * $1.000: son dos conversiones distintas y conviene no confundirlas.
 */
export const pointsRedemptionValueCop = 6;

/**
 * Mínimo que Puntos Colombia permite redimir en una operación. Por debajo de eso el proveedor rechaza
 * la transacción, así que se avisa antes de pedir el código.
 */
export const pointsRedemptionMinimum = 200;

/**
 * Puntos que hacen falta para pagar un importe. Se redondea **hacia arriba**, al contrario que la
 * acumulación: el cliente que pide $10.000 necesita 1667 puntos, y esos 1667 puntos valen $10.002.
 * Cobrar $10.000 con 1666 puntos dejaría un peso sin cubrir.
 */
export function pointsForRedemptionAmount(amount: number): number {
  if (!Number.isFinite(amount) || amount <= 0) return 0;
  return Math.ceil(amount / pointsRedemptionValueCop);
}

/** Lo que valen unos puntos al redimir. Es el importe que el comercial aplica en la factura. */
export function amountForRedemptionPoints(points: number): number {
  if (!Number.isFinite(points) || points <= 0) return 0;
  return Math.floor(points) * pointsRedemptionValueCop;
}

/**
 * Si la cantidad se puede redimir. Devuelve el motivo cuando no, para que la pantalla lo muestre
 * debajo de los campos: el mínimo del proveedor y el saldo del cliente son las dos únicas reglas.
 */
export function redemptionProblem(
  points: number,
  balance: number,
): 'BELOW_MINIMUM' | 'OVER_BALANCE' | null {
  if (!Number.isFinite(points) || points <= 0) return null;
  if (points < pointsRedemptionMinimum) return 'BELOW_MINIMUM';
  if (points > balance) return 'OVER_BALANCE';
  return null;
}
