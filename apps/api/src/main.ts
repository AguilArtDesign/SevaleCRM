import './config/load-environment.js';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from './app.module.js';
import { configureApplication } from './config/configure-application.js';
import { validateRuntimeEnvironment } from './config/environment.js';
import { configureProductionFrontend } from './config/production-frontend.js';

async function bootstrap() {
  const environment = validateRuntimeEnvironment();
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 1_048_576, trustProxy: environment.TRUST_PROXY === 'true' }),
  );
  await configureApplication(app);
  if (environment.NODE_ENV === 'production') await configureProductionFrontend(app);
  await app.listen(environment.PORT, '0.0.0.0');
}

void bootstrap();
