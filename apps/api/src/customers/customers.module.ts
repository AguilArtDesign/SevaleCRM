import { Module } from '@nestjs/common';
import { IntegrationsModule } from '../integrations/integrations.module.js';
import { NotificationsModule } from '../notifications/notifications.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { CustomersController } from './customers.controller.js';
import { CustomerIntegrationService } from './customer-integration.service.js';
import { CustomerIntegrationsRepository } from './customer-integrations.repository.js';
import { SiigoCustomerService } from './integrations/siigo-customer.service.js';
import { WooCustomerService } from './integrations/woo-customer.service.js';
import { CustomersRepository } from './customers.repository.js';
import { CustomersService } from './customers.service.js';
import { CustomerLocationsService } from './mapping/customer-locations.service.js';
import { SiigoCustomerMapper } from './mapping/siigo-customer.mapper.js';
import { WooCustomerMapper } from './mapping/woo-customer.mapper.js';

@Module({
  imports: [IntegrationsModule, NotificationsModule, RealtimeModule],
  controllers: [CustomersController],
  providers: [
    CustomersRepository,
    CustomersService,
    CustomerIntegrationsRepository,
    CustomerIntegrationService,
    CustomerLocationsService,
    SiigoCustomerMapper,
    WooCustomerMapper,
    SiigoCustomerService,
    WooCustomerService,
  ],
  exports: [SiigoCustomerService, WooCustomerService],
})
export class CustomersModule {}
