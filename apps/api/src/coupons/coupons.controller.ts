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
  Req,
} from '@nestjs/common';
import {
  couponIdSchema,
  couponListQuerySchema,
  createCouponSchema,
  updateCouponSchema,
} from '@sevale/validation';
import type { ZodType } from 'zod';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
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

// El detalle técnico de las integraciones se reserva al administrador, igual que en Clientes.
function canViewIntegrationErrors(request: AuthenticatedRequest): boolean {
  return request.auth.user.role === 'ADMIN';
}

@Controller('coupons')
@RequirePermissions('coupons.read')
export class CouponsController {
  constructor(private readonly coupons: CouponsService) {}

  @Get()
  list(@Query() query: unknown, @Req() request: AuthenticatedRequest) {
    return this.coupons.list(
      parseInput(couponListQuerySchema, query),
      canViewIntegrationErrors(request),
    );
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

  @Post(':id/sync')
  @RequirePermissions('coupons.sync')
  synchronize(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.coupons.synchronize(
      parseInput(couponIdSchema, id),
      canViewIntegrationErrors(request),
    );
  }

  @Delete(':id')
  @RequirePermissions('coupons.delete')
  remove(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.coupons.remove(parseInput(couponIdSchema, id), canViewIntegrationErrors(request));
  }
}
