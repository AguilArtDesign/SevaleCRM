import { Injectable } from '@nestjs/common';
import type { ProductListQuery } from '@sevale/validation';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

@Injectable()
export class ProductsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list({ search, store, syncStatus, page, pageSize }: ProductListQuery) {
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
      ...(syncStatus ? { syncStatus } : {}),
    };

    return this.prisma.$transaction([
      this.prisma.product.findMany({
        where,
        orderBy: [{ updatedAt: 'desc' }, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.product.count({ where }),
    ]);
  }

  findById(id: number) {
    return this.prisma.product.findUnique({ where: { id } });
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
