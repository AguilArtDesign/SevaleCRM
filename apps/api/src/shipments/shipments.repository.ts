import { Injectable } from '@nestjs/common';
import type { ShipmentListQuery } from '@sevale/validation';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

/**
 * Filas del panel de Envíos. Se listan **operaciones**, no pedidos de tienda: la cotización de Siigo
 * es una por operación y el envío también (`Shipment.operationId` es único). Una operación con
 * productos de Seratus y Pali daría dos filas si se partiera del pedido, con la misma cotización
 * repetida; desde la operación aparece una sola vez.
 *
 * Entran las completadas y con cotización creada en Siigo: es «listo para despachar». Una operación
 * con cotización pero todavía pendiente no tiene pedido en la tienda, así que la guía no tendría
 * dónde sincronizarse.
 */
@Injectable()
export class ShipmentsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(query: ShipmentListQuery) {
    const where = this.where(query);
    return this.prisma.$transaction([
      this.prisma.orderOperation.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          operationCode: true,
          currency: true,
          total: true,
          createdAt: true,
          updatedAt: true,
          customer: {
            select: {
              id: true,
              displayName: true,
              personType: true,
              documentType: true,
              documentNumber: true,
              email: true,
            },
          },
          siigoQuotation: { select: { name: true, number: true, url: true } },
          orders: { select: { store: true, wooOrderId: true } },
          shipment: {
            select: {
              carrier: true,
              trackingNumber: true,
              status: true,
              updatedAt: true,
              storeSyncs: {
                select: { store: true, syncStatus: true, lastSyncErrorMessage: true },
              },
              events: {
                orderBy: { createdAt: 'desc' as const },
                take: 1,
                select: {
                  status: true,
                  note: true,
                  createdAt: true,
                  createdBy: { select: { name: true } },
                },
              },
            },
          },
        },
      }),
      this.prisma.orderOperation.count({ where }),
    ]);
  }

  /** Cuántas filas esperan guía: el número que logística mira al abrir el panel. */
  pendingCount() {
    return this.prisma.orderOperation.count({
      where: this.where({
        search: '',
        guide: 'pending',
        page: 1,
        pageSize: 20,
      }),
    });
  }

  /** Historial completo del envío: los eventos son la bitácora de novedades. */
  history(operationId: number) {
    return this.prisma.orderOperation.findFirst({
      where: { id: operationId, deletedAt: null },
      select: {
        id: true,
        operationCode: true,
        shipment: {
          select: {
            carrier: true,
            trackingNumber: true,
            status: true,
            updatedAt: true,
            storeSyncs: {
              select: { store: true, syncStatus: true, lastSyncErrorMessage: true },
            },
            events: {
              orderBy: { createdAt: 'desc' as const },
              select: {
                id: true,
                status: true,
                note: true,
                createdAt: true,
                createdBy: { select: { name: true } },
              },
            },
          },
        },
      },
    });
  }

  /**
   * Agrega una novedad al envío. Devuelve `null` si la operación todavía no tiene envío: sin guía
   * asignada no hay dónde colgar el comentario, y crearlo aquí inventaría un envío vacío.
   */
  addNote(operationId: number, note: string, createdByUserId: string) {
    return this.prisma.$transaction(async (transaction) => {
      const shipment = await transaction.shipment.findUnique({
        where: { operationId },
        select: { id: true, status: true },
      });
      if (!shipment) return null;

      return transaction.shipmentEvent.create({
        data: {
          shipmentId: shipment.id,
          // El evento guarda el estado que tenía el envío al escribir la novedad: la columna no es
          // nula y el cambio de estado sigue siendo cosa de asignar el envío.
          status: shipment.status || 'PREPARING',
          note,
          createdByUserId,
        },
        select: {
          id: true,
          status: true,
          note: true,
          createdAt: true,
          createdBy: { select: { name: true } },
        },
      });
    });
  }

  private where({
    search,
    status,
    guide,
    dateFrom,
    dateTo,
  }: ShipmentListQuery): Prisma.OrderOperationWhereInput {
    const filters: Prisma.OrderOperationWhereInput[] = [
      {
        deletedAt: null,
        status: 'COMPLETED',
        // `externalId` es la cotización que ya vive en Siigo: sin ella la operación todavía no está
        // lista para despachar.
        siigoQuotation: { is: { externalId: { not: null } } },
      },
    ];

    if (status) filters.push({ shipment: { is: { status } } });
    if (dateFrom || dateTo) {
      filters.push({
        createdAt: {
          ...(dateFrom ? { gte: dateFrom } : {}),
          ...(dateTo ? { lte: dateTo } : {}),
        },
      });
    }
    if (guide === 'pending') {
      filters.push({
        OR: [
          { shipment: { is: null } },
          { shipment: { is: { trackingNumber: null } } },
          { shipment: { is: { trackingNumber: '' } } },
        ],
      });
    } else if (guide === 'assigned') {
      filters.push({
        shipment: {
          is: { AND: [{ trackingNumber: { not: null } }, { NOT: { trackingNumber: '' } }] },
        },
      });
    }
    if (search) {
      filters.push({
        OR: [
          { operationCode: { contains: search } },
          { customer: { is: { displayName: { contains: search } } } },
          { customer: { is: { documentNumber: { contains: search } } } },
          { shipment: { is: { trackingNumber: { contains: search } } } },
          { shipment: { is: { carrier: { contains: search } } } },
          { siigoQuotation: { is: { name: { contains: search } } } },
        ],
      });
    }

    return { AND: filters };
  }
}
