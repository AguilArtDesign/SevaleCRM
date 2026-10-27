import { BadRequestException, Controller, Delete, Get, Param, Query } from '@nestjs/common';
import { logIdSchema, logListQuerySchema } from '@sevale/validation';
import type { ZodType } from 'zod';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { IntegrationLogsService } from './integration-logs.service.js';

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
 * Bitácora de las llamadas a las APIs externas. Solo la administración la ve: expone cuerpos de
 * peticiones con datos de clientes y pedidos.
 */
@Controller('logs')
@RequirePermissions('logs.read')
export class LogsController {
  constructor(private readonly logs: IntegrationLogsService) {}

  @Get()
  list(@Query() query: unknown) {
    return this.logs.list(parseInput(logListQuerySchema, query));
  }

  @Get('facets')
  facets() {
    return this.logs.facets();
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.logs.detail(parseInput(logIdSchema, id));
  }

  @Delete()
  @RequirePermissions('logs.clear')
  clear() {
    return this.logs.clear();
  }
}
