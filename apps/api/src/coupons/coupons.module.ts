import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { CouponSyncService } from './coupon-sync.service.js';
import { CouponsController } from './coupons.controller.js';
import { CouponsRepository } from './coupons.repository.js';
import { CouponsService } from './coupons.service.js';

@Module({
  imports: [IntegrationsModule],
  controllers: [CouponsController],
  providers: [CouponsRepository, CouponSyncService, CouponsService],
  exports: [CouponsService, CouponsRepository],
})
export class CouponsModule {}
