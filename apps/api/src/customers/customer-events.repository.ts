import { Injectable } from '@nestjs/common';
import type { CustomerEventAction, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

/** Campos que la traza guarda de cada evento, con los nombres que usa el panel. */
export type CustomerEventChange = { field: string; from: unknown; to: unknown };

export type CustomerEventInput = {
  customerId: number | null;
  action: CustomerEventAction;
  /** Usuario que ejecutó la acción. Nulo cuando la origina el sistema, por ejemplo la importación. */
  userId: string | null;
  customerName: string | null;
  customerDocument: string | null;
  changes?: CustomerEventChange[] | null;
  provider?: 'SIIGO' | 'SERATUS' | 'PALI' | null;
  outcome?: 'SYNCED' | 'ERROR' | null;
  message?: string | null;
  origin?: 'LIVE' | 'BACKFILL';
};

const eventInclude = {
  user: { select: { id: true, name: true, email: true } },
} as const;

@Injectable()
export class CustomerEventsRepository {
  constructor(private readonly prisma: PrismaService) {}

  /**
   * Inserta un evento. El nombre del actor se copia en la fila: un usuario se borra físicamente y,
   * sin la copia, la traza perdería el nombre de quién actuó justo cuando hay que consultarla.
   */
  async record(input: CustomerEventInput) {
    const actor = input.userId
      ? await this.prisma.user.findUnique({
          where: { id: input.userId },
          select: { name: true },
        })
      : null;
    return this.prisma.customerEvent.create({
      data: {
        customerId: input.customerId,
        action: input.action,
        origin: input.origin ?? 'LIVE',
        userId: input.userId,
        userName: actor?.name ?? null,
        customerName: input.customerName,
        customerDocument: input.customerDocument,
        changes: (input.changes ?? null) as Prisma.InputJsonValue,
        provider: input.provider ?? null,
        outcome: input.outcome ?? null,
        message: input.message ?? null,
      },
    });
  }

  /** Historial de un cliente, de lo más reciente a lo más antiguo. */
  list(customerId: number, page: number, pageSize: number) {
    const where: Prisma.CustomerEventWhereInput = { customerId };
    return this.prisma.$transaction([
      this.prisma.customerEvent.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: eventInclude,
      }),
      this.prisma.customerEvent.count({ where }),
    ]);
  }

  /**
   * Eventos de clientes que ya no existen. Se consultan por documento porque el `customerId` quedó
   * en nulo al borrarse el cliente y el panel no tiene otro identificador que ofrecer.
   */
  listOrphanByDocument(document: string) {
    return this.prisma.customerEvent.findMany({
      where: { customerId: null, customerDocument: document },
      orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
      take: 50,
      include: eventInclude,
    });
  }

  /** Cliente con lo justo para copiar en el evento: nombre, documento y autor del alta. */
  findSnapshot(customerId: number) {
    return this.prisma.customer.findUnique({
      where: { id: customerId },
      select: { id: true, displayName: true, documentNumber: true, createdByUserId: true },
    });
  }
}
