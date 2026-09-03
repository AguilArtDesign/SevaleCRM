import { Injectable } from '@nestjs/common';

export interface HealthStatus {
  status: 'ok';
  service: 'sevale-crm-api';
}

@Injectable()
export class HealthService {
  getStatus(): HealthStatus {
    return {
      status: 'ok',
      service: 'sevale-crm-api',
    };
  }
}
