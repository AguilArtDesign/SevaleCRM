import { Injectable } from '@nestjs/common';
import type { OrderEventAction, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

/** Campos que la traza guarda de cada evento, con los nombres que usa el panel. */
export type OrderEventChange = { field: string; from: unknown; to: unknown };

export type OrderEventInput = {
  operationId: number | null;
  action: OrderEventAction;
  /** Usuario que ejecutó la acción. Nulo cuando la origina el sistema, por ejemplo WooCommerce. */
  userId: string | null;
  operationCode: string;
  customerName: string | null;
  changes?: OrderEventChange[] | null;
  /** Tienda que sincronizó (`SERATUS`, `PALI`) o integración que cotizó (`SIIGO`). */
  provider?: 'SERATUS' | 'PALI' | 'SIIGO' | null;
  outcome?: 'SYNCED' | 'ERROR' | null;
  message?: string | null;
  origin?: 'LIVE' | 'BACKFILL';
};

const eventInclude = {
  user: { select: { id: true, name: true, email: true } },
} as const;

@Injectable()
export class OrderEventsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inserta un evento. El nombre del actor se copia en la fila: un usuario se borra físicamente y,
   * sin la copia, la traza perdería el nombre de quién actuó justo cuando hay que consultarla.
   */
  async record(input: OrderEventInput) {
    const actor = input.userId
      ? await this.prisma.user.findUnique({
          where: { id: input.userId },
          select: { name: true },
        })
      : null;
    return this.prisma.orderEvent.create({
      data: {
        operationId: input.operationId,
        action: input.action,
        origin: input.origin ?? 'LIVE',
        userId: input.userId,
        userName: actor?.name ?? null,
        operationCode: input.operationCode,
        customerName: input.customerName,
        changes: (input.changes ?? null) as Prisma.InputJsonValue,
        provider: input.provider ?? null,
        outcome: input.outcome ?? null,
        message: input.message ?? null,
      },
    });
  }

  /** Historial de una operación, de lo más reciente a lo más antiguo. */
  list(operationId: number, page: number, pageSize: number) {
    const where: Prisma.OrderEventWhereInput = { operationId };
    return this.prisma.$transaction([
      this.prisma.orderEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: eventInclude,
      }),
      this.prisma.orderEvent.count({ where }),
    ]);
  }
}
