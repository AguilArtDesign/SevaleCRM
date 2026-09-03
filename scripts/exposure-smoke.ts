import '../apps/api/src/config/load-environment.js';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../apps/api/src/app.module.js';
import { configureApplication } from '../apps/api/src/config/configure-application.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';

process.env.BETTER_AUTH_SECRET ||= 'local-exposure-smoke-secret-at-least-32-characters';
const originalN8nKey = process.env.N8N_API_KEY;
process.env.N8N_API_KEY = 'local-exposure-smoke-n8n-key-at-least-32-characters';

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
  logger: false,
});
await configureApplication(app);
await app.init();

const prisma = app.get(PrismaService);
const signupEmail = `disabled-signup-${randomUUID()}@example.invalid`;

const protectedRoutes = [
  { method: 'GET', url: '/api/me' },
  { method: 'GET', url: '/api/users' },
  { method: 'POST', url: '/api/users', payload: {} },
  { method: 'PATCH', url: `/api/users/${randomUUID()}`, payload: {} },
  { method: 'GET', url: '/api/products' },
  { method: 'GET', url: '/api/products/link-preview?sku=TEST' },
  { method: 'POST', url: '/api/products', payload: {} },
  { method: 'GET', url: '/api/products/1' },
  { method: 'GET', url: '/api/notifications' },
  { method: 'PATCH', url: '/api/notifications/read-all', payload: {} },
  { method: 'PATCH', url: '/api/notifications/1/read', payload: {} },
  { method: 'GET', url: '/api/integrations/siigo/products?sku=TEST' },
  { method: 'GET', url: '/api/integrations/woocommerce/seratus/products?sku=TEST' },
] as const;

try {
  const health = await app.inject({ method: 'GET', url: '/api/health' });
  assert.equal(health.statusCode, 200);
  assert.deepEqual(health.json(), { status: 'ok', service: 'sevale-crm-api' });

  for (const route of protectedRoutes) {
    const response = await app.inject(route);
    assert.equal(response.statusCode, 401, `${route.method} ${route.url} quedó expuesta.`);
  }

  const webhook = await app.inject({
    method: 'POST',
    url: '/api/integrations/siigo/product',
    payload: {
      siigo_id: randomUUID(),
      sku: 'TEST',
      siigo_price_cop: 1,
      siigo_price_usd: 1,
      siigo_stock: 1,
    },
  });
  assert.equal(webhook.statusCode, 401, 'El webhook n8n aceptó una solicitud sin API key.');

  const signup = await app.inject({
    method: 'POST',
    url: '/api/auth/sign-up/email',
    headers: {
      origin: process.env.FRONTEND_URL || 'http://localhost:5173',
      'x-captcha-response': 'XXXX.DUMMY.TOKEN.XXXX',
    },
    payload: {
      name: 'Public Signup Attempt',
      email: signupEmail,
      password: 'Public-signup-attempt-9!',
    },
  });
  assert.ok(signup.statusCode >= 400, 'Better Auth permitió el registro público.');
  assert.equal(await prisma.user.count({ where: { email: signupEmail } }), 0);
} finally {
  await prisma.user.deleteMany({ where: { email: signupEmail } });
  if (originalN8nKey === undefined) delete process.env.N8N_API_KEY;
  else process.env.N8N_API_KEY = originalN8nKey;
  await app.close();
}

console.info('Exposure smoke OK: rutas privadas, n8n y registro público verificados.');
