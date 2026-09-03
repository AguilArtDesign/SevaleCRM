import '../apps/api/src/config/load-environment.js';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../apps/api/src/app.module.js';
import { SiigoTokenService } from '../apps/api/src/integrations/siigo/siigo-token.service.js';

const app = await NestFactory.createApplicationContext(AppModule, { logger: false });
try {
  await app.get(SiigoTokenService).getAccessToken();
  process.stdout.write('Siigo auth check: a valid access token is available and persisted.\n');
} finally {
  await app.close();
}
