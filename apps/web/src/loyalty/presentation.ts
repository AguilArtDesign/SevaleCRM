import type { PointsInvoiceRecord, PointsInvoiceStatus } from './api';

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
