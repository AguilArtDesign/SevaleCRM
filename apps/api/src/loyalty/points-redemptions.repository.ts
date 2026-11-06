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
}
