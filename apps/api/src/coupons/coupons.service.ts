import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { resolveCouponType } from '@sevale/shared';
import type { CouponListQuery, CreateCouponInput, UpdateCouponInput } from '@sevale/validation';
import type { Coupon } from '../generated/prisma/client.js';
import { CouponsRepository } from './coupons.repository.js';

function serializeCoupon(coupon: Coupon) {
  return { ...coupon, amount: Number(coupon.amount) };
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

@Injectable()
export class CouponsService {
  constructor(private readonly coupons: CouponsRepository) {}

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
      return serializeCoupon(await this.coupons.create(input));
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException({
          success: false,
          error: { code: 'COUPON_DUPLICATE', message: 'Ya existe un cupón con ese código.' },
        });
      }
      throw error;
    }
  }

  async update(id: number, input: UpdateCouponInput) {
    const current = await this.coupons.findById(id);
    if (!current) {
      throw new NotFoundException({
        success: false,
        error: { code: 'COUPON_NOT_FOUND', message: 'El cupón no existe.' },
      });
    }
    if (input.type && !resolveCouponType(input.type)) throw invalidCouponType();
    try {
      return serializeCoupon(await this.coupons.update(id, input));
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw new ConflictException({
          success: false,
          error: { code: 'COUPON_DUPLICATE', message: 'Ya existe un cupón con ese código.' },
        });
      }
      throw error;
    }
  }

  async deactivate(id: number) {
    return this.update(id, { active: false });
  }
}
