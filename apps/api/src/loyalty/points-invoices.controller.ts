import {
  BadRequestException,
  Body,
  Controller,
  ForbiddenException,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  pointsAccountLookupSchema,
  pointsAccrualSchema,
  pointsInvoiceListQuerySchema,
  pointsInvoiceIdSchema,
  pointsInvoiceSearchSchema,
} from '@sevale/validation';
import type { ZodType } from 'zod';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { puntosColombiaAdminOnly } from '../integrations/puntos-colombia/puntos-colombia-config.js';
import { PointsInvoicesService, type SessionUser } from './points-invoices.service.js';

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
 * Panel de Puntos Colombia. Mientras se certifica, solo el administrador puede operarlo: el permiso
 * `loyalty.accrue` lo tienen únicamente los administradores, así que ocultar el menú no es la única
 * barrera. La bandera `PCO_ADMIN_ONLY` permite cerrarlo del todo sin desplegar código.
 */
@Controller('points-colombia')
@RequirePermissions('loyalty.read')
export class PointsInvoicesController {
  constructor(private readonly points: PointsInvoicesService) {}

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

  @Get('invoices')
  list(@Query() query: unknown) {
    return this.points.list(parseInput(pointsInvoiceListQuerySchema, query));
  }

  @Get('invoices/prefixes')
  prefixes() {
    return this.points.prefixOptions();
  }

  @Get('invoices/:id')
  detail(@Param('id') id: string) {
    return this.points.detail(parseInput(pointsInvoiceIdSchema, id));
  }

  @Post('invoices/search')
  search(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.points.search(parseInput(pointsInvoiceSearchSchema, body), this.user(request));
  }

  @Post('invoices')
  register(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.points.register(parseInput(pointsInvoiceSearchSchema, body), this.user(request));
  }

  @Post('accounts/lookup')
  lookup(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    this.user(request);
    return this.points.lookupAccount(parseInput(pointsAccountLookupSchema, body));
  }

  @Post('invoices/:id/accrue')
  accrue(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.points.accrue(
      parseInput(pointsInvoiceIdSchema, id),
      parseInput(pointsAccrualSchema, body),
      this.user(request),
    );
  }

  /**
   * Anular los puntos ya acreditados. Va con su propio permiso porque es destructivo: dejarlo en
   * `loyalty.accrue` haría que habilitar la acumulación habilitara también la revocación.
   */
  @Post('invoices/:id/revoke')
  @RequirePermissions('loyalty.revoke')
  revoke(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.points.revoke(parseInput(pointsInvoiceIdSchema, id), this.user(request));
  }
}
