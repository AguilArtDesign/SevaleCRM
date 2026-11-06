import type { PointsInvoiceRecord, PointsInvoiceStatus, PointsRedemptionStatus } from './api';

export const statusMeta: Record<
  PointsInvoiceStatus,
  { label: string; color: 'default' | 'warning' | 'success' | 'danger' }
> = {
  PENDING: { label: 'Pendiente', color: 'warning' },
  PROCESSING: { label: 'Procesando', color: 'warning' },
  COMPLETED: { label: 'Completado', color: 'success' },
  FAILED: { label: 'Fallido', color: 'danger' },
  // Ambiguo: no se sabe si el proveedor acreditó, así que no se reintenta a ciegas.
  UNVERIFIED: { label: 'Por verificar', color: 'danger' },
  // Los puntos siguen acreditados: si la anulación falla, la factura vuelve a Completado.
  REVOKING: { label: 'Revocando', color: 'warning' },
  REVOKED: { label: 'Revocado', color: 'default' },
};

/**
 * Estado de una redención. `PENDING_INVOICE` es el normal al terminar: los puntos ya salieron de la
 * cuenta del cliente y falta la factura que documenta la venta.
 */
export const redemptionStatusMeta: Record<
  PointsRedemptionStatus,
  { label: string; color: 'default' | 'warning' | 'success' | 'danger' }
> = {
  PROCESSING: { label: 'Redimiendo', color: 'warning' },
  PENDING_INVOICE: { label: 'Por facturar', color: 'warning' },
  COMPLETED: { label: 'Completado', color: 'success' },
  FAILED: { label: 'Fallido', color: 'danger' },
  UNVERIFIED: { label: 'Por verificar', color: 'danger' },
};

/** Una redención solo se puede facturar mientras no tenga factura. */
export function canAttachInvoice(redemption: { status: PointsRedemptionStatus }) {
  return redemption.status === 'PENDING_INVOICE';
}
/** Solo los estados sin acumulación confirmada permiten operar la factura. */
export function canAccrue(invoice: PointsInvoiceRecord) {
  return invoice.status === 'PENDING' || invoice.status === 'FAILED';
}

/**
 * Anular solo tiene sentido sobre puntos acreditados. Un intento de anulación que quedó fallido se
 * puede repetir; uno ambiguo, no: repetir podría anular una operación que ya se anuló.
 */
export function canRevoke(invoice: PointsInvoiceRecord) {
  if (invoice.status !== 'COMPLETED') return false;
  const status = invoice.accrual?.revocationStatus;
  return status === null || status === undefined || status === 'FAILED';
}

/**
 * Quitar la factura del panel.
 *
 * Una de prueba se puede quitar siempre: existe para ensayar la acumulación y hay que poder retirarla
 * al terminar el ensayo, incluso si quedó completada o por verificar.
 *
 * Una de Siigo solo mientras no se haya operado en Puntos Colombia. Es el caso del registro
 * equivocado: si no se borra, la tabla acumula facturas que nadie va a usar. Las que ya tienen
 * puntos —acreditados o devueltos— o un intento sin conciliar conservan su rastro y no se tocan. La
 * regla se repite en el backend, que es quien la aplica.
 */
export function canDelete(invoice: PointsInvoiceRecord) {
  if (invoice.source === 'UAT_SEED') return true;
  if (invoice.status !== 'PENDING' && invoice.status !== 'FAILED') return false;
  const accrual = invoice.accrual?.status;
  return accrual !== 'COMPLETED' && accrual !== 'PROCESSING' && accrual !== 'UNVERIFIED';
}

/** Fecha de factura tal como llega (`YYYY-MM-DD`), sin pasar por la zona del navegador. */
export function invoiceDate(value: string) {
  const [year, month, day] = value.slice(0, 10).split('-');
  return `${day}/${month}/${year}`;
}

/** Marca de tiempo real (la de la acumulación): se muestra en la zona del navegador. */
export function accrualTimestamp(value: string) {
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'short', timeStyle: 'short' }).format(
    new Date(value),
  );
}
