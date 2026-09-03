import { Injectable, NotFoundException } from '@nestjs/common';
import type { ProductListQuery } from '@sevale/validation';
import type { Product } from '../generated/prisma/client.js';
import { ProductsRepository } from './products.repository.js';

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
  constructor(private readonly productsRepository: ProductsRepository) {}

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
}
