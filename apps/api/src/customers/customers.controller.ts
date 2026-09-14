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
  createCustomerSchema,
  customerIdSchema,
  customerListQuerySchema,
  customerSiigoLookupSchema,
  customerSyncSchema,
  updateCustomerSchema,
} from '@sevale/validation';
import type { ZodType } from 'zod';
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

@Controller('customers')
export class CustomersController {
  constructor(private readonly customers: CustomersService) {}

  @Get()
  @RequirePermissions('customers.read')
  list(@Query() query: unknown) {
    return this.customers.list(parseInput(customerListQuerySchema, query));
  }

  @Get('siigo-lookup')
  @RequirePermissions('customers.create')
  lookupSiigo(@Query() query: unknown) {
    const input = parseInput(customerSiigoLookupSchema, query);
    return this.customers.lookupSiigo(input.identification);
  }

  @Get(':id')
  @RequirePermissions('customers.read')
  detail(@Param('id') id: string) {
    return this.customers.detail(parseInput(customerIdSchema, id));
  }

  @Post()
  @RequirePermissions('customers.create')
  create(@Body() body: unknown) {
    return this.customers.create(parseInput(createCustomerSchema, body));
  }

  @Patch(':id')
  @RequirePermissions('customers.update')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.customers.update(
      parseInput(customerIdSchema, id),
      parseInput(updateCustomerSchema, body),
    );
  }

  @Delete(':id')
  @RequirePermissions('customers.delete')
  remove(@Param('id') id: string) {
    return this.customers.remove(parseInput(customerIdSchema, id));
  }

  @Post(':id/sync')
  @RequirePermissions('customers.sync')
  sync(@Param('id') id: string, @Body() body: unknown) {
    return this.customers.sync(
      parseInput(customerIdSchema, id),
      parseInput(customerSyncSchema, body),
    );
  }
}
