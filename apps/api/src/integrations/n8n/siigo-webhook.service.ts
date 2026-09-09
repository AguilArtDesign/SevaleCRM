import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { SiigoProductUpdateInput } from '@sevale/validation';
import type { Product, SyncStatus } from '../../generated/prisma/client.js';
import { SiigoWebhookRepository } from './siigo-webhook.repository.js';
import { RealtimeGateway } from '../../realtime/realtime.gateway.js';
import { NotificationsService } from '../../notifications/notifications.service.js';

type NumericChange = { previous: number; current: number } | null;

function numericChange(previous: number, current: number): NumericChange {
  return previous === current ? null : { previous, current };
}

function calculateSyncStatus(input: SiigoProductUpdateInput, product: Product): SyncStatus {
  return input.siigo_price_cop === Number(product.wooPriceCop) &&
    input.siigo_price_usd === Number(product.wooPriceUsd) &&
    input.siigo_stock === product.wooStock
    ? 'SYNCED'
    : 'OUT_OF_SYNC';
}

@Injectable()
export class SiigoWebhookService {
  constructor(
    private readonly repository: SiigoWebhookRepository,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  async updateProduct(input: SiigoProductUpdateInput) {
    const previous = await this.repository.findBySiigoId(input.siigo_id);
    if (!previous) {
      throw new NotFoundException({
        success: false,
        error: {
          code: 'PRODUCT_NOT_FOUND',
          message: 'No existe un producto vinculado con ese identificador de Siigo.',
        },
      });
    }
    if (previous.sku.toUpperCase() !== input.sku.toUpperCase()) {
      throw new ConflictException({
        success: false,
        error: {
          code: 'SIIGO_SKU_MISMATCH',
          message: 'El SKU recibido no coincide con el producto vinculado.',
        },
      });
    }

    const syncStatus = calculateSyncStatus(input, previous);
    const updated = await this.repository.update(input.siigo_id, {
      siigoPriceCop: input.siigo_price_cop,
      siigoPriceUsd: input.siigo_price_usd,
      siigoStock: input.siigo_stock,
      lastCheckAt: new Date(),
      syncStatus,
    });

    const changes = {
      priceCop: numericChange(Number(previous.siigoPriceCop), input.siigo_price_cop),
      priceUsd: numericChange(Number(previous.siigoPriceUsd), input.siigo_price_usd),
      stock: numericChange(previous.siigoStock, input.siigo_stock),
      syncStatus:
        previous.syncStatus === syncStatus
          ? null
          : { previous: previous.syncStatus, current: syncStatus },
    };
    await this.notifications.createSiigoProductUpdate(updated, changes);
    this.realtime.emitProductUpdated(updated, changes);

    return {
      success: true,
      product: {
        id: updated.id,
        siigoId: updated.siigoId,
        sku: updated.sku,
        siigoPriceCop: Number(updated.siigoPriceCop),
        siigoPriceUsd: Number(updated.siigoPriceUsd),
        siigoStock: updated.siigoStock,
        lastCheckAt: updated.lastCheckAt,
        syncStatus: updated.syncStatus,
      },
      changes,
    };
  }
}
