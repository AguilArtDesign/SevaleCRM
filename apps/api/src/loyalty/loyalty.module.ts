import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { LogsModule } from '../integration-logs/logs.module.js';
import { PointsInvoicesController } from './points-invoices.controller.js';
import { PointsInvoicesRepository } from './points-invoices.repository.js';
import { PointsInvoicesService } from './points-invoices.service.js';

@Module({
  imports: [IntegrationsModule, LogsModule],
  controllers: [PointsInvoicesController],
  providers: [PointsInvoicesRepository, PointsInvoicesService],
  exports: [PointsInvoicesService],
})
export class LoyaltyModule {}
