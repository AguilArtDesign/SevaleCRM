import type { PointsRedemptionRecord } from './points-redemptions.repository.js';

/**
 * Cómo se ve una redención en el panel. Vive aparte de los servicios porque los dos la necesitan: el
 * de redenciones para responder a sus propias acciones y el de facturas para armar el listado unido,
 * y hacer que se importen entre sí crearía un ciclo.
 */
export function serializeRedemption(redemption: PointsRedemptionRecord) {
  return {
    id: redemption.id,
    documentNumber: redemption.documentNumber,
    documentType: redemption.documentType,
    customerName: redemption.customerName,
    pointsRequested: redemption.pointsRequested,
    pointsRedeemed: redemption.pointsRedeemed,
    pointsBalance: redemption.pointsBalance,
    amountCop: redemption.amountCop.toFixed(2),
    approbationNumber: redemption.approbationNumber,
    validationMethod: redemption.validationMethod,
    status: redemption.status,
    errorCode: redemption.errorCode,
    errorMessage: redemption.errorMessage,
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
  };
}
