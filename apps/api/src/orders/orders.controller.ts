import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  Param,
  Patch,
  Post,
  Put,
  Query,
  Req,
} from '@nestjs/common';
import {
  createSiigoQuotationSchema,
  createOrderOperationSchema,
  orderIdSchema,
  orderListQuerySchema,
  orderOperationIdSchema,
  updateOrderOperationSchema,
  updateShipmentSchema,
} from '@sevale/validation';
import type { ZodType } from 'zod';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { OrdersService } from './orders.service.js';

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

@Controller('orders')
@RequirePermissions('orders.read')
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @Get()
  list(@Query() query: unknown) {
    return this.orders.list(parseInput(orderListQuerySchema, query));
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.orders.detail(parseInput(orderOperationIdSchema, id));
  }

  @Post()
  @RequirePermissions('orders.create')
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.orders.create(parseInput(createOrderOperationSchema, body), request.auth.user.id);
  }

  @Patch(':id')
  @RequirePermissions('orders.update')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.orders.update(
      parseInput(orderOperationIdSchema, id),
      parseInput(updateOrderOperationSchema, body),
    );
  }

  @Delete(':id')
  @RequirePermissions('orders.delete')
  remove(@Param('id') id: string) {
    return this.orders.remove(parseInput(orderOperationIdSchema, id));
  }

  @Post(':id/complete')
  @RequirePermissions('orders.complete')
  complete(@Param('id') id: string) {
    return this.orders.complete(parseInput(orderOperationIdSchema, id));
  }

  @Post(':id/sync')
  @RequirePermissions('orders.sync.retry')
  retrySync(@Param('id') id: string) {
    return this.orders.retrySync(parseInput(orderOperationIdSchema, id));
  }

  @Post('rows/:id/sync')
  @RequirePermissions('orders.sync.retry')
  retryOrderSync(@Param('id') id: string) {
    return this.orders.retryOrderSync(parseInput(orderIdSchema, id));
  }

  @Put(':id/shipment')
  @RequirePermissions('orders.shipping.update')
  updateShipment(
    @Param('id') id: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.orders.updateShipment(
      parseInput(orderOperationIdSchema, id),
      parseInput(updateShipmentSchema, body),
      request.auth.user.id,
    );
  }

  @Post(':id/shipment/sync')
  @RequirePermissions('orders.shipping.update')
  retryShipmentSync(@Param('id') id: string) {
    return this.orders.retryShipmentSync(parseInput(orderOperationIdSchema, id));
  }

  @Post(':id/siigo-quotation')
  @RequirePermissions('orders.siigo_quote.create')
  createSiigoQuotation(@Param('id') id: string, @Body() body: unknown) {
    return this.orders.createSiigoQuotation(
      parseInput(orderOperationIdSchema, id),
      parseInput(createSiigoQuotationSchema, body),
    );
  }
}
