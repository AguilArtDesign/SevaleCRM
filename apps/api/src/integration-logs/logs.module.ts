import { Module } from '@nestjs/common';
import { IntegrationLogsRepository } from './integration-logs.repository.js';
import { IntegrationLogsService } from './integration-logs.service.js';
import { LogsController } from './logs.controller.js';

@Module({
  controllers: [LogsController],
  providers: [IntegrationLogsRepository, IntegrationLogsService],
  exports: [IntegrationLogsService],
})
export class LogsModule {}
