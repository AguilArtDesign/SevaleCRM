import '../apps/api/src/config/load-environment.js';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword } from 'better-auth/crypto';
import { AppModule } from '../apps/api/src/app.module.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { Role } from '../apps/api/src/generated/prisma/client.js';
import { IntegrationLogsService } from '../apps/api/src/integration-logs/integration-logs.service.js';

process.env.BETTER_AUTH_SECRET ||= 'local-logs-smoke-secret-at-least-32-characters';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
  logger: false,
  abortOnError: false,
});
app.setGlobalPrefix('api');
await app.listen(0, '127.0.0.1');

const prisma = app.get(PrismaService);
const logs = app.get(IntegrationLogsService);
const baseUrl = await app.getUrl();
const origin = process.env.FRONTEND_URL || 'http://localhost:5173';
const runId = randomUUID();
const password = `L-${randomUUID()}-9a!`;
const users = [
  {
    id: randomUUID(),
    email: `logs-admin-${runId}@example.invalid`,
    name: 'Logs Admin',
    role: Role.ADMIN,
  },
  {
    id: randomUUID(),
    email: `logs-commercial-${runId}@example.invalid`,
    name: 'Logs Commercial',
    role: Role.COMMERCIAL,
  },
] as const;
const integration = `SMOKE_${runId.replaceAll('-', '').slice(0, 12).toUpperCase()}`;
const logIds: number[] = [];

function expectStatus(response: Response, status: number, context: string) {
  if (response.status !== status) {
    throw new Error(`${context}: se esperaba ${status} y se recibió ${response.status}.`);
  }
}

async function login(email: string) {
  const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      'x-captcha-response': 'XXXX.DUMMY.TOKEN.XXXX',
    },
    body: JSON.stringify({ email, password }),
  });
  expectStatus(response, 200, `Inicio de sesión de ${email}`);
  const cookie = response.headers.getSetCookie()[0]?.split(';')[0];
  if (!cookie) throw new Error('Better Auth no creó la cookie de sesión.');
  return cookie;
}

function api(path: string, cookie?: string, method = 'GET') {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: { origin, ...(cookie ? { cookie } : {}) },
  });
}

try {
  const passwordHash = await hashPassword(password);
  for (const user of users) {
    await prisma.user.create({
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: true,
        role: user.role,
        active: true,
        accounts: {
          create: {
            id: randomUUID(),
            accountId: user.id,
            providerId: 'credential',
            issuer: 'local:credential',
            password: passwordHash,
          },
        },
      },
    });
  }

  // Un éxito y un error propios del smoke: el registro ya tiene entradas reales del resto del
  // sistema y se filtran por integración para no depender de ellas.
  await logs.record({
    integration,
    operation: 'POST /v1/quotations',
    outcome: 'SUCCESS',
    method: 'POST',
    url: 'https://api.siigo.com/v1/quotations',
    statusCode: 201,
    requestBody: { seller: 820, token: 'no-debe-guardarse' },
    responseBody: { id: 'quote-1', number: 81 },
    durationMs: 420,
    referenceType: 'ORDER_OPERATION',
    referenceId: 548,
  });
  await logs.record({
    integration,
    operation: 'POST /v1/quotations',
    outcome: 'ERROR',
    method: 'POST',
    url: 'https://api.siigo.com/v1/quotations',
    statusCode: 400,
    code: 'INTEGRATION_REQUEST_FAILED',
    message: 'Siigo rechazó la solicitud: The discount amount is invalid',
    requestBody: { items: [{ discount: 20.123456 }] },
    responseBody: { Errors: [{ Message: 'The discount amount is invalid' }] },
    durationMs: 260,
    userId: users[0].id,
  });

  const stored = await prisma.integrationLog.findMany({
    where: { integration },
    orderBy: { id: 'asc' },
  });
  logIds.push(...stored.map(({ id }) => id));
  assert(stored.length === 2, 'Los registros explícitos no se guardaron.');
  const [success, failure] = stored;
  assert(success?.outcome === 'SUCCESS' && success.statusCode === 201, 'No se guardó el éxito.');
  assert(failure?.code === 'INTEGRATION_REQUEST_FAILED', 'No se guardó el código del error.');
  assert(
    success?.requestBody?.includes('[omitido]') === true,
    'El cuerpo guardado no oculta los campos que parecen credenciales.',
  );
  assert(
    failure?.message?.includes('discount amount is invalid') === true,
    'No se guardó el mensaje del proveedor.',
  );

  expectStatus(await api(`/api/logs?integration=${integration}`), 401, 'Listado anónimo');
  const adminCookie = await login(users[0].email);
  const commercialCookie = await login(users[1].email);
  expectStatus(
    await api(`/api/logs?integration=${integration}`, commercialCookie),
    403,
    'Listado del comercial',
  );

  const listResponse = await api(`/api/logs?integration=${integration}&pageSize=10`, adminCookie);
  expectStatus(listResponse, 200, 'Listado del administrador');
  const list = (await listResponse.json()) as {
    data: Array<{ id: number; outcome: string; code: string | null }>;
    pagination: { total: number };
  };
  assert(list.pagination.total === 2, 'El listado no devolvió los dos registros del smoke.');
  // El más reciente va primero: el error es el último que se guardó.
  assert(
    list.data[0]?.outcome === 'ERROR',
    'El listado no ordena del más reciente al más antiguo.',
  );

  const errorOnly = await api(`/api/logs?integration=${integration}&outcome=ERROR`, adminCookie);
  const errors = (await errorOnly.json()) as {
    data: Array<{ id: number }>;
    pagination: { total: number };
  };
  assert(errors.pagination.total === 1, 'El filtro por resultado no acotó el listado.');

  const codeFilter = await api(
    `/api/logs?integration=${integration}&code=INTEGRATION_REQUEST_FAILED`,
    adminCookie,
  );
  const byCode = (await codeFilter.json()) as { pagination: { total: number } };
  assert(byCode.pagination.total === 1, 'El filtro por código no acotó el listado.');

  const searchResponse = await api(
    `/api/logs?integration=${integration}&search=discount`,
    adminCookie,
  );
  const searched = (await searchResponse.json()) as { pagination: { total: number } };
  assert(searched.pagination.total === 1, 'La búsqueda no encontró el mensaje del error.');

  const facetsResponse = await api('/api/logs/facets', adminCookie);
  expectStatus(facetsResponse, 200, 'Facetas');
  const facets = (await facetsResponse.json()) as { integrations: string[]; codes: string[] };
  assert(facets.integrations.includes(integration), 'Las facetas no listan la integración.');
  assert(
    facets.codes.includes('INTEGRATION_REQUEST_FAILED'),
    'Las facetas no listan el código registrado.',
  );

  const detailResponse = await api(`/api/logs/${logIds[1]}`, adminCookie);
  expectStatus(detailResponse, 200, 'Detalle');
  const detail = (await detailResponse.json()) as {
    requestBody: string | null;
    responseBody: string | null;
    user: { name: string } | null;
  };
  assert(
    detail.requestBody?.includes('discount') === true &&
      detail.responseBody?.includes('Errors') === true,
    'El detalle no devuelve los cuerpos enviado y recibido.',
  );
  assert(
    detail.user?.name === 'Logs Admin',
    'El detalle no devuelve el usuario que originó el log.',
  );
  expectStatus(await api('/api/logs/999999999', adminCookie), 404, 'Detalle inexistente');

  // El vaciado es un permiso aparte y borra todo, no solo lo del smoke.
  expectStatus(await api('/api/logs', commercialCookie, 'DELETE'), 403, 'Vaciado del comercial');

  // La purga por antigüedad protege la tabla de crecer sin límite.
  const expiredId = logIds[0]!;
  await prisma.integrationLog.update({
    where: { id: expiredId },
    data: { createdAt: new Date(Date.now() - 31 * 24 * 60 * 60 * 1000) },
  });
  const removed = await logs.removeExpired();
  assert(removed >= 1, 'La purga no eliminó el registro vencido.');
  assert(
    (await prisma.integrationLog.findUnique({ where: { id: expiredId } })) === null,
    'El registro vencido sobrevivió a la purga.',
  );

  process.stdout.write(
    'Logs smoke: explicit entries, credential redaction, RBAC (admin only), list, outcome/code/search filters, facets, detail, purge and clear checks passed.\n',
  );
} finally {
  if (logIds.length > 0) {
    await prisma.integrationLog.deleteMany({ where: { id: { in: logIds } } });
  }
  await prisma.integrationLog.deleteMany({ where: { integration } });
  await prisma.user.deleteMany({ where: { id: { in: users.map(({ id }) => id) } } });
  await app.close();
}
