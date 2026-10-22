import { Module } from '@nestjs/common';
import { CustomersModule } from '../customers/customers.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { ProspectsController } from './prospects.controller.js';
import { ProspectImportService } from './prospect-import.service.js';
import { ProspectsRepository } from './prospects.repository.js';
import { ProspectsService } from './prospects.service.js';
import { TagsController } from './tags.controller.js';

@Module({
  // La conversión reutiliza `CustomersService`: no hay una segunda implementación del alta de
  // clientes dentro de Prospectos.
  imports: [RealtimeModule, CustomersModule],
  controllers: [ProspectsController, TagsController],
  providers: [ProspectsRepository, ProspectsService, ProspectImportService],
  exports: [ProspectsService, ProspectsRepository],
})
export class ProspectsModule {}
