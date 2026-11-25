import {
  BadGatewayException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { ProductListQuery } from '@sevale/validation';
import { displayWarehouses, parseWarehouseSnapshot } from '../common/product-warehouses.js';
import { SyncStatus, type Product } from '../generated/prisma/client.js';
import { SiigoService } from '../integrations/siigo/siigo.service.js';
import { WooCommerceService } from '../integrations/woocommerce/woocommerce.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { ProductsRepository } from './products.repository.js';
import { createInventoryWorkbook } from './product-export.js';
import { decimalOrNull, numericChange } from './product-prices.js';
import { buildSiigoRefresh } from './product-siigo-refresh.js';

export function serializeProduct(product: Product) {
  return {
    ...product,
    siigoPriceCop: Number(product.siigoPriceCop),
    siigoPriceUsd: Number(product.siigoPriceUsd),
    siigoPriceMxn: decimalOrNull(product.siigoPriceMxn),
    siigoPriceEur: decimalOrNull(product.siigoPriceEur),
    wooPriceCop: Number(product.wooPriceCop),
    wooPriceUsd: Number(product.wooPriceUsd),
    wooPriceMxn: decimalOrNull(product.wooPriceMxn),
    wooPriceEur: decimalOrNull(product.wooPriceEur),
    wooParentId: product.wooParentId?.toString() ?? null,
    wooVariationId: product.wooVariationId?.toString() ?? null,
    siigoWarehouses: displayWarehouses(parseWarehouseSnapshot(product.siigoWarehouses)),
    siigoWarehousesUpdatedAt: product.siigoWarehousesUpdatedAt,
  };
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly productsRepository: ProductsRepository,
    private readonly realtime: RealtimeGateway,
    private readonly wooCommerce: WooCommerceService,
    private readonly siigo: SiigoService,
  ) {}

  async list(query: ProductListQuery) {
    const [products, total] = await this.productsRepository.list(query);
    return {
      data: products.map(serializeProduct),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async detail(id: number) {
    const product = await this.productsRepository.findById(id);
    if (!product) {
      throw new NotFoundException({
        success: false,
        error: { code: 'PRODUCT_NOT_FOUND', message: 'El producto no existe.' },
      });
    }
    return serializeProduct(product);
  }

  /**
   * Carga el snapshot informativo de bodegas. Si el producto ya lo tiene, responde con lo
   * guardado en la base y no vuelve a consultar Siigo: la primera lectura se persiste y las
   * siguientes se resuelven localmente. n8n es quien refresca el snapshot en las actualizaciones
   * de producto. No toca stock, precios ni estado de sincronización.
   */
  async refreshWarehouses(id: number) {
    const product = await this.productsRepository.findById(id);
    if (!product) {
      throw new NotFoundException({
        success: false,
        error: { code: 'PRODUCT_NOT_FOUND', message: 'El producto no existe.' },
      });
    }

    if (product.siigoWarehouses !== null) {
      return {
        success: true as const,
        productId: product.id,
        warehouses: displayWarehouses(parseWarehouseSnapshot(product.siigoWarehouses)) ?? [],
        updatedAt: product.siigoWarehousesUpdatedAt?.toISOString() ?? '',
      };
    }

    const siigo = await this.siigo.searchProductBySku(product.sku);
    if (!siigo) {
      throw new NotFoundException({
        success: false,
        error: {
          code: 'PRODUCT_NOT_FOUND_IN_SIIGO',
          message: 'El producto ya no existe en Siigo.',
        },
      });
    }
    if (siigo.warehouses === null) {
      throw new BadGatewayException({
        success: false,
        error: {
          code: 'SIIGO_WAREHOUSES_UNAVAILABLE',
          message: 'Siigo no devolvió el desglose de bodegas del producto.',
        },
      });
    }

    const capturedAt = new Date();
    await this.productsRepository.saveWarehouseSnapshot(
      product.id,
      siigo.warehouses,
      capturedAt,
      product.updatedAt,
    );
    return {
      success: true as const,
      productId: product.id,
      warehouses: displayWarehouses(siigo.warehouses) ?? [],
      updatedAt: capturedAt.toISOString(),
    };
  }

  /**
   * Trae de nuevo los datos de Siigo para un producto y recalcula el estado contra el espejo
   * de WooCommerce. No envía nada a la tienda: el administrador puede usar Sincronizar después.
   */
  async refreshFromSiigo(id: number) {
    const product = await this.productsRepository.findById(id);
    if (!product) {
      throw new NotFoundException({
        success: false,
        error: { code: 'PRODUCT_NOT_FOUND', message: 'El producto no existe.' },
      });
    }

    const siigo = await this.siigo.searchProductBySku(product.sku);
    if (!siigo) {
      throw new NotFoundException({
        success: false,
        error: {
          code: 'PRODUCT_NOT_FOUND_IN_SIIGO',
          message: 'El producto ya no existe en Siigo.',
        },
      });
    }
    const checkedAt = new Date();
    const refresh = buildSiigoRefresh(product, siigo, checkedAt);
    if (!refresh.success) {
      throw new UnprocessableEntityException({
        success: false,
        error: { code: refresh.code, message: refresh.message },
      });
    }

    const updated = await this.productsRepository.update(product.id, refresh.data);

    this.realtime.emitProductUpdated(updated, {
      priceCop: numericChange(decimalOrNull(product.siigoPriceCop), siigo.priceCop),
      priceUsd: numericChange(decimalOrNull(product.siigoPriceUsd), siigo.priceUsd),
      priceMxn: numericChange(decimalOrNull(product.siigoPriceMxn), siigo.priceMxn),
      priceEur: numericChange(decimalOrNull(product.siigoPriceEur), siigo.priceEur),
      stock: numericChange(product.siigoStock, siigo.stock),
      syncStatus:
        product.syncStatus === refresh.syncStatus
          ? null
          : { previous: product.syncStatus, current: refresh.syncStatus },
    });

    return serializeProduct(updated);
  }

  async export(ids: number[]) {
    const products = await this.productsRepository.findByIds(ids);
    if (products.length !== ids.length) {
      throw new NotFoundException({
        success: false,
        error: {
          code: 'PRODUCTS_NOT_FOUND',
          message: 'Uno o más productos seleccionados ya no existen.',
        },
      });
    }

    const buffer = createInventoryWorkbook(products);
    const date = new Date().toISOString().slice(0, 10);
    return { buffer, filename: `inventario-seleccionado-${date}.xlsx` };
  }

  async remove(id: number) {
    const product = await this.productsRepository.findById(id);
    if (!product) {
      throw new NotFoundException({
        success: false,
        error: { code: 'PRODUCT_NOT_FOUND', message: 'El producto no existe.' },
      });
    }

    const deleted = await this.productsRepository.delete(id);
    this.realtime.emitProductDeleted(deleted);
    return serializeProduct(deleted);
  }

  async sync(id: number) {
    const product = await this.productsRepository.findById(id);
    if (!product) {
      throw new NotFoundException({
        success: false,
        error: { code: 'PRODUCT_NOT_FOUND', message: 'El producto no existe.' },
      });
    }
    if (!product.wooVariationId) {
      throw new UnprocessableEntityException({
        success: false,
        error: {
          code: 'WOOCOMMERCE_PRODUCT_ID_MISSING',
          message: 'El producto no tiene un identificador válido de WooCommerce.',
        },
      });
    }

    try {
      await this.wooCommerce.updateProduct({
        store: product.store,
        parentId: product.wooParentId?.toString() ?? null,
        productId: product.wooVariationId.toString(),
        priceCop: Number(product.siigoPriceCop),
        priceUsd: Number(product.siigoPriceUsd),
        priceMxn: decimalOrNull(product.siigoPriceMxn),
        priceEur: decimalOrNull(product.siigoPriceEur),
        stock: product.siigoStock,
      });
    } catch (error) {
      const failed = await this.productsRepository.update(product.id, {
        syncStatus: SyncStatus.ERROR,
      });
      this.realtime.emitProductUpdated(failed, {
        priceCop: null,
        priceUsd: null,
        priceMxn: null,
        priceEur: null,
        stock: null,
        syncStatus:
          product.syncStatus === failed.syncStatus
            ? null
            : { previous: product.syncStatus, current: failed.syncStatus },
      });
      throw error;
    }

    const synchronized = await this.productsRepository.update(product.id, {
      wooPriceCop: product.siigoPriceCop,
      wooPriceUsd: product.siigoPriceUsd,
      wooPriceMxn: product.siigoPriceMxn,
      wooPriceEur: product.siigoPriceEur,
      wooStock: product.siigoStock,
      syncStatus: SyncStatus.SYNCED,
      lastSyncAt: new Date(),
    });
    this.realtime.emitProductUpdated(synchronized, {
      priceCop: null,
      priceUsd: null,
      priceMxn: null,
      priceEur: null,
      stock: null,
      syncStatus:
        product.syncStatus === synchronized.syncStatus
          ? null
          : { previous: product.syncStatus, current: synchronized.syncStatus },
    });
    return serializeProduct(synchronized);
  }
}
