import { Module } from '@nestjs/common';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { AgreementCommentsController } from './agreement-comments.controller.js';
import { AgreementLogoService } from './agreement-logo.service.js';
import { AgreementTasksController } from './agreement-tasks.controller.js';
import { AgreementsController } from './agreements.controller.js';
import { AgreementsRepository } from './agreements.repository.js';
import { AgreementsService } from './agreements.service.js';

@Module({
  imports: [RealtimeModule],
  controllers: [AgreementsController, AgreementCommentsController, AgreementTasksController],
  providers: [AgreementsRepository, AgreementsService, AgreementLogoService],
  exports: [AgreementsService, AgreementsRepository],
})
export class AgreementsModule {}
