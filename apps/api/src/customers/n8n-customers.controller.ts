import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Post,
  Query,
  UseGuards,
} from '@nestjs/common';
import { n8nCustomerLookupSchema, n8nCustomerUpsertSchema } from '@sevale/validation';
import type { ZodType } from 'zod';
import { Public } from '../auth/public.decorator.js';
import { N8nApiKeyGuard } from '../integrations/n8n/n8n-api-key.guard.js';
import { CustomersService } from './customers.service.js';

function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new BadRequestException({
    success: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: result.error.issues[0]?.message || 'Los datos del cliente no son válidos.',
    },
  });
}

/**
 * Clientes para n8n: consultar por documento y crear o vincular con los identificadores de cada tienda.
 * Ambas rutas exigen la clave de integración (Authorization: Bearer N8N_API_KEY).
 */
@Controller('integrations/n8n/customers')
@Public()
@UseGuards(N8nApiKeyGuard)
export class N8nCustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  lookup(@Query() query: unknown) {
    return this.customers.lookupForIntegration(parseInput(n8nCustomerLookupSchema, query));
  }

  @Post()
  @HttpCode(200)
  upsert(@Body() body: unknown) {
    return this.customers.upsertForIntegration(parseInput(n8nCustomerUpsertSchema, body));
  }
}
