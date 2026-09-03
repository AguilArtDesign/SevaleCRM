import helmet from '@fastify/helmet';
import rateLimit from '@fastify/rate-limit';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { ApiExceptionFilter } from './api-exception.filter.js';
import { getFrontendOrigin } from './environment.js';

export async function configureApplication(app: NestFastifyApplication): Promise<void> {
  const frontendOrigin = getFrontendOrigin();
  const isProduction = process.env.NODE_ENV === 'production';
  await app.register(helmet, {
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        baseUri: ["'self'"],
        connectSrc: ["'self'", 'https://challenges.cloudflare.com'],
        fontSrc: ["'self'", 'data:'],
        formAction: ["'self'"],
        frameAncestors: ["'self'"],
        frameSrc: ['https://challenges.cloudflare.com'],
        imgSrc: ["'self'", 'data:', 'https:'],
        objectSrc: ["'none'"],
        scriptSrc: ["'self'", 'https://challenges.cloudflare.com'],
        scriptSrcAttr: ["'none'"],
        styleSrc: ["'self'", "'unsafe-inline'"],
        upgradeInsecureRequests: isProduction ? [] : null,
      },
    },
    strictTransportSecurity: isProduction ? { maxAge: 31_536_000, includeSubDomains: true } : false,
  });
  await app.register(rateLimit, {
    global: true,
    max: 300,
    timeWindow: 60_000,
    errorResponseBuilder: () => ({
      success: false,
      error: {
        code: 'RATE_LIMIT_EXCEEDED',
        message: 'Se alcanzó el límite de solicitudes. Intenta más tarde.',
      },
    }),
  });
  app.setGlobalPrefix('api');
  app.enableCors({
    origin: (origin, callback) => callback(null, !origin || origin === frontendOrigin),
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Captcha-Response'],
    maxAge: 86_400,
  });
  app.useGlobalFilters(new ApiExceptionFilter());
}
