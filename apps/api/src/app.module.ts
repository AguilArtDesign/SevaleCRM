import { Module } from '@nestjs/common';
import { HealthController } from './health.controller.js';
import { HealthService } from './health.service.js';
import { DatabaseModule } from './database/database.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { IntegrationsModule } from './integrations/integrations.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';

@Module({
  imports: [
    DatabaseModule,
    AuthModule,
    RealtimeModule,
    NotificationsModule,
    UsersModule,
    InventoryModule,
    IntegrationsModule,
  ],
  controllers: [HealthController],
  providers: [HealthService],
})
export class AppModule {}
