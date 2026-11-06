import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { LogsModule } from '../integration-logs/logs.module.js';
import { PointsInvoicesController } from './points-invoices.controller.js';
import { PointsInvoicesRepository } from './points-invoices.repository.js';
import { PointsInvoicesService } from './points-invoices.service.js';
import { PointsRedemptionsController } from './points-redemptions.controller.js';
import { PointsRedemptionsRepository } from './points-redemptions.repository.js';
import { PointsRedemptionsService } from './points-redemptions.service.js';

@Module({
  imports: [IntegrationsModule, LogsModule],
  controllers: [PointsInvoicesController, PointsRedemptionsController],
  providers: [
    PointsInvoicesRepository,
    PointsInvoicesService,
    PointsRedemptionsRepository,
    PointsRedemptionsService,
  ],
  exports: [PointsInvoicesService, PointsRedemptionsService],
})
export class LoyaltyModule {}
