import { Module } from '@nestjs/common';
import { IntegrationsController } from './integrations.controller.js';
import { SiigoTokenRepository } from './siigo/siigo-token.repository.js';
import { SiigoTokenService } from './siigo/siigo-token.service.js';
import { SiigoService } from './siigo/siigo.service.js';
import { WooCommerceService } from './woocommerce/woocommerce.service.js';
import { N8nApiKeyGuard } from './n8n/n8n-api-key.guard.js';
import { SiigoWebhookController } from './n8n/siigo-webhook.controller.js';
import { SiigoWebhookRepository } from './n8n/siigo-webhook.repository.js';
import { SiigoWebhookService } from './n8n/siigo-webhook.service.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';

@Module({
  imports: [RealtimeModule, NotificationsModule],
  controllers: [IntegrationsController, SiigoWebhookController],
  providers: [
    SiigoTokenRepository,
    SiigoTokenService,
    SiigoService,
    WooCommerceService,
    N8nApiKeyGuard,
    SiigoWebhookRepository,
    SiigoWebhookService,
  ],
  exports: [SiigoTokenService, SiigoService, WooCommerceService],
})
export class IntegrationsModule {}
