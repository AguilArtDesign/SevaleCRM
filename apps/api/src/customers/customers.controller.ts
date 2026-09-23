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
  createCustomerSchema,
  customerIdSchema,
  customerListQuerySchema,
  customerSiigoLookupSchema,
  customerSyncSchema,
  updateCustomerSchema,
} from '@sevale/validation';
import type { ZodType } from 'zod';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { CustomersService } from './customers.service.js';

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

function canViewIntegrationErrors(request: AuthenticatedRequest): boolean {
  return request.auth.user.role === 'ADMIN';
}

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions('customers.read')
  list(@Query() query: unknown, @Req() request: AuthenticatedRequest) {
    return this.customers.list(
      parseInput(customerListQuerySchema, query),
      canViewIntegrationErrors(request),
    );
  }

  @Get('siigo-lookup')
  @RequirePermissions('customers.create')
  lookupSiigo(@Query() query: unknown) {
    const input = parseInput(customerSiigoLookupSchema, query);
    return this.customers.resolve(input.identification);
  }

  @Get('resolve')
  @RequirePermissions('customers.create')
  resolve(@Query() query: unknown) {
    const input = parseInput(customerSiigoLookupSchema, query);
    return this.customers.resolve(input.identification);
  }

  @Get(':id')
  @RequirePermissions('customers.read')
  detail(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.customers.detail(
      parseInput(customerIdSchema, id),
      canViewIntegrationErrors(request),
    );
  }

  @Post()
  @RequirePermissions('customers.create')
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.customers.create(
      parseInput(createCustomerSchema, body),
      canViewIntegrationErrors(request),
    );
  }

  @Patch(':id')
  @RequirePermissions('customers.update')
  update(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.customers.update(
      parseInput(customerIdSchema, id),
      parseInput(updateCustomerSchema, body),
      canViewIntegrationErrors(request),
    );
  }

  @Delete(':id')
  @RequirePermissions('customers.delete')
  remove(@Param('id') id: string, @Req() request: AuthenticatedRequest) {
    return this.customers.remove(
      parseInput(customerIdSchema, id),
      canViewIntegrationErrors(request),
    );
  }

  @Post(':id/sync')
  @RequirePermissions('customers.sync')
  sync(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.customers.sync(
      parseInput(customerIdSchema, id),
      parseInput(customerSyncSchema, body),
      canViewIntegrationErrors(request),
    );
  }
}
