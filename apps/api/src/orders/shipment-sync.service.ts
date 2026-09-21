import { HttpException, Injectable } from '@nestjs/common';
import type { Store } from '../generated/prisma/client.js';
import { WooCommerceService } from '../integrations/woocommerce/woocommerce.service.js';
import { OrdersRepository, type ShipmentSyncJob } from './orders.repository.js';

function storeLabel(store: Store): string {
  return store === 'SERATUS' ? 'Seratus' : 'Pali';
}

function safeMessage(error: unknown, store: Store): string {
  if (error instanceof HttpException) {
    const response: unknown = error.getResponse();
    if (typeof response === 'object' && response !== null && 'error' in response) {
      const detail = (response as { error?: unknown }).error;
      if (typeof detail === 'object' && detail !== null && 'message' in detail) {
        const message = (detail as { message?: unknown }).message;
        if (typeof message === 'string' && message.length <= 500) return message;
      }
    }
  }
  return `No fue posible actualizar el envío en ${storeLabel(store)}.`;
}

@Injectable()
export class ShipmentSyncService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly wooCommerce: WooCommerceService,
  ) {}

  async synchronize(shipmentId: number, retry = false): Promise<boolean> {
    const claimedIds = await this.orders.claimShipmentSyncs(shipmentId, retry);
    if (claimedIds.length === 0) return false;
    const jobs = await this.orders.shipmentSyncJobs(claimedIds);
    await Promise.all(jobs.map((job) => this.synchronizeStore(job)));
    return true;
  }

  private async synchronizeStore(job: ShipmentSyncJob): Promise<void> {
    const order = job.shipment.operation.orders.find(({ store }) => store === job.store);
    if (!order?.wooOrderId) {
      await this.orders.markShipmentStoreError(
        job.id,
        'WOO_ORDER_NOT_CREATED',
        `El pedido de ${storeLabel(job.store)} todavía no existe en WooCommerce.`,
      );
      return;
    }
    const shipment = job.shipment;
    if (!shipment.carrier || !shipment.trackingNumber || !shipment.status) {
      await this.orders.markShipmentStoreError(
        job.id,
        'SHIPMENT_DATA_INCOMPLETE',
        'La información local del envío está incompleta.',
      );
      return;
    }
    try {
      await this.wooCommerce.updateOrderShipment(job.store, order.wooOrderId.toString(), {
        carrier: shipment.carrier,
        trackingNumber: shipment.trackingNumber,
        status: shipment.status,
      });
      await this.orders.markShipmentStoreSynced(job.id);
    } catch (error) {
      await this.orders.markShipmentStoreError(
        job.id,
        `${job.store}_SHIPMENT_WOO_SYNC_FAILED`,
        safeMessage(error, job.store),
      );
    }
  }
}
