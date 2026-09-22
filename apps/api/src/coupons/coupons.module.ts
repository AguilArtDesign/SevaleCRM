import { Module } from '@nestjs/common';
import { CouponsController } from './coupons.controller.js';
import { CouponsRepository } from './coupons.repository.js';
import { CouponsService } from './coupons.service.js';

@Module({
  controllers: [CouponsController],
  providers: [CouponsRepository, CouponsService],
  exports: [CouponsService, CouponsRepository],
})
export class CouponsModule {}
