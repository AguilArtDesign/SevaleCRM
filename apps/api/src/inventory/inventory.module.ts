import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { ProductLinkService } from './product-link.service.js';
import { ProductsController } from './products.controller.js';
import { ProductsRepository } from './products.repository.js';
import { ProductsService } from './products.service.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { BulkProductSyncService } from './bulk-product-sync.service.js';
import { ProductImportService } from './product-import.service.js';

@Module({
  imports: [IntegrationsModule, RealtimeModule, NotificationsModule],
  controllers: [ProductsController],
  providers: [
    ProductsRepository,
    ProductsService,
    ProductLinkService,
    BulkProductSyncService,
    ProductImportService,
  ],
})
export class InventoryModule {}
