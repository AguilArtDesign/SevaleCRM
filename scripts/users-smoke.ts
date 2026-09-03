import '../apps/api/src/config/load-environment.js';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword } from 'better-auth/crypto';
import { AppModule } from '../apps/api/src/app.module.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { Role } from '../apps/api/src/generated/prisma/client.js';

process.env.BETTER_AUTH_SECRET ||= 'local-users-smoke-secret-at-least-32-characters';

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
  logger: false,
});
app.setGlobalPrefix('api');
app.enableCors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
});
await app.listen(0, '127.0.0.1');

const prisma = app.get(PrismaService);
const origin = process.env.FRONTEND_URL || 'http://localhost:5173';
const baseUrl = await app.getUrl();
const runId = randomUUID();
const adminId = randomUUID();
const commercialId = randomUUID();
const createdEmail = `users-created-${runId}@example.invalid`;
const password = `S-${randomUUID()}-9a!`;

function expectStatus(response: Response, status: number, context: string) {
  if (response.status !== status) {
    throw new Error(`${context}: se esperaba ${status} y se recibió ${response.status}.`);
  }
}

function cookieFrom(response: Response): string {
  const cookie = response.headers.getSetCookie()[0]?.split(';')[0];
  if (!cookie) throw new Error('Better Auth no creó la cookie de sesión.');
  return cookie;
}

async function login(email: string): Promise<string> {
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
  return cookieFrom(response);
}

async function api(path: string, cookie?: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'content-type': 'application/json',
      origin,
      ...(cookie ? { cookie } : {}),
      ...init?.headers,
    },
  });
}

try {
  const passwordHash = await hashPassword(password);
  await prisma.user.create({
    data: {
      id: adminId,
      name: 'Users Smoke Admin',
      email: `users-admin-${runId}@example.invalid`,
      emailVerified: true,
      role: Role.ADMIN,
      active: true,
      accounts: {
        create: {
          id: randomUUID(),
          accountId: adminId,
          providerId: 'credential',
          issuer: 'local:credential',
          password: passwordHash,
        },
      },
    },
  });
  await prisma.user.create({
    data: {
      id: commercialId,
      name: 'Users Smoke Commercial',
      email: `users-commercial-${runId}@example.invalid`,
      emailVerified: true,
      role: Role.COMMERCIAL,
      active: true,
      accounts: {
        create: {
          id: randomUUID(),
          accountId: commercialId,
          providerId: 'credential',
          issuer: 'local:credential',
          password: passwordHash,
        },
      },
    },
  });

  const anonymousList = await api('/api/users');
  expectStatus(anonymousList, 401, 'Listado anónimo');

  const adminCookie = await login(`users-admin-${runId}@example.invalid`);
  const commercialCookie = await login(`users-commercial-${runId}@example.invalid`);

  const forbiddenList = await api('/api/users', commercialCookie);
  expectStatus(forbiddenList, 403, 'Listado como comercial');

  const adminList = await api('/api/users?search=users-smoke&page=1&pageSize=20', adminCookie);
  expectStatus(adminList, 200, 'Listado como administrador');

  const createResponse = await api('/api/users', adminCookie, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Usuario Creado Smoke',
      email: createdEmail,
      role: 'LOGISTICS',
      active: true,
    }),
  });
  expectStatus(createResponse, 201, 'Creación de usuario');
  const created = (await createResponse.json()) as { id: string };

  const duplicateResponse = await api('/api/users', adminCookie, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Usuario Duplicado',
      email: createdEmail,
      role: 'COMMERCIAL',
      active: true,
    }),
  });
  expectStatus(duplicateResponse, 409, 'Correo duplicado');

  const updateResponse = await api(`/api/users/${created.id}`, adminCookie, {
    method: 'PATCH',
    body: JSON.stringify({ name: 'Usuario Editado Smoke', role: 'COMMERCIAL', active: false }),
  });
  expectStatus(updateResponse, 200, 'Edición de usuario');
  const updated = (await updateResponse.json()) as {
    name: string;
    role: string;
    active: boolean;
  };
  if (updated.name !== 'Usuario Editado Smoke' || updated.role !== 'COMMERCIAL' || updated.active) {
    throw new Error('La edición no devolvió los valores esperados.');
  }

  const selfAccessResponse = await api(`/api/users/${adminId}`, adminCookie, {
    method: 'PATCH',
    body: JSON.stringify({ active: false }),
  });
  expectStatus(selfAccessResponse, 400, 'Cambio del propio acceso');

  const disableCommercial = await api(`/api/users/${commercialId}`, adminCookie, {
    method: 'PATCH',
    body: JSON.stringify({ active: false }),
  });
  expectStatus(disableCommercial, 200, 'Desactivación de comercial');

  const revokedProfile = await api('/api/me', commercialCookie);
  expectStatus(revokedProfile, 401, 'Sesión revocada tras desactivación');

  process.stdout.write(
    'Users smoke: authentication, ADMIN access, RBAC denial, create, duplicate, update, self-protection, disable and session revocation checks passed.\n',
  );
} finally {
  await prisma.user.deleteMany({
    where: {
      OR: [{ id: adminId }, { id: commercialId }, { email: createdEmail }],
    },
  });
  await app.close();
}
