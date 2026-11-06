import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import {
  pointsAccountLookupSchema,
  pointsInvoiceIdSchema,
  pointsRedemptionInvoiceSchema,
  pointsRedemptionSchema,
} from '@sevale/validation';
import type { ZodType } from 'zod';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { puntosColombiaAdminOnly } from '../integrations/puntos-colombia/puntos-colombia-config.js';
import type { SessionUser } from './points-invoices.service.js';
import { PointsRedemptionsService } from './points-redemptions.service.js';

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

/**
 * Redención de puntos. Va en su propio controlador porque es un permiso distinto de acumular: redimir
 * le quita puntos al cliente y acumular se los suma.
 */
@Controller('points-colombia/redemptions')
@RequirePermissions('loyalty.read')
export class PointsRedemptionsController {
  constructor(private readonly redemptions: PointsRedemptionsService) {}

  private user(request: AuthenticatedRequest): SessionUser {
    const { id, role } = request.auth.user;
    if (puntosColombiaAdminOnly() && role !== 'ADMIN') {
      throw new ForbiddenException({
        success: false,
        error: {
          code: 'POINTS_ADMIN_ONLY',
          message: 'El panel de Puntos Colombia está habilitado solo para administradores.',
        },
      });
    }
    return { id, role };
  }

  /** Primer paso del modal: el cliente existe y cuántos puntos tiene. */
  @Post('lookup')
  lookup(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    this.user(request);
    return this.redemptions.lookup(parseInput(pointsAccountLookupSchema, body));
  }

  /**
   * Pide el código de un solo uso. El cliente lo recibe en su celular o su correo y se lo dicta al
   * comercial: el CRM nunca lo ve ni lo guarda.
   */
  @Post('challenge')
  challenge(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    this.user(request);
    return this.redemptions.requestChallenge(parseInput(pointsAccountLookupSchema, body));
  }

  @Post()
  @RequirePermissions('loyalty.redeem')
  redeem(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.redemptions.redeem(parseInput(pointsRedemptionSchema, body), this.user(request));
  }

  /** Asocia la factura de Siigo que documenta la venta y cierra la redención. */
  @Post(':id/invoice')
  attachInvoice(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.redemptions.attachInvoice(
      parseInput(pointsInvoiceIdSchema, id),
      parseInput(pointsRedemptionInvoiceSchema, body),
      this.user(request),
    );
  }
}
