import { Injectable } from '@nestjs/common';
import type { PointsInvoiceListQuery } from '@sevale/validation';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

export type PointsInvoiceClaim =
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'ALREADY_COMPLETED' }
  | { outcome: 'IN_PROGRESS' }
  | { outcome: 'UNVERIFIED' }
  /** Los puntos se anularon en el programa; volver a acumular exigiría un ajuste manual. */
  | { outcome: 'REVOKED' }
  | { outcome: 'CLAIMED'; accrualId: number; points: number };

export type PointsRevocationClaim =
  | { outcome: 'NOT_FOUND' }
  /** Sin acumulación confirmada no hay nada que anular. */
  | { outcome: 'NOT_ACCRUED' }
  | { outcome: 'ALREADY_REVOKED' }
  | { outcome: 'IN_PROGRESS' }
  | { outcome: 'UNVERIFIED' }
  | { outcome: 'CLAIMED'; accrualId: number };

export type NewPointsAccrual = {
  documentNumber: string;
  documentType: string;
  transactionIdentifier: Prisma.InputJsonValue;
};

const invoiceInclude = {
  createdBy: { select: { id: true, name: true, email: true } },
  accruals: {
    orderBy: { id: 'desc' as const },
    take: 1,
    select: {
      id: true,
      status: true,
      pointsRequested: true,
      pointsEarned: true,
      pointsBalance: true,
      approbationNumber: true,
      balanceValueInMoney: true,
      balanceCheckedAt: true,
      documentNumber: true,
      documentType: true,
      // El identificador original es obligatorio para anular: sin él no hay nada que conciliar.
      transactionIdentifier: true,
      errorCode: true,
      errorMessage: true,
      revocationStatus: true,
      revocationErrorCode: true,
      revocationErrorMessage: true,
      revokedAt: true,
      revokedBy: { select: { id: true, name: true } },
      completedAt: true,
      createdAt: true,
      user: { select: { id: true, name: true } },
    },
  },
} as const;

export type PointsInvoiceWithAccrual = Prisma.PointsInvoiceGetPayload<{
  include: typeof invoiceInclude;
}>;

@Injectable()
export class PointsInvoicesRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(query: PointsInvoiceListQuery) {
    const where: Prisma.PointsInvoiceWhereInput = {
      ...(query.status === 'all' ? {} : { status: query.status }),
      ...(query.sellerId ? { sellerId: query.sellerId } : {}),
      ...(query.search
        ? {
            OR: [
              { name: { contains: query.search } },
              { customerIdentification: { contains: query.search } },
            ],
          }
        : {}),
      ...(query.dateFrom || query.dateTo
        ? {
            invoiceDate: {
              ...(query.dateFrom ? { gte: query.dateFrom } : {}),
              ...(query.dateTo ? { lte: query.dateTo } : {}),
            },
          }
        : {}),
    };
    return this.prisma.$transaction([
      this.prisma.pointsInvoice.findMany({
        where,
        include: invoiceInclude,
        orderBy: [{ invoiceDate: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      this.prisma.pointsInvoice.count({ where }),
    ]);
  }

  detail(id: number) {
    return this.prisma.pointsInvoice.findUnique({ where: { id }, include: invoiceInclude });
  }

  bySiigoId(siigoInvoiceId: string) {
    return this.prisma.pointsInvoice.findUnique({ where: { siigoInvoiceId } });
  }

  byName(name: string) {
    return this.prisma.pointsInvoice.findFirst({ where: { name } });
  }

  /** Los prefijos configurados: el administrador elige el contexto cuando un prefijo se repite. */
  invoicePrefixes() {
    return this.prisma.user.findMany({
      where: { siigoInvoicePrefix: { not: null } },
      select: { id: true, name: true, sellerId: true, siigoInvoicePrefix: true },
      orderBy: { name: 'asc' },
    });
  }

  /** Nombre del comercial por `sellerId`, para que la tabla no muestre solo un número. */
  sellerNames(sellerIds: number[]) {
    if (sellerIds.length === 0) return Promise.resolve([]);
    return this.prisma.user.findMany({
      where: { sellerId: { in: sellerIds } },
      select: { sellerId: true, name: true },
    });
  }

  create(data: Prisma.PointsInvoiceUncheckedCreateInput) {
    return this.prisma.pointsInvoice.create({ data, include: invoiceInclude });
  }

  /**
   * Reclama la factura para acumular. La transacción es la que impide dos acumulaciones: el paso a
   * `PROCESSING` solo ocurre una vez, así que dos peticiones simultáneas no pueden ganar las dos.
   */
  claim(id: number, userId: string, accrual: NewPointsAccrual): Promise<PointsInvoiceClaim> {
    return this.prisma.$transaction(async (transaction) => {
      const invoice = await transaction.pointsInvoice.findUnique({
        where: { id },
        select: { status: true, points: true },
      });
      if (!invoice) return { outcome: 'NOT_FOUND' };
      if (invoice.status === 'COMPLETED') return { outcome: 'ALREADY_COMPLETED' };
      if (invoice.status === 'PROCESSING') return { outcome: 'IN_PROGRESS' };
      // Tras un resultado ambiguo no se reenvía: repetir podría acumular dos veces.
      if (invoice.status === 'UNVERIFIED') return { outcome: 'UNVERIFIED' };
      // Anulada: los puntos ya se devolvieron y el proveedor conoce la operación. Sin este caso el
      // reclamo caía en el `updateMany` y se informaba como «en curso», que no dice nada.
      if (invoice.status === 'REVOKED') return { outcome: 'REVOKED' };

      const claimed = await transaction.pointsInvoice.updateMany({
        where: { id, status: { in: ['PENDING', 'FAILED'] } },
        data: { status: 'PROCESSING' },
      });
      if (claimed.count !== 1) return { outcome: 'IN_PROGRESS' };

      const created = await transaction.pointsAccrual.create({
        data: {
          invoiceId: id,
          userId,
          documentNumber: accrual.documentNumber,
          documentType: accrual.documentType,
          transactionIdentifier: accrual.transactionIdentifier,
          pointsRequested: invoice.points,
          status: 'PROCESSING',
        },
      });
      return { outcome: 'CLAIMED', accrualId: created.id, points: invoice.points };
    });
  }

  markCompleted(
    invoiceId: number,
    accrualId: number,
    result: {
      pointsEarned: number;
      pointsBalance: number;
      approbationNumber: string | null;
    },
  ) {
    return this.prisma.$transaction([
      this.prisma.pointsInvoice.update({
        where: { id: invoiceId },
        data: { status: 'COMPLETED', completedAt: new Date() },
      }),
      this.prisma.pointsAccrual.update({
        where: { id: accrualId },
        data: {
          status: 'COMPLETED',
          pointsEarned: result.pointsEarned,
          pointsBalance: result.pointsBalance,
          approbationNumber: result.approbationNumber,
          completedAt: new Date(),
        },
      }),
    ]);
  }

  /**
   * Reclama la anulación. Igual que la acumulación, el paso a `PROCESSING` es único: dos peticiones
   * simultáneas no pueden anular dos veces. La factura pasa a `REVOKING` en la misma transacción,
   * así que la tabla deja de ofrecer la acción mientras el proveedor responde.
   */
  claimRevocation(
    invoiceId: number,
    userId: string,
    identifier: Prisma.InputJsonValue,
  ): Promise<PointsRevocationClaim> {
    return this.prisma.$transaction(async (transaction) => {
      const invoice = await transaction.pointsInvoice.findUnique({
        where: { id: invoiceId },
        select: {
          status: true,
          accruals: {
            where: { status: 'COMPLETED' },
            orderBy: { id: 'desc' },
            take: 1,
            select: { id: true, revocationStatus: true },
          },
        },
      });
      if (!invoice) return { outcome: 'NOT_FOUND' };
      if (invoice.status === 'REVOKED') return { outcome: 'ALREADY_REVOKED' };
      if (invoice.status === 'REVOKING') return { outcome: 'IN_PROGRESS' };

      const accrual = invoice.accruals[0];
      // La anulación solo existe sobre una acumulación confirmada: si la factura quedó fallida o
      // por verificar, primero hay que resolver eso y no hay nada acreditado que devolver.
      if (!accrual || invoice.status !== 'COMPLETED') return { outcome: 'NOT_ACCRUED' };
      if (accrual.revocationStatus === 'COMPLETED') return { outcome: 'ALREADY_REVOKED' };
      // Tras un resultado ambiguo no se reenvía: repetir podría anular una operación ya anulada.
      if (accrual.revocationStatus === 'UNVERIFIED') return { outcome: 'UNVERIFIED' };

      const claimed = await transaction.pointsAccrual.updateMany({
        where: { id: accrual.id, OR: [{ revocationStatus: null }, { revocationStatus: 'FAILED' }] },
        data: {
          revocationStatus: 'PROCESSING',
          revocationIdentifier: identifier,
          revokedByUserId: userId,
          revocationErrorCode: null,
          revocationErrorMessage: null,
        },
      });
      if (claimed.count !== 1) return { outcome: 'IN_PROGRESS' };

      await transaction.pointsInvoice.update({
        where: { id: invoiceId },
        data: { status: 'REVOKING' },
      });
      return { outcome: 'CLAIMED', accrualId: accrual.id };
    });
  }

  markRevoked(invoiceId: number, accrualId: number) {
    return this.prisma.$transaction([
      this.prisma.pointsInvoice.update({
        where: { id: invoiceId },
        data: { status: 'REVOKED' },
      }),
      this.prisma.pointsAccrual.update({
        where: { id: accrualId },
        data: {
          revocationStatus: 'COMPLETED',
          revokedAt: new Date(),
          revocationErrorCode: null,
          revocationErrorMessage: null,
        },
      }),
    ]);
  }

  /**
   * Una anulación fallida no deshace nada: los puntos siguen acreditados, así que la factura vuelve
   * a `COMPLETED` y el error se guarda solo en el intento de anulación.
   */
  markRevocationFailed(
    invoiceId: number,
    accrualId: number,
    code: string,
    message: string,
    unverified: boolean,
  ) {
    return this.prisma.$transaction([
      this.prisma.pointsInvoice.update({
        where: { id: invoiceId },
        data: { status: 'COMPLETED' },
      }),
      this.prisma.pointsAccrual.update({
        where: { id: accrualId },
        data: {
          revocationStatus: unverified ? 'UNVERIFIED' : 'FAILED',
          revocationErrorCode: code,
          revocationErrorMessage: message,
        },
      }),
    ]);
  }

  /** El saldo en pesos se consulta después y puede faltar sin invalidar el éxito de la acumulación. */
  recordBalanceValue(accrualId: number, valueInMoney: number) {
    return this.prisma.pointsAccrual.update({
      where: { id: accrualId },
      data: { balanceValueInMoney: valueInMoney, balanceCheckedAt: new Date() },
    });
  }

  /**
   * Cierra el intento con un fallo. `unverified` distingue el error ambiguo —timeout o 5xx— del
   * definitivo: el primero bloquea el reenvío hasta conciliar.
   */
  markFailed(
    invoiceId: number,
    accrualId: number,
    code: string,
    message: string,
    unverified: boolean,
  ) {
    return this.prisma.$transaction([
      this.prisma.pointsInvoice.update({
        where: { id: invoiceId },
        data: { status: unverified ? 'UNVERIFIED' : 'FAILED' },
      }),
      this.prisma.pointsAccrual.update({
        where: { id: accrualId },
        data: {
          status: unverified ? 'UNVERIFIED' : 'FAILED',
          errorCode: code,
          errorMessage: message,
        },
      }),
    ]);
  }
}
