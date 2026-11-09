import { Injectable, NotFoundException } from '@nestjs/common';
import type { ShipmentListQuery } from '@sevale/validation';
import { ShipmentsRepository } from './shipments.repository.js';

/**
 * Filas del panel de Envíos. El envío se aplana a lo que la tabla necesita: la guía y la
 * transportadora son una sola por operación, mientras la sincronización es por tienda, así que van
 * por separado y el panel decide cómo mostrarlas.
 */
@Injectable()
export class ShipmentsService {
  constructor(private readonly shipments: ShipmentsRepository) {}

  async list(query: ShipmentListQuery) {
    const [[rows, total], pending] = await Promise.all([
      this.shipments.list(query),
      this.shipments.pendingCount(),
    ]);

    return {
      data: rows.map((operation) => ({
        operationId: operation.id,
        operationCode: operation.operationCode,
        currency: operation.currency,
        total: operation.total.toFixed(2),
        createdAt: operation.createdAt.toISOString(),
        updatedAt: operation.updatedAt.toISOString(),
        customer: {
          id: operation.customer.id,
          displayName: operation.customer.displayName,
          personType: operation.customer.personType,
          documentType: operation.customer.documentType,
          documentNumber: operation.customer.documentNumber,
          email: operation.customer.email,
        },
        stores: operation.orders.map(({ store }) => store),
        quotation: operation.siigoQuotation?.name
          ? {
              name: operation.siigoQuotation.name,
              number: operation.siigoQuotation.number,
              url: operation.siigoQuotation.url,
            }
          : null,
        shipment: operation.shipment
          ? {
              carrier: operation.shipment.carrier,
              trackingNumber: operation.shipment.trackingNumber,
              status: operation.shipment.status,
              updatedAt: operation.shipment.updatedAt.toISOString(),
              syncs: operation.shipment.storeSyncs.map((sync) => ({
                store: sync.store,
                syncStatus: sync.syncStatus,
                errorMessage: sync.lastSyncErrorMessage,
              })),
              lastEvent: operation.shipment.events[0]
                ? {
                    status: operation.shipment.events[0].status,
                    note: operation.shipment.events[0].note,
                    createdAt: operation.shipment.events[0].createdAt.toISOString(),
                    author: operation.shipment.events[0].createdBy?.name ?? null,
                  }
                : null,
            }
          : null,
      })),
      // Los que todavía no tienen guía: es la cola de trabajo de logística.
      pending,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  /** Bitácora del envío. La operación existe o no existe: no hay un «envío» suelto que consultar. */
  async history(operationId: number) {
    const operation = await this.shipments.history(operationId);
    if (!operation) throw new NotFoundException('El envío no existe.');

    return {
      operationId: operation.id,
      operationCode: operation.operationCode,
      shipment: operation.shipment
        ? {
            carrier: operation.shipment.carrier,
            trackingNumber: operation.shipment.trackingNumber,
            status: operation.shipment.status,
            updatedAt: operation.shipment.updatedAt.toISOString(),
            syncs: operation.shipment.storeSyncs.map((sync) => ({
              store: sync.store,
              syncStatus: sync.syncStatus,
              errorMessage: sync.lastSyncErrorMessage,
            })),
            events: operation.shipment.events.map((event) => ({
              id: event.id,
              status: event.status,
              note: event.note,
              createdAt: event.createdAt.toISOString(),
              author: event.createdBy?.name ?? null,
            })),
          }
        : null,
    };
  }

  async addNote(operationId: number, note: string, createdByUserId: string) {
    const event = await this.shipments.addNote(operationId, note, createdByUserId);
    if (!event) {
      throw new NotFoundException(
        'La operación todavía no tiene guía asignada, así que no admite novedades.',
      );
    }
    return {
      id: event.id,
      status: event.status,
      note: event.note,
      createdAt: event.createdAt.toISOString(),
      author: event.createdBy?.name ?? null,
    };
  }
}
