import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

const redemptionInclude = {
  createdBy: { select: { id: true, name: true, email: true } },
} as const;

export type PointsRedemptionRecord = Prisma.PointsRedemptionGetPayload<{
  include: typeof redemptionInclude;
}>;

/** Datos con los que se abre el intento, antes de hablar con el proveedor. */
export type NewPointsRedemption = {
  documentNumber: string;
  documentType: string;
  customerName: string | null;
  pointsRequested: number;
  amountCop: Prisma.Decimal;
  validationMethod: string | null;
  transactionIdentifier: Prisma.InputJsonValue;
  createdByUserId: string;
};

/**
 * Lo que se aplicó en el proveedor. Se guarda por separado del intento porque lo que manda es lo que
 * el proveedor dice haber quemado, no lo que se le pidió.
 */
export type PointsRedemptionApplied = {
  pointsRedeemed: number;
  pointsBalance: number;
  approbationNumber: string | null;
};

/** El estado al que vuelve la redención si la anulación falla: el que tenía antes de reclamarla. */
export type PointsRedemptionRevocableStatus = 'PENDING_INVOICE' | 'COMPLETED';

/**
 * Resultado de reclamar una anulación. `ALREADY_REVOKED` e `IN_PROGRESS` no son errores de datos:
 * describen por qué no se puede volver a pedir, y el servicio los convierte en un mensaje.
 */
export type PointsRedemptionRevocationClaim =
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'NOT_REDEEMED' }
  | { outcome: 'ALREADY_REVOKED' }
  | { outcome: 'IN_PROGRESS' }
  | { outcome: 'UNVERIFIED' }
  | { outcome: 'CLAIMED'; previousStatus: PointsRedemptionRevocableStatus };

@Injectable()
export class PointsRedemptionsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Abre el intento antes de llamar al proveedor. Es lo que permite conciliar después: si la
   * respuesta se pierde, el identificador que viajó queda guardado y no hay que inventar otro.
   */
  create(input: NewPointsRedemption) {
    return this.prisma.pointsRedemption.create({
      data: { ...input, status: 'PROCESSING' },
      include: redemptionInclude,
    });
  }

  /**
   * Los puntos se quemaron. Queda pendiente de factura: la venta que los documenta todavía no existe
   * porque el comercial la emite en el punto de venta después de redimir.
   */
  markApplied(id: number, applied: PointsRedemptionApplied) {
    return this.prisma.pointsRedemption.update({
      where: { id },
      data: {
        status: 'PENDING_INVOICE',
        pointsRedeemed: applied.pointsRedeemed,
        pointsBalance: applied.pointsBalance,
        approbationNumber: applied.approbationNumber,
        completedAt: new Date(),
        errorCode: null,
        errorMessage: null,
      },
      include: redemptionInclude,
    });
  }

  /** El proveedor rechazó la redención: no se quemó nada, así que se puede intentar de nuevo. */
  markFailed(id: number, code: string, message: string) {
    return this.prisma.pointsRedemption.update({
      where: { id },
      data: { status: 'FAILED', errorCode: code, errorMessage: message },
      include: redemptionInclude,
    });
  }

  /**
   * No se sabe si el proveedor quemó los puntos. Se bloquea el reintento hasta conciliar: repetir con
   * otro identificador podría quitarle puntos dos veces al cliente.
   */
  markUnverified(id: number, code: string, message: string) {
    return this.prisma.pointsRedemption.update({
      where: { id },
      data: { status: 'UNVERIFIED', errorCode: code, errorMessage: message },
      include: redemptionInclude,
    });
  }

  /**
   * Filas de la página en curso, para el listado unido del panel. Se traen las primeras `take` de
   * cada tabla y se mezclan en memoria: el panel alterna acumulaciones y redenciones, así que la
   * página no se puede pedir a una sola tabla. `take` es la página pedida por el tamaño, de modo que
   * el costo crece con la página y no con el histórico.
   */
  listSlice(where: Prisma.PointsRedemptionWhereInput, take: number) {
    return this.prisma.pointsRedemption.findMany({
      where,
      include: redemptionInclude,
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take,
    });
  }

  count(where: Prisma.PointsRedemptionWhereInput) {
    return this.prisma.pointsRedemption.count({ where });
  }

  find(id: number) {
    return this.prisma.pointsRedemption.findUnique({ where: { id }, include: redemptionInclude });
  }

  /**
   * Asocia la factura de Siigo que documenta la venta. Solo se hace sobre una redención con los
   * puntos ya quemados: una fallida no tiene nada que facturar.
   */
  attachInvoice(
    id: number,
    invoice: {
      siigoInvoiceId: string | null;
      invoiceName: string;
      invoiceDate: Date;
      invoiceTotal: Prisma.Decimal;
    },
  ) {
    return this.prisma.pointsRedemption.update({
      where: { id },
      data: {
        status: 'COMPLETED',
        siigoInvoiceId: invoice.siigoInvoiceId,
        invoiceName: invoice.invoiceName,
        invoiceDate: invoice.invoiceDate,
        invoiceTotal: invoice.invoiceTotal,
      },
      include: redemptionInclude,
    });
  }

  /**
   * Reclama la anulación de una redención. Igual que en la acumulación, el paso a `REVOKING` es
   * único y ocurre en una transacción: dos peticiones simultáneas no pueden devolver los puntos dos
   * veces. La redención sale de los estados operables al reclamarse, así que la tabla deja de
   * ofrecer la acción mientras el proveedor responde.
   */
  claimRevocation(
    id: number,
    userId: string,
    identifier: Prisma.InputJsonValue,
  ): Promise<PointsRedemptionRevocationClaim> {
    return this.prisma.$transaction(async (transaction) => {
      const redemption = await transaction.pointsRedemption.findUnique({
        where: { id },
        select: { status: true, revocationStatus: true, invoiceName: true },
      });
      if (!redemption) return { outcome: 'NOT_FOUND' };
      if (redemption.status === 'REVOKED') return { outcome: 'ALREADY_REVOKED' };
      if (redemption.status === 'REVOKING') return { outcome: 'IN_PROGRESS' };
      // Solo se anula lo que quemó puntos: una redención fallida no descontó nada al cliente.
      if (redemption.status !== 'PENDING_INVOICE' && redemption.status !== 'COMPLETED') {
        return { outcome: 'NOT_REDEEMED' };
      }
      if (redemption.revocationStatus === 'COMPLETED') return { outcome: 'ALREADY_REVOKED' };
      // Tras un resultado ambiguo no se reenvía: repetir podría devolver los puntos dos veces.
      if (redemption.revocationStatus === 'UNVERIFIED') return { outcome: 'UNVERIFIED' };

      const previousStatus = redemption.status;
      const claimed = await transaction.pointsRedemption.updateMany({
        where: {
          id,
          status: { in: ['PENDING_INVOICE', 'COMPLETED'] },
          OR: [{ revocationStatus: null }, { revocationStatus: 'FAILED' }],
        },
        data: {
          status: 'REVOKING',
          revocationStatus: 'PROCESSING',
          revocationIdentifier: identifier,
          revokedByUserId: userId,
          revocationErrorCode: null,
          revocationErrorMessage: null,
        },
      });
      if (claimed.count !== 1) return { outcome: 'IN_PROGRESS' };

      return { outcome: 'CLAIMED', previousStatus };
    });
  }

  /** El proveedor anuló la redención: los puntos volvieron al cliente. */
  markRevoked(id: number) {
    return this.prisma.pointsRedemption.update({
      where: { id },
      data: {
        status: 'REVOKED',
        revocationStatus: 'COMPLETED',
        revokedAt: new Date(),
        revocationErrorCode: null,
        revocationErrorMessage: null,
      },
      include: redemptionInclude,
    });
  }

  /**
   * Una anulación fallida no deshace nada: los puntos siguen gastados y la factura asociada sigue
   * siendo válida, así que la redención vuelve al estado que tenía y el error se guarda solo en el
   * intento de anulación.
   */
  markRevocationFailed(
    id: number,
    previousStatus: 'PENDING_INVOICE' | 'COMPLETED',
    code: string,
    message: string,
    unverified: boolean,
  ) {
    return this.prisma.pointsRedemption.update({
      where: { id },
      data: {
        status: previousStatus,
        revocationStatus: unverified ? 'UNVERIFIED' : 'FAILED',
        revocationErrorCode: code,
        revocationErrorMessage: message,
      },
      include: redemptionInclude,
    });
  }
}
