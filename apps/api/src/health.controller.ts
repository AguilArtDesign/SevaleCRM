import { Controller, Get } from '@nestjs/common';
import { HealthService, type HealthStatus } from './health.service.js';
import { Public } from './auth/public.decorator.js';

@Public()
@Controller('health')
export class HealthController {
  constructor(private readonly healthService: HealthService) {}

  @Get()
  getHealth(): HealthStatus {
    return this.healthService.getStatus();
  }
}
