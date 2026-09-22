import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Query,
} from '@nestjs/common';
import {
  couponIdSchema,
  couponListQuerySchema,
  createCouponSchema,
  updateCouponSchema,
} from '@sevale/validation';
import type { ZodType } from 'zod';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { CouponsService } from './coupons.service.js';

function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new BadRequestException({
    success: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: result.error.issues[0]?.message || 'Los datos enviados no son válidos.',
    },
  });
}

@Controller('coupons')
@RequirePermissions('coupons.read')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  list(@Query() query: unknown) {
    return this.coupons.list(parseInput(couponListQuerySchema, query));
  }

  @Post()
  @RequirePermissions('coupons.create')
  create(@Body() body: unknown) {
    return this.coupons.create(parseInput(createCouponSchema, body));
  }

  @Patch(':id')
  @RequirePermissions('coupons.update')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.coupons.update(
      parseInput(couponIdSchema, id),
      parseInput(updateCouponSchema, body),
    );
  }

  @Delete(':id')
  @RequirePermissions('coupons.delete')
  deactivate(@Param('id') id: string) {
    return this.coupons.deactivate(parseInput(couponIdSchema, id));
  }
}
