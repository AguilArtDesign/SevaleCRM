import { Injectable } from '@nestjs/common';
import type { CouponListQuery, CreateCouponInput, UpdateCouponInput } from '@sevale/validation';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

@Injectable()
export class CouponsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list({ search, active, page, pageSize, sort, order }: CouponListQuery) {
    const where: Prisma.CouponWhereInput = {
      ...(active === undefined ? {} : { active }),
      ...(search
        ? {
            OR: [{ coupon: { contains: search } }, { description: { contains: search } }],
          }
        : {}),
    };
    const orderBy = { [sort]: order } as Prisma.CouponOrderByWithRelationInput;

    return this.prisma.$transaction([
      this.prisma.coupon.findMany({
        where,
        orderBy: [orderBy, { id: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.coupon.count({ where }),
    ]);
  }

  findById(id: number) {
    return this.prisma.coupon.findUnique({ where: { id } });
  }

  create(data: CreateCouponInput) {
    return this.prisma.coupon.create({ data });
  }

  update(id: number, data: UpdateCouponInput) {
    return this.prisma.coupon.update({ where: { id }, data });
  }
}
