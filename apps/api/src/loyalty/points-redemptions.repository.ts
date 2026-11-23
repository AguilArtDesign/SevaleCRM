import { Injectable } from '@nestjs/common';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

const redemptionInclude = {
  createdBy: { select: { id: true, name: true, email: true } },
  reconciledBy: { select: { id: true, name: true } },
} as const;

export type PointsRedemptionRecord = Prisma.PointsRedemptionGetPayload<{
  include: typeof redemptionInclude;
}>;

/** Datos con los que se abre el intento, antes de hablar con el proveedor. */
export type NewPointsRedemption = {
  /** `MIXED` es el pago mixto; las redenciones que ya existían quedan en el valor por defecto. */
  type?: 'REDEMPTION' | 'MIXED';
  documentNumber: string;
  documentType: string;
  customerName: string | null;
  pointsRequested: number;
  amountCop: Prisma.Decimal;
  /** Solo en `MIXED`: total de la venta y parte pagada con dinero. */
  saleTotalCop?: Prisma.Decimal;
  cashAmountCop?: Prisma.Decimal;
  validationMethod: string | null;
  transactionIdentifier: Prisma.InputJsonValue;
  createdByUserId: string;
};

/**
 * Lo que se aplicó en el proveedor. Se guarda por separado del intento porque lo que manda es lo que
 * el proveedor dice haber quemado, no lo que se le pidió. `pointsEarned` solo llega en un pago mixto.
 */
export type PointsRedemptionApplied = {
  pointsRedeemed: number;
  pointsEarned?: number;
  pointsBalance: number;
  approbationNumber: string | null;
};

/**
 * Resultado de abrir un pago mixto. La comprobación de operaciones abiertas viaja en la misma
 * transacción que la creación: un doble clic o un reintento tras un resultado incierto no puede
 * abrir una segunda transacción para el mismo documento.
 */
export type PointsMixedCreation =
  | { outcome: 'IN_PROGRESS' }
  | { outcome: 'UNVERIFIED' }
  | { outcome: 'CREATED'; redemption: PointsRedemptionRecord };

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

/** Resultado de borrar una redención del panel. `NOT_DELETABLE` significa que hay algo por conciliar. */
export type PointsRedemptionRemoval =
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'NOT_DELETABLE' }
  | { outcome: 'DELETED'; documentNumber: string };

/**
 * Resolución manual de un resultado ambiguo. `APPLIED` deja la redención pendiente de factura;
 * `NOT_APPLIED` la deja fallida, que es lo que habilita reintentar o quitarla del panel.
 */
export type PointsRedemptionReconciliation = {
  outcome: 'APPLIED' | 'NOT_APPLIED';
  note: string;
  approbationNumber: string | null;
  userId: string;
};

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
   * Abre un pago mixto solo si ese documento no tiene ya una operación mixta en curso o por
   * verificar. Es la barrera del servidor contra el doble clic y contra reintentar a ciegas un
   * resultado ambiguo: repetir la llamada podría quemar y acreditar puntos dos veces.
   */
  createMixed(input: NewPointsRedemption): Promise<PointsMixedCreation> {
    return this.prisma.$transaction(async (transaction) => {
      const open = await transaction.pointsRedemption.findFirst({
        where: {
          type: 'MIXED',
          documentNumber: input.documentNumber,
          documentType: input.documentType,
          status: { in: ['PROCESSING', 'UNVERIFIED'] },
        },
        orderBy: { id: 'desc' },
        select: { status: true },
      });
      if (open) {
        return { outcome: open.status === 'UNVERIFIED' ? 'UNVERIFIED' : 'IN_PROGRESS' } as const;
      }

      const redemption = await transaction.pointsRedemption.create({
        data: { ...input, status: 'PROCESSING' },
        include: redemptionInclude,
      });
      return { outcome: 'CREATED' as const, redemption };
    });
  }

  /**
   * Retira un intento que el proveedor rechazó de forma definitiva. No movió puntos, así que no hay
   * nada que conciliar y el panel no necesita mostrarlo: el detalle queda en el log de integraciones.
   * El `status` en el `where` evita borrar una fila que haya cambiado de estado.
   */
  discardRedemption(id: number) {
    return this.prisma.pointsRedemption.deleteMany({
      where: { id, type: 'REDEMPTION', status: 'PROCESSING' },
    });
  }

  discardMixed(id: number) {
    return this.prisma.pointsRedemption.deleteMany({
      where: { id, type: 'MIXED', status: 'PROCESSING' },
    });
  }

  /**
   * Los puntos se quemaron. Queda pendiente de factura: la venta que los documenta todavía no existe
   * porque el comercial la emite en el punto de venta después de redimir. En un pago mixto también
   * se guardan los puntos acreditados por la parte pagada en dinero.
   */
  markApplied(id: number, applied: PointsRedemptionApplied) {
    return this.prisma.pointsRedemption.update({
      where: { id },
      data: {
        status: 'PENDING_INVOICE',
        pointsRedeemed: applied.pointsRedeemed,
        pointsEarned: applied.pointsEarned,
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
   * Resuelve a mano una redención «Por verificar» después de que Puntos Colombia confirma si los
   * puntos se quemaron. La condición de estado va en el `updateMany` y no solo en la lectura: dos
   * administradores no pueden conciliar la misma fila a la vez, y el segundo recibe `null`.
   *
   * `APPLIED` la deja pendiente de factura, igual que una redención exitosa: los puntos salieron de
   * la cuenta y falta el documento que los respalda. `NOT_APPLIED` la deja fallida, que es lo que
   * habilita reintentar o retirarla del panel.
   */
  reconcile(
    id: number,
    reconciliation: PointsRedemptionReconciliation,
  ): Promise<PointsRedemptionRecord | null> {
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.pointsRedemption.findUnique({
        where: { id },
        select: {
          status: true,
          pointsRequested: true,
          pointsRedeemed: true,
          approbationNumber: true,
          completedAt: true,
        },
      });
      if (!current || current.status !== 'UNVERIFIED') return null;

      const applied = reconciliation.outcome === 'APPLIED';
      const updated = await transaction.pointsRedemption.updateMany({
        where: { id, status: 'UNVERIFIED' },
        data: {
          status: applied ? 'PENDING_INVOICE' : 'FAILED',
          // Lo aplicado lo confirma el proveedor por fuera del CRM; se conserva lo que ya estuviera
          // guardado y, si nunca llegó, se toma lo solicitado, que es lo que quemó la operación.
          pointsRedeemed: applied
            ? (current.pointsRedeemed ?? current.pointsRequested)
            : current.pointsRedeemed,
          completedAt: applied ? (current.completedAt ?? new Date()) : current.completedAt,
          approbationNumber: applied
            ? (reconciliation.approbationNumber ?? current.approbationNumber)
            : current.approbationNumber,
          errorCode: applied ? null : 'POINTS_REDEMPTION_RECONCILED_NOT_APPLIED',
          errorMessage: applied ? null : 'Puntos Colombia confirmó que la redención no se aplicó.',
          reconciliationOutcome: reconciliation.outcome,
          reconciliationNote: reconciliation.note,
          reconciledAt: new Date(),
          reconciledByUserId: reconciliation.userId,
        },
      });
      if (updated.count !== 1) return null;

      return transaction.pointsRedemption.findUnique({
        where: { id },
        include: redemptionInclude,
      });
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
   * Si la factura ya está asociada a otro movimiento del panel. Lo comprueba el pago mixto antes de
   * asociarla: una misma factura de Siigo no puede documentar dos operaciones.
   */
  invoiceNameTaken(name: string, exceptId: number): Promise<boolean> {
    return this.prisma.pointsRedemption
      .count({ where: { invoiceName: name, id: { not: exceptId } } })
      .then((count) => count > 0);
  }

  /**
   * Si la factura ya documentó un pago mixto. Sirve para impedir que después se registre la misma
   * factura para una acumulación normal, que duplicaría los puntos sobre la misma venta.
   */
  mixedInvoiceNameTaken(name: string): Promise<boolean> {
    return this.prisma.pointsRedemption
      .count({ where: { type: 'MIXED', invoiceName: name } })
      .then((count) => count > 0);
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

  /**
   * Quita la redención del panel. Es la forma de limpiar las operaciones de prueba, que de otro modo
   * se quedan para siempre porque ya no ofrecen ninguna acción.
   *
   * Solo se borra lo que está resuelto: una redención cuyo resultado todavía no se conoce —el
   * proveedor no ha respondido o la anulación quedó por verificar— es la única prueba de lo que pasó
   * con esos puntos, así que no se puede tirar. La condición se repite en el `deleteMany` para que
   * una anulación que empiece en paralelo no se borre a mitad de camino.
   */
  remove(id: number): Promise<PointsRedemptionRemoval> {
    return this.prisma.$transaction(async (transaction) => {
      const redemption = await transaction.pointsRedemption.findUnique({
        where: { id },
        select: { documentNumber: true },
      });
      if (!redemption) return { outcome: 'NOT_FOUND' };

      const deleted = await transaction.pointsRedemption.deleteMany({
        where: {
          id,
          status: { in: ['FAILED', 'PENDING_INVOICE', 'COMPLETED', 'REVOKED'] },
          OR: [{ revocationStatus: null }, { revocationStatus: { in: ['FAILED', 'COMPLETED'] } }],
        },
      });
      if (deleted.count !== 1) return { outcome: 'NOT_DELETABLE' };
      return { outcome: 'DELETED', documentNumber: redemption.documentNumber };
    });
  }
}
