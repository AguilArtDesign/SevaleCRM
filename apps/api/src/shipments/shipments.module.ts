import { Module } from '@nestjs/common';
import { ShipmentsController } from './shipments.controller.js';
import { ShipmentsRepository } from './shipments.repository.js';
import { ShipmentsService } from './shipments.service.js';

/**
 * Solo lectura: el panel lista lo que ya está listo para despachar. Asignar la guía y la
 * transportadora sigue pasando por el endpoint de Pedidos, que es donde vive la regla de qué
 * operación puede llevar envío.
 */
@Module({
  controllers: [ShipmentsController],
  providers: [ShipmentsRepository, ShipmentsService],
})
export class ShipmentsModule {}
