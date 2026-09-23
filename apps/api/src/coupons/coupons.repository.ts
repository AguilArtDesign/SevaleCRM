import { Injectable } from '@nestjs/common';
import type { CouponListQuery, CreateCouponInput, UpdateCouponInput } from '@sevale/validation';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma, CouponSyncStatus, Store } from '../generated/prisma/client.js';

@Injectable()
export class CouponsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list({ search, page, pageSize, sort, order }: CouponListQuery) {
    const where: Prisma.CouponWhereInput = search
      ? { OR: [{ coupon: { contains: search } }, { description: { contains: search } }] }
      : {};
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

  // Toda edición local invalida la sincronización anterior, así que el cupón vuelve a pendiente
  // y el panel deja de mostrarlo como sincronizado hasta el próximo envío a las tiendas.
  update(id: number, data: UpdateCouponInput) {
    return this.prisma.coupon.update({ where: { id }, data: { ...data, syncStatus: 'PENDING' } });
  }

  delete(id: number) {
    return this.prisma.coupon.delete({ where: { id } });
  }

  saveExternalId(couponId: number, store: Store, externalId: number) {
    return this.prisma.coupon.update({
      where: { id: couponId },
      data: store === 'SERATUS' ? { seratusCouponId: externalId } : { paliCouponId: externalId },
    });
  }

  saveSyncStatus(couponId: number, status: CouponSyncStatus) {
    return this.prisma.coupon.update({ where: { id: couponId }, data: { syncStatus: status } });
  }
}
