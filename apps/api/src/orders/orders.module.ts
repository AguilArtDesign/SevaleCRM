import { Module } from '@nestjs/common';
import { OrdersController } from './orders.controller.js';
import { OrdersRepository } from './orders.repository.js';
import { OrdersService } from './orders.service.js';
import { N8nApiKeyGuard } from '../integrations/n8n/n8n-api-key.guard.js';
import { WooOrderInboundController } from './woo-order-inbound.controller.js';
import { WooOrderInboundRepository } from './woo-order-inbound.repository.js';
import { WooOrderInboundService } from './woo-order-inbound.service.js';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { WooOrderOutboundService } from './woo-order-outbound.service.js';
import { ShipmentSyncService } from './shipment-sync.service.js';
import { SiigoQuotationService } from './siigo-quotation.service.js';
import { OrderEventPublisher } from './order-event-publisher.service.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';

@Module({
  imports: [IntegrationsModule, NotificationsModule, RealtimeModule],
  controllers: [OrdersController, WooOrderInboundController],
  providers: [
    OrdersRepository,
    OrdersService,
    N8nApiKeyGuard,
    WooOrderInboundRepository,
    WooOrderInboundService,
    WooOrderOutboundService,
    ShipmentSyncService,
    SiigoQuotationService,
    OrderEventPublisher,
  ],
})
export class OrdersModule {}
