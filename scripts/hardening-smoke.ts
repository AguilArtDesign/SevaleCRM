import '../apps/api/src/config/load-environment.js';
import assert from 'node:assert/strict';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../apps/api/src/app.module.js';
import { configureApplication } from '../apps/api/src/config/configure-application.js';
import { configureProductionFrontend } from '../apps/api/src/config/production-frontend.js';

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
  logger: false,
});
await configureApplication(app);
await configureProductionFrontend(app);
await app.init();

try {
  const allowedOrigin = process.env.FRONTEND_URL || 'http://localhost:5173';
  const health = await app.inject({
    method: 'GET',
    url: '/api/health',
    headers: { origin: allowedOrigin },
  });
  assert.equal(health.statusCode, 200);
  assert.equal(health.headers['access-control-allow-origin'], allowedOrigin);
  assert.equal(health.headers['access-control-allow-credentials'], 'true');
  assert.equal(health.headers['x-content-type-options'], 'nosniff');
  assert.equal(health.headers['x-frame-options'], 'SAMEORIGIN');
  assert.match(
    health.headers['content-security-policy'] || '',
    /script-src 'self' https:\/\/challenges\.cloudflare\.com/,
  );

  const rejectedOrigin = await app.inject({
    method: 'GET',
    url: '/api/health',
    headers: { origin: 'https://attacker.invalid' },
  });
  assert.equal(rejectedOrigin.statusCode, 200);
  assert.equal(rejectedOrigin.headers['access-control-allow-origin'], undefined);

  const unauthorized = await app.inject({ method: 'GET', url: '/api/users' });
  assert.equal(unauthorized.statusCode, 401);
  assert.deepEqual(unauthorized.json(), {
    success: false,
    error: { code: 'UNAUTHORIZED', message: 'Debes iniciar sesión.' },
  });

  const missing = await app.inject({ method: 'GET', url: '/api/route-that-does-not-exist' });
  assert.equal(missing.statusCode, 404);
  assert.deepEqual(missing.json(), {
    success: false,
    error: { code: 'NOT_FOUND', message: 'El recurso solicitado no existe.' },
  });

  const login = await app.inject({ method: 'GET', url: '/login' });
  assert.equal(login.statusCode, 200);
  assert.match(login.headers['content-type'] || '', /^text\/html/);
  assert.match(login.body, /<div id="root"><\/div>/);
  assert.equal(login.headers['cache-control'], 'no-cache');
} finally {
  await app.close();
}

console.info('Hardening smoke OK: headers, CORS y errores verificados.');
