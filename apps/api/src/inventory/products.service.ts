import { Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import type { ProductListQuery } from '@sevale/validation';
import { SyncStatus, type Product } from '../generated/prisma/client.js';
import { WooCommerceService } from '../integrations/woocommerce/woocommerce.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { ProductsRepository } from './products.repository.js';
import { createInventoryWorkbook } from './product-export.js';

export function serializeProduct(product: Product) {
  return {
    ...product,
    siigoPriceCop: Number(product.siigoPriceCop),
    siigoPriceUsd: Number(product.siigoPriceUsd),
    wooPriceCop: Number(product.wooPriceCop),
    wooPriceUsd: Number(product.wooPriceUsd),
    wooParentId: product.wooParentId?.toString() ?? null,
    wooVariationId: product.wooVariationId?.toString() ?? null,
  };
}

@Injectable()
export class ProductsService {
  constructor(
    private readonly productsRepository: ProductsRepository,
    private readonly realtime: RealtimeGateway,
    private readonly wooCommerce: WooCommerceService,
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
        stock: product.siigoStock,
      });
    } catch (error) {
      const failed = await this.productsRepository.update(product.id, {
        syncStatus: SyncStatus.ERROR,
      });
      this.realtime.emitProductUpdated(failed, {
        priceCop: null,
        priceUsd: null,
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
      wooStock: product.siigoStock,
      syncStatus: SyncStatus.SYNCED,
      lastSyncAt: new Date(),
    });
    this.realtime.emitProductUpdated(synchronized, {
      priceCop: null,
      priceUsd: null,
      stock: null,
      syncStatus:
        product.syncStatus === synchronized.syncStatus
          ? null
          : { previous: product.syncStatus, current: synchronized.syncStatus },
    });
    return serializeProduct(synchronized);
  }
}
