import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { SiigoProductLookupQuery, SiigoProductUpdateInput } from '@sevale/validation';
import type { Product, SyncStatus } from '../../generated/prisma/client.js';
import { SiigoWebhookRepository } from './siigo-webhook.repository.js';
import { RealtimeGateway } from '../../realtime/realtime.gateway.js';
import { NotificationsService } from '../../notifications/notifications.service.js';

type NumericChange = { previous: number; current: number } | null;

function numericChange(previous: number, current: number): NumericChange {
  return previous === current ? null : { previous, current };
}

function calculateSyncStatus(input: SiigoProductUpdateInput, product: Product): SyncStatus {
  if (input.woo_sync?.success === false) return 'ERROR';
  const wooSync = input.woo_sync?.success === true ? input.woo_sync : null;
  const wooPriceCop = wooSync?.price_cop ?? Number(product.wooPriceCop);
  const wooPriceUsd = wooSync?.price_usd ?? Number(product.wooPriceUsd);
  const wooStock = wooSync?.stock ?? product.wooStock;
  return input.siigo_price_cop === wooPriceCop &&
    input.siigo_price_usd === wooPriceUsd &&
    input.siigo_stock === wooStock
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

  async findProduct({ siigo_id }: SiigoProductLookupQuery) {
    const product = await this.repository.findBySiigoId(siigo_id);
    if (!product) return { success: true, exists: false, product: null };

    return {
      success: true,
      exists: true,
      product: {
        id: product.id,
        siigoId: product.siigoId,
        sku: product.sku,
        store: product.store,
        wooCommerce: {
          type: product.wooParentId === null ? ('SIMPLE' as const) : ('VARIATION' as const),
          productId: (product.wooParentId ?? product.wooVariationId)?.toString() ?? null,
          variationId:
            product.wooParentId === null ? null : (product.wooVariationId?.toString() ?? null),
        },
      },
    };
  }

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
    if (input.woo_sync && input.woo_sync.store !== previous.store) {
      throw new ConflictException({
        success: false,
        error: {
          code: 'WOOCOMMERCE_STORE_MISMATCH',
          message: 'La tienda recibida no coincide con el producto vinculado.',
        },
      });
    }

    const syncStatus = calculateSyncStatus(input, previous);
    const checkedAt = new Date();
    const updated = await this.repository.update(input.siigo_id, {
      siigoPriceCop: input.siigo_price_cop,
      siigoPriceUsd: input.siigo_price_usd,
      siigoStock: input.siigo_stock,
      lastCheckAt: checkedAt,
      ...(input.woo_sync?.success
        ? {
            wooPriceCop: input.woo_sync.price_cop,
            wooPriceUsd: input.woo_sync.price_usd,
            wooStock: input.woo_sync.stock,
            lastSyncAt: checkedAt,
          }
        : {}),
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
        lastSyncAt: updated.lastSyncAt,
        syncStatus: updated.syncStatus,
      },
      changes,
    };
  }
}
