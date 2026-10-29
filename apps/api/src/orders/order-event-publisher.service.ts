import { Injectable, Logger } from '@nestjs/common';
import type { Store } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { OrdersRepository, type OrderOperationDetail } from './orders.repository.js';
import { OrderEventsService } from './order-events.service.js';

@Injectable()
export class OrderEventPublisher {
  private readonly logger = new Logger(OrderEventPublisher.name);

  constructor(
    private readonly orders: OrdersRepository,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
    private readonly trail: OrderEventsService,
  ) {}

  async inboundImported(operationId: number, store: Store, created: boolean) {
    const operation = await this.orders.detail(operationId);
    if (!operation) return;
    if (created) {
      this.realtime.emitOrderOperationCreated(operation);
      // El pedido no lo creó nadie del CRM: lo trajo la tienda. La traza lo deja dicho para que el
      // administrador no busque un responsable comercial que nunca existió.
      await this.trail.recordCreated(
        {
          id: operation.id,
          operationCode: operation.operationCode,
          customerName: operation.customer.displayName,
        },
        null,
        store,
      );
      await this.publish(
        this.notifications.createOrderOperation(operation, 'WOOCOMMERCE', null),
        'pedido WooCommerce recibido',
      );
      return;
    }
    this.realtime.emitOrderOperationUpdated(operation);
    this.emitSyncUpdated(operation);
  }

  async operationCreated(operation: OrderOperationDetail, actorUserId: string) {
    this.realtime.emitOrderOperationCreated(operation);
    await this.publish(
      this.notifications.createOrderOperation(operation, 'CRM', actorUserId),
      'creación de pedido',
    );
  }

  operationUpdated(operation: OrderOperationDetail) {
    this.realtime.emitOrderOperationUpdated(operation);
  }

  /**
   * Del pedido completado en adelante solo se avisa en tiempo real: la sincronización con las
   * tiendas, el envío y la cotización quedan en la actividad del pedido, con su autor y su
   * resultado. Repetirlos como notificación llenaba la campana sin decir nada que no estuviera ya
   * en la traza.
   */
  operationCompleted(operation: OrderOperationDetail) {
    this.realtime.emitOrderOperationUpdated(operation);
    this.emitSyncUpdated(operation);
  }

  syncUpdated(operation: OrderOperationDetail) {
    this.emitSyncUpdated(operation);
  }

  shipmentUpdated(operation: OrderOperationDetail) {
    if (!operation.shipment) return;
    this.realtime.emitOrderShipmentUpdated(operation, {
      status: operation.shipment.status,
      trackingNumber: operation.shipment.trackingNumber,
    });
  }

  siigoQuotationUpdated(operation: OrderOperationDetail) {
    if (!operation.siigoQuotation) return;
    this.realtime.emitOrderSiigoQuotationUpdated(operation, {
      status: operation.siigoQuotation.status,
      externalId: operation.siigoQuotation.externalId,
    });
  }

  private emitSyncUpdated(operation: OrderOperationDetail) {
    this.realtime.emitOrderSyncUpdated(
      operation,
      operation.orders.map(({ store, syncStatus }) => ({ store, syncStatus })),
    );
  }

  private async publish(operation: Promise<unknown> | null, context: string) {
    if (!operation) return;
    try {
      await operation;
    } catch {
      this.logger.warn(`No se pudo registrar la notificación de ${context}.`);
    }
  }
}
