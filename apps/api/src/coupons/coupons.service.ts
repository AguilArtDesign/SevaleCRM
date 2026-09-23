import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { resolveCouponType } from '@sevale/shared';
import type { CouponListQuery, CreateCouponInput, UpdateCouponInput } from '@sevale/validation';
import type { Coupon } from '../generated/prisma/client.js';
import { CouponSyncService, type CouponSyncOutcome } from './coupon-sync.service.js';
import { CouponsRepository } from './coupons.repository.js';

function serializeCoupon(coupon: Coupon) {
  return {
    ...coupon,
    amount: Number(coupon.amount),
    dateExpires: coupon.dateExpires ? coupon.dateExpires.toISOString() : null,
  };
}

function storeLabels(failures: CouponSyncOutcome[]): string {
  return failures.map((outcome) => (outcome.store === 'SERATUS' ? 'Seratus' : 'Pali')).join(' y ');
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function invalidCouponType() {
  return new BadRequestException({
    success: false,
    error: {
      code: 'COUPON_TYPE_INVALID',
      message: 'El tipo de cupón seleccionado no está disponible.',
    },
  });
}

function duplicateCoupon() {
  return new ConflictException({
    success: false,
    error: { code: 'COUPON_DUPLICATE', message: 'Ya existe un cupón con ese código.' },
  });
}

function missingCoupon() {
  return new NotFoundException({
    success: false,
    error: { code: 'COUPON_NOT_FOUND', message: 'El cupón no existe.' },
  });
}

@Injectable()
export class CouponsService {
  constructor(
    private readonly coupons: CouponsRepository,
    private readonly sync: CouponSyncService,
  ) {}

  async list(query: CouponListQuery) {
    const [coupons, total] = await this.coupons.list(query);
    return {
      data: coupons.map(serializeCoupon),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async create(input: CreateCouponInput) {
    if (!resolveCouponType(input.type)) throw invalidCouponType();
    try {
      // El registro local es la fuente de verdad: las tiendas se actualizan con la acción
      // de sincronización, nunca como efecto secundario de la creación.
      return serializeCoupon(await this.coupons.create(input));
    } catch (error) {
      if (isUniqueConstraintError(error)) throw duplicateCoupon();
      throw error;
    }
  }

  async update(id: number, input: UpdateCouponInput) {
    if (!(await this.coupons.findById(id))) throw missingCoupon();
    if (input.type && !resolveCouponType(input.type)) throw invalidCouponType();
    try {
      return serializeCoupon(await this.coupons.update(id, input));
    } catch (error) {
      if (isUniqueConstraintError(error)) throw duplicateCoupon();
      throw error;
    }
  }

  async synchronize(id: number) {
    const current = await this.coupons.findById(id);
    if (!current) throw missingCoupon();
    // Una tienda con identificador se actualiza; una sin identificador crea el cupón allí,
    // de modo que el mismo botón sirve para recuperar una sincronización parcial anterior.
    const sync = await this.sync.synchronize(current);
    const stored = (await this.coupons.findById(id)) ?? current;
    return { ...serializeCoupon(stored), sync };
  }

  async remove(id: number) {
    const current = await this.coupons.findById(id);
    if (!current) throw missingCoupon();
    // Las tiendas se limpian antes que el registro local: si se borrara primero, un fallo
    // remoto dejaría un cupón activo en WooCommerce sin identificador para reintentar.
    const sync = await this.sync.removeFromStores(current);
    const failures = sync.filter((outcome) => outcome.action === 'FAILED');
    if (failures.length > 0) {
      throw new ConflictException({
        success: false,
        error: {
          code: 'COUPON_DELETE_INCOMPLETE',
          message: `El cupón no se eliminó porque ${storeLabels(failures)} no pudo borrarlo. Vuelve a intentarlo para completar la eliminación.`,
        },
      });
    }
    await this.coupons.delete(id);
    return { deleted: true as const, coupon: serializeCoupon(current), sync };
  }
}
