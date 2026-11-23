import { describePointsError } from '@sevale/shared';
import type { PointsRedemptionRecord } from './points-redemptions.repository.js';

/**
 * Cómo se ve una redención en el panel. Vive aparte de los servicios porque los dos la necesitan: el
 * de redenciones para responder a sus propias acciones y el de facturas para armar el listado unido,
 * y hacer que se importen entre sí crearía un ciclo.
 *
 * `diagnosis` solo se calcula para el administrador: es la traducción del error del proveedor a causa
 * y acción, y el comercial no la necesita para hacer su trabajo.
 */
export function serializeRedemption(
  redemption: PointsRedemptionRecord,
  options: { diagnosis?: boolean } = {},
) {
  return {
    id: redemption.id,
    /** `MIXED` lo pinta la tabla como «Pago Mixto»; `REDEMPTION` conserva la fila de siempre. */
    type: redemption.type,
    documentNumber: redemption.documentNumber,
    documentType: redemption.documentType,
    customerName: redemption.customerName,
    pointsRequested: redemption.pointsRequested,
    pointsRedeemed: redemption.pointsRedeemed,
    /** Puntos acreditados por la parte pagada en dinero. Solo lo trae un pago mixto. */
    pointsEarned: redemption.pointsEarned,
    pointsBalance: redemption.pointsBalance,
    amountCop: redemption.amountCop.toFixed(2),
    /** Total de la venta y parte pagada con dinero. Solo lo trae un pago mixto. */
    saleTotalCop: redemption.saleTotalCop?.toFixed(2) ?? null,
    cashAmountCop: redemption.cashAmountCop?.toFixed(2) ?? null,
    approbationNumber: redemption.approbationNumber,
    validationMethod: redemption.validationMethod,
    status: redemption.status,
    errorCode: redemption.errorCode,
    /**
     * Al comercial le llega un texto corto según el estado; el detalle del proveedor se queda en la
     * fila y es lo que el administrador ve en el diagnóstico.
     */
    errorMessage: options.diagnosis ? redemption.errorMessage : shortRedemptionFailure(redemption),
    diagnosis: options.diagnosis
      ? describePointsError({
          code: redemption.errorCode,
          message: redemption.errorMessage,
          service: 'Redención',
        })
      : null,
    invoice: redemption.invoiceName
      ? {
          name: redemption.invoiceName,
          date: redemption.invoiceDate?.toISOString().slice(0, 10) ?? null,
          total: redemption.invoiceTotal?.toFixed(2) ?? null,
        }
      : null,
    completedAt: redemption.completedAt,
    createdBy: redemption.createdBy,
    createdAt: redemption.createdAt,
    /** Anulación de la redención. Nula mientras nadie la haya intentado. */
    revocationStatus: redemption.revocationStatus,
    revocationErrorCode: redemption.revocationErrorCode,
    revocationErrorMessage: options.diagnosis
      ? redemption.revocationErrorMessage
      : shortRevocationFailure(redemption),
    revocationDiagnosis: options.diagnosis
      ? describePointsError({
          code: redemption.revocationErrorCode,
          message: redemption.revocationErrorMessage,
          service: 'Redención',
        })
      : null,
    revokedAt: redemption.revokedAt,
    /**
     * Identificador exacto que viajó al proveedor. Es lo que se le entrega a Puntos Colombia para
     * conciliar un resultado ambiguo, así que solo lo ve el administrador.
     */
    transactionIdentifier: options.diagnosis ? redemption.transactionIdentifier : null,
    /** Cómo se resolvió a mano un resultado ambiguo. Nula si nunca hizo falta conciliar. */
    reconciliation:
      options.diagnosis && redemption.reconciliationOutcome
        ? {
            outcome: redemption.reconciliationOutcome,
            note: redemption.reconciliationNote,
            reconciledAt: redemption.reconciledAt,
            reconciledBy: redemption.reconciledBy,
          }
        : null,
  };
}

function shortRedemptionFailure(redemption: {
  errorCode: string | null;
  status: string;
}): string | null {
  if (!redemption.errorCode) return null;
  return redemption.status === 'UNVERIFIED'
    ? 'No se pudo confirmar la redención.'
    : 'No se pudo redimir.';
}

function shortRevocationFailure(redemption: {
  revocationErrorCode: string | null;
  revocationStatus: string | null;
}): string | null {
  if (!redemption.revocationErrorCode) return null;
  return redemption.revocationStatus === 'UNVERIFIED'
    ? 'No se pudo confirmar la anulación.'
    : 'No se pudo anular los puntos.';
}
