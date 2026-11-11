import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  orderOperationIdSchema,
  shipmentListQuerySchema,
  shipmentNoteSchema,
} from '@sevale/validation';
import type { ZodType } from 'zod';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { ShipmentsService } from './shipments.service.js';

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
 * Panel de Envíos. La lectura va con `shipments.read`, que hoy solo tiene el administrador: no se
 * reutiliza `orders.read` para poder cerrar este panel sin cerrar Pedidos. Escribir la guía sigue
 * siendo `orders.shipping.update` y va por `PUT /api/orders/:id/shipment`, que es donde ya vive esa
 * regla y no conviene duplicarla. Lo único que se escribe aquí es la novedad, que es historial del
 * envío y no toca el pedido de la tienda.
 */
@Controller('shipments')
@RequirePermissions('shipments.read')
export class ShipmentsController {
  constructor(private readonly shipments: ShipmentsService) {}

  @Get()
  list(@Query() query: unknown) {
    return this.shipments.list(parseInput(shipmentListQuerySchema, query));
  }

  @Get(':operationId')
  history(@Param('operationId') operationId: string) {
    return this.shipments.history(parseInput(orderOperationIdSchema, operationId));
  }

  /**
   * Una novedad es una escritura sobre el envío, así que pide las dos llaves: la del panel y la de
   * escritura. El decorador del método reemplaza al de la clase, no se suma, así que van juntas.
   */
  @Post(':operationId/events')
  @RequirePermissions('shipments.read', 'orders.shipping.update')
  addNote(
    @Param('operationId') operationId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    const { note } = parseInput(shipmentNoteSchema, body);
    return this.shipments.addNote(
      parseInput(orderOperationIdSchema, operationId),
      note,
      request.auth.user.id,
    );
  }
}
