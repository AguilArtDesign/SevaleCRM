import { Injectable } from '@nestjs/common';
import type { PointsInvoiceListQuery } from '@sevale/validation';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

export type PointsInvoiceClaim =
  | { outcome: 'NOT_FOUND' }
  | { outcome: 'ALREADY_COMPLETED' }
  | { outcome: 'IN_PROGRESS' }
  | { outcome: 'UNVERIFIED' }
  | { outcome: 'CLAIMED'; accrualId: number; points: number };

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
      errorCode: true,
      errorMessage: true,
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
