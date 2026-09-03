import { Injectable } from '@nestjs/common';
import type { Prisma } from '../../generated/prisma/client.js';
import { PrismaService } from '../../database/prisma.service.js';

@Injectable()
export class SiigoWebhookRepository {
  constructor(private readonly prisma: PrismaService) {}

  findBySiigoId(siigoId: string) {
    return this.prisma.product.findUnique({ where: { siigoId } });
  }

  update(siigoId: string, data: Prisma.ProductUpdateInput) {
    return this.prisma.product.update({ where: { siigoId }, data });
  }
}
