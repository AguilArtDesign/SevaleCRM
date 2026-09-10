import { Injectable } from '@nestjs/common';
import type { ProductListQuery } from '@sevale/validation';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list({ search, store, syncStatus, stockSort, page, pageSize }: ProductListQuery) {
    const where: Prisma.ProductWhereInput = {
      ...(search
        ? {
            OR: [
              { productName: { contains: search } },
              { sku: { contains: search } },
              { wooSku: { contains: search } },
            ],
          }
        : {}),
      ...(store ? { store } : {}),
      ...(syncStatus === 'OUT_OF_STOCK' ? { siigoStock: 0 } : syncStatus ? { syncStatus } : {}),
    };

    return this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: stockSort
          ? [{ siigoStock: stockSort }, { id: 'asc' }]
          : [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
  }

  findById(id: number) {
    return this.prisma.product.findUnique({ where: { id } });
  }

  findByIds(ids: number[]) {
    return this.prisma.product.findMany({
      where: { id: { in: ids } },
      orderBy: [{ sku: 'asc' }, { id: 'asc' }],
    });
  }

  findBySku(sku: string) {
    return this.prisma.product.findUnique({ where: { sku } });
  }

  create(data: Prisma.ProductUncheckedCreateInput) {
    return this.prisma.product.create({ data });
  }

  update(id: number, data: Prisma.ProductUncheckedUpdateInput) {
    return this.prisma.product.update({ where: { id }, data });
  }

  delete(id: number) {
    return this.prisma.product.delete({ where: { id } });
  }
}
