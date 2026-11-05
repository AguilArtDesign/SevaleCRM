import { bogotaTimeZone } from '@sevale/shared';
import { closedQuotationFrom } from './siigo-quotation-input.js';

/** La fecha de un instante en hora de Bogotá, en el formato que se compara y se guarda. */
function bogotaDate(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: bogotaTimeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((result, part) => {
      if (part.type !== 'literal') result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

/**
 * Fecha desde la cual se puede reabrir un pedido que la tienda cerró.
 *
 * El corte existe por lo mismo que el de las cotizaciones: los pedidos anteriores ya son historia y
 * nadie los va a retomar. Toma la misma fecha que `SIIGO_QUOTATION_CLOSED_FROM` para que las dos
 * reglas coincidan sin configurar nada, y `ORDERS_REOPEN_FROM` permite moverla por separado cuando
 * las dos cosas dejen de ir de la mano.
 *
 * Se lee del entorno en cada consulta, como el corte de las cotizaciones, para poder ajustarla sin
 * desplegar código.
 */
export function reopenFrom(): string {
  const value = (process.env.ORDERS_REOPEN_FROM ?? '').trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) return value;
  return closedQuotationFrom();
}

/** El corte como se lee en el panel: `03/11/2026`. */
export function formattedReopenFrom(): string {
  const [year, month, day] = reopenFrom().split('-');
  return `${day}/${month}/${year}`;
}

/**
 * Si un pedido entra en la ventana de reapertura. La fecha que manda es la del pedido en la tienda
 * —la que muestra la columna Fecha— y, mientras no exista allá, la del CRM.
 */
export function reopenableOrder(orderDate: Date | null | undefined): boolean {
  if (!orderDate) return false;
  return bogotaDate(orderDate) >= reopenFrom();
}
