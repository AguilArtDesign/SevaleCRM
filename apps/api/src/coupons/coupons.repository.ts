import { Injectable } from '@nestjs/common';
import type { CouponListQuery, CreateCouponInput, UpdateCouponInput } from '@sevale/validation';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma, CouponSyncStatus, Store } from '../generated/prisma/client.js';
import type { CouponSyncOutcome } from './coupon-sync.service.js';

// Solo un fallo deja diagnóstico; un intento correcto limpia el error anterior de esa tienda.
function failedCode(outcome: CouponSyncOutcome | undefined): string | null {
  return outcome?.action === 'FAILED' ? outcome.errorCode : null;
}

function failedMessage(outcome: CouponSyncOutcome | undefined): string | null {
  return outcome?.action === 'FAILED' ? outcome.errorMessage : null;
}

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

  // Toda edición local invalida la sincronización anterior, así que el cupón vuelve a pendiente,
  // el panel deja de mostrarlo como sincronizado y el diagnóstico previo deja de aplicar.
  update(id: number, data: UpdateCouponInput) {
    return this.prisma.coupon.update({
      where: { id },
      data: {
        ...data,
        syncStatus: 'PENDING',
        seratusLastErrorCode: null,
        seratusLastErrorMessage: null,
        paliLastErrorCode: null,
        paliLastErrorMessage: null,
      },
    });
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

  // El estado resume el intento (las dos tiendas, una o ninguna) y el detalle por tienda se guarda
  // para que un administrador pueda comprobar mucho después por qué el cupón quedó incompleto.
  saveSyncResult(couponId: number, status: CouponSyncStatus, outcomes: CouponSyncOutcome[]) {
    const seratus = outcomes.find((outcome) => outcome.store === 'SERATUS');
    const pali = outcomes.find((outcome) => outcome.store === 'PALI');
    return this.prisma.coupon.update({
      where: { id: couponId },
      data: {
        syncStatus: status,
        lastSyncAt: new Date(),
        seratusLastErrorCode: failedCode(seratus),
        seratusLastErrorMessage: failedMessage(seratus),
        paliLastErrorCode: failedCode(pali),
        paliLastErrorMessage: failedMessage(pali),
      },
    });
  }
}
