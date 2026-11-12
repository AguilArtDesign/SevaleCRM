import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import type { SiigoProductLookupQuery, SiigoProductUpdateInput } from '@sevale/validation';
import type { Product, SyncStatus } from '../../generated/prisma/client.js';
import { SiigoWebhookRepository } from './siigo-webhook.repository.js';
import { RealtimeGateway } from '../../realtime/realtime.gateway.js';
import { NotificationsService } from '../../notifications/notifications.service.js';
import { decimalOrNull, pricesAndStockMatch } from '../../inventory/product-prices.js';

type NumericChange = { previous: number | null; current: number | null } | null;

function numericChange(
  previous: number,
  current: number,
): { previous: number; current: number } | null;
function numericChange(
  previous: number | null,
  current: number | null,
): { previous: number | null; current: number | null } | null;
function numericChange(previous: number | null, current: number | null): NumericChange {
  return previous === current ? null : { previous, current };
}

function calculateSyncStatus(
  input: SiigoProductUpdateInput,
  product: Product,
  siigoPriceMxn: number | null,
  siigoPriceEur: number | null,
): SyncStatus {
  if (input.woo_sync?.success === false) return 'ERROR';
  const wooSync = input.woo_sync?.success === true ? input.woo_sync : null;
  return pricesAndStockMatch(
    {
      priceCop: input.siigo_price_cop,
      priceUsd: input.siigo_price_usd,
      priceMxn: siigoPriceMxn,
      priceEur: siigoPriceEur,
    },
    {
      priceCop: wooSync?.price_cop ?? decimalOrNull(product.wooPriceCop),
      priceUsd: wooSync?.price_usd ?? decimalOrNull(product.wooPriceUsd),
      priceMxn: wooSync?.price_mxn ?? decimalOrNull(product.wooPriceMxn),
      priceEur: wooSync?.price_eur ?? decimalOrNull(product.wooPriceEur),
    },
    input.siigo_stock,
    wooSync?.stock ?? product.wooStock,
  )
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

    const siigoPriceMxn = input.siigo_price_mxn ?? decimalOrNull(previous.siigoPriceMxn);
    const siigoPriceEur = input.siigo_price_eur ?? decimalOrNull(previous.siigoPriceEur);
    const syncStatus = calculateSyncStatus(input, previous, siigoPriceMxn, siigoPriceEur);
    const checkedAt = new Date();
    const updated = await this.repository.update(input.siigo_id, {
      siigoPriceCop: input.siigo_price_cop,
      siigoPriceUsd: input.siigo_price_usd,
      // `undefined` deja la columna como está: un n8n sin desplegar no borra el dato guardado.
      siigoPriceMxn: input.siigo_price_mxn,
      siigoPriceEur: input.siigo_price_eur,
      siigoStock: input.siigo_stock,
      lastCheckAt: checkedAt,
      ...(input.woo_sync?.success
        ? {
            wooPriceCop: input.woo_sync.price_cop,
            wooPriceUsd: input.woo_sync.price_usd,
            wooPriceMxn: input.woo_sync.price_mxn,
            wooPriceEur: input.woo_sync.price_eur,
            wooStock: input.woo_sync.stock,
            lastSyncAt: checkedAt,
          }
        : {}),
      syncStatus,
    });

    const changes = {
      priceCop: numericChange(decimalOrNull(previous.siigoPriceCop), input.siigo_price_cop),
      priceUsd: numericChange(decimalOrNull(previous.siigoPriceUsd), input.siigo_price_usd),
      priceMxn: numericChange(decimalOrNull(previous.siigoPriceMxn), siigoPriceMxn),
      priceEur: numericChange(decimalOrNull(previous.siigoPriceEur), siigoPriceEur),
      stock: numericChange(previous.siigoStock, input.siigo_stock),
      syncStatus:
        previous.syncStatus === syncStatus
          ? null
          : { previous: previous.syncStatus, current: syncStatus },
    };
    await this.notifications.createSiigoProductUpdate(
      updated,
      changes,
      input.woo_sync?.success === true,
    );
    this.realtime.emitProductUpdated(updated, changes);

    return {
      success: true,
      product: {
        id: updated.id,
        siigoId: updated.siigoId,
        sku: updated.sku,
        siigoPriceCop: Number(updated.siigoPriceCop),
        siigoPriceUsd: Number(updated.siigoPriceUsd),
        siigoPriceMxn: decimalOrNull(updated.siigoPriceMxn),
        siigoPriceEur: decimalOrNull(updated.siigoPriceEur),
        siigoStock: updated.siigoStock,
        lastCheckAt: updated.lastCheckAt,
        lastSyncAt: updated.lastSyncAt,
        syncStatus: updated.syncStatus,
      },
      changes,
    };
  }
}
