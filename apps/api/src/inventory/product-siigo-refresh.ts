import type { Prisma } from '../generated/prisma/client.js';
import { SyncStatus, type Product } from '../generated/prisma/client.js';
import type { SiigoProduct } from '../integrations/siigo/siigo.service.js';
import { decimalOrNull, pricesAndStockMatch } from './product-prices.js';

export type SiigoRefreshErrorCode = 'SIIGO_PRICES_INCOMPLETE' | 'SIIGO_STOCK_INVALID';

/**
 * Convierte lo que Siigo devuelve en el update del espejo local. Es la única definición de
 * «Sincronizado» para el refresco: las cuatro monedas y el stock deben coincidir con lo último que
 * se conoce de WooCommerce. No envía nada a la tienda.
 */
export type SiigoRefreshResult =
  | {
      success: true;
      data: Prisma.ProductUncheckedUpdateInput;
      syncStatus: SyncStatus;
    }
  | {
      success: false;
      code: SiigoRefreshErrorCode;
      message: string;
    };

export function buildSiigoRefresh(
  product: Product,
  siigo: SiigoProduct,
  checkedAt: Date,
): SiigoRefreshResult {
  if (siigo.priceCop === null || siigo.priceUsd === null) {
    return {
      success: false,
      code: 'SIIGO_PRICES_INCOMPLETE',
      message: 'Siigo no devolvió los precios COP y USD.',
    };
  }
  // Las existencias negativas ya vienen normalizadas a 0 desde `normalizeProduct`; aquí solo se
  // rechaza un stock que no sea un entero, como un decimal.
  if (!Number.isSafeInteger(siigo.stock)) {
    return {
      success: false,
      code: 'SIIGO_STOCK_INVALID',
      message: 'Siigo devolvió un stock que no es un entero.',
    };
  }

  const syncStatus = pricesAndStockMatch(
    {
      priceCop: siigo.priceCop,
      priceUsd: siigo.priceUsd,
      priceMxn: siigo.priceMxn,
      priceEur: siigo.priceEur,
    },
    {
      priceCop: decimalOrNull(product.wooPriceCop),
      priceUsd: decimalOrNull(product.wooPriceUsd),
      priceMxn: decimalOrNull(product.wooPriceMxn),
      priceEur: decimalOrNull(product.wooPriceEur),
    },
    siigo.stock,
    product.wooStock,
  )
    ? SyncStatus.SYNCED
    : SyncStatus.OUT_OF_SYNC;

  return {
    success: true,
    syncStatus,
    data: {
      siigoPriceCop: siigo.priceCop,
      siigoPriceUsd: siigo.priceUsd,
      siigoPriceMxn: siigo.priceMxn,
      siigoPriceEur: siigo.priceEur,
      siigoStock: siigo.stock,
      ...(siigo.warehouses !== null
        ? {
            siigoWarehouses: siigo.warehouses,
            siigoWarehousesUpdatedAt: checkedAt,
          }
        : {}),
      syncStatus,
      lastCheckAt: checkedAt,
    },
  };
}
