import { Injectable, Logger } from '@nestjs/common';
import type { Store } from '../generated/prisma/client.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { OrdersRepository, type OrderOperationDetail } from './orders.repository.js';

@Injectable()
export class OrderEventPublisher {
  private readonly logger = new Logger(OrderEventPublisher.name);

  constructor(
    private readonly orders: OrdersRepository,
    private readonly notifications: NotificationsService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async inboundImported(operationId: number, store: Store, created: boolean) {
    const operation = await this.orders.detail(operationId);
    if (!operation) return;
    if (created) {
      this.realtime.emitOrderOperationCreated(operation);
      await this.publish(
        this.notifications.createOrderOperation(operation, 'WOOCOMMERCE', store),
        'pedido WooCommerce recibido',
      );
      return;
    }
    this.realtime.emitOrderOperationUpdated(operation);
    this.emitSyncUpdated(operation);
  }

  async operationCreated(operation: OrderOperationDetail) {
    this.realtime.emitOrderOperationCreated(operation);
    await this.publish(
      this.notifications.createOrderOperation(operation, 'CRM'),
      'creación de operación',
    );
  }

  operationUpdated(operation: OrderOperationDetail) {
    this.realtime.emitOrderOperationUpdated(operation);
  }

  async operationCompleted(operation: OrderOperationDetail) {
    this.realtime.emitOrderOperationUpdated(operation);
    this.emitSyncUpdated(operation);
    await Promise.all([
      this.publish(this.notifications.createOrderCompleted(operation), 'operación completada'),
      this.publish(
        this.notifications.createOrderSyncResults(operation, operation.orders, false),
        'sincronización de operación',
      ),
    ]);
  }

  async syncUpdated(operation: OrderOperationDetail, retriedOrderIds: number[]) {
    this.emitSyncUpdated(operation);
    await this.publish(
      this.notifications.createOrderSyncResults(
        operation,
        operation.orders.filter(({ id }) => retriedOrderIds.includes(id)),
        true,
      ),
      'reintento de sincronización',
    );
  }

  async shipmentUpdated(operation: OrderOperationDetail, notify: boolean) {
    if (!operation.shipment) return;
    this.realtime.emitOrderShipmentUpdated(operation, {
      status: operation.shipment.status,
      trackingNumber: operation.shipment.trackingNumber,
    });
    if (notify) {
      await this.publish(
        this.notifications.createOrderShipmentUpdated(operation),
        'actualización de envío',
      );
    }
  }

  async siigoQuotationUpdated(operation: OrderOperationDetail) {
    if (!operation.siigoQuotation) return;
    this.realtime.emitOrderSiigoQuotationUpdated(operation, {
      status: operation.siigoQuotation.status,
      externalId: operation.siigoQuotation.externalId,
    });
    await this.publish(
      this.notifications.createOrderSiigoQuotationUpdated(
        operation,
        operation.siigoQuotation.status,
      ),
      'cotización Siigo',
    );
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
