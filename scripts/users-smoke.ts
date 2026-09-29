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
// El seller id de Siigo es único por usuario, así que cada ejecución usa valores
// propios derivados del runId para no chocar con datos residuales de otras corridas.
const sellerIdSeed = Number.parseInt(runId.replace(/\D/g, '').slice(0, 5), 10);
const adminSellerId = 10_000_000 + sellerIdSeed * 4 + 1;
const commercialSellerId = adminSellerId + 1;
const createdSellerId = adminSellerId + 2;
const updatedSellerId = adminSellerId + 3;
const duplicateEmailSellerId = adminSellerId + 4;

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
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
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
      sellerId: adminSellerId,
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
      sellerId: commercialSellerId,
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

  const sellerIdList = await api(
    `/api/users?search=${encodeURIComponent(`users-admin-${runId}@example.invalid`)}&page=1&pageSize=20`,
    adminCookie,
  );
  expectStatus(sellerIdList, 200, 'Listado para verificar el seller id');
  const sellerIdListBody = (await sellerIdList.json()) as {
    data: { email: string; sellerId: number | null }[];
  };
  const listedAdmin = sellerIdListBody.data.find(
    (user) => user.email === `users-admin-${runId}@example.invalid`,
  );
  if (listedAdmin?.sellerId !== adminSellerId) {
    throw new Error('El listado no expuso el seller id del usuario.');
  }

  const singlePage = await api('/api/users?page=1&pageSize=1', adminCookie);
  expectStatus(singlePage, 200, 'Tamaño de página del listado');
  const singlePageBody = (await singlePage.json()) as {
    data: unknown[];
    pagination: { pageSize: number };
  };
  if (singlePageBody.data.length !== 1 || singlePageBody.pagination.pageSize !== 1) {
    throw new Error('El listado no respetó el tamaño de página solicitado.');
  }

  const roleFiltered = await api('/api/users?role=ADMIN&page=1&pageSize=100', adminCookie);
  expectStatus(roleFiltered, 200, 'Filtro por rol');
  const roleFilteredBody = (await roleFiltered.json()) as { data: { role: string }[] };
  if (
    roleFilteredBody.data.length === 0 ||
    roleFilteredBody.data.some((user) => user.role !== 'ADMIN')
  ) {
    throw new Error('El filtro por rol devolvió usuarios con un rol distinto.');
  }

  const invalidRoleFilter = await api('/api/users?role=SUPERADMIN', adminCookie);
  expectStatus(invalidRoleFilter, 400, 'Rol inválido en el filtro');

  const missingSellerId = await api('/api/users', adminCookie, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Usuario Sin Seller Id',
      email: `users-missing-seller-${runId}@example.invalid`,
      role: 'LOGISTICS',
      active: true,
    }),
  });
  expectStatus(missingSellerId, 400, 'Creación sin seller id');

  const nonNumericSellerId = await api('/api/users', adminCookie, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Usuario Seller Id Inválido',
      email: `users-invalid-seller-${runId}@example.invalid`,
      sellerId: 'abc',
      role: 'LOGISTICS',
      active: true,
    }),
  });
  expectStatus(nonNumericSellerId, 400, 'Seller id no numérico');

  const duplicateSellerId = await api('/api/users', adminCookie, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Usuario Seller Id Duplicado',
      email: `users-duplicate-seller-${runId}@example.invalid`,
      sellerId: commercialSellerId,
      role: 'LOGISTICS',
      active: true,
    }),
  });
  expectStatus(duplicateSellerId, 409, 'Seller id duplicado en la creación');
  const duplicateSellerBody = (await duplicateSellerId.json()) as {
    error?: { code?: string };
  };
  if (duplicateSellerBody.error?.code !== 'SELLER_ID_TAKEN') {
    throw new Error('El conflicto por seller id no expuso el código esperado al cliente.');
  }

  const createResponse = await api('/api/users', adminCookie, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Usuario Creado Smoke',
      email: createdEmail,
      sellerId: createdSellerId,
      role: 'LOGISTICS',
      active: true,
    }),
  });
  expectStatus(createResponse, 201, 'Creación de usuario');
  const created = (await createResponse.json()) as { id: string; sellerId: number | null };
  if (created.sellerId !== createdSellerId) {
    throw new Error('La creación no devolvió el seller id enviado.');
  }
  const provisionedUser = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
  if (!provisionedUser.emailVerified) {
    throw new Error('El usuario provisionado por el administrador quedó sin verificar.');
  }
  if (provisionedUser.sellerId !== createdSellerId) {
    throw new Error('El seller id no se persistió en la base de datos.');
  }

  const duplicateResponse = await api('/api/users', adminCookie, {
    method: 'POST',
    body: JSON.stringify({
      name: 'Usuario Duplicado',
      email: createdEmail,
      sellerId: duplicateEmailSellerId,
      role: 'COMMERCIAL',
      active: true,
    }),
  });
  expectStatus(duplicateResponse, 409, 'Correo duplicado');
  const duplicateEmailBody = (await duplicateResponse.json()) as { error?: { code?: string } };
  if (duplicateEmailBody.error?.code !== 'EMAIL_TAKEN') {
    throw new Error('El conflicto por correo no expuso el código esperado al cliente.');
  }

  const updateResponse = await api(`/api/users/${created.id}`, adminCookie, {
    method: 'PATCH',
    body: JSON.stringify({
      name: 'Usuario Editado Smoke',
      sellerId: updatedSellerId,
      role: 'COMMERCIAL',
      active: false,
    }),
  });
  expectStatus(updateResponse, 200, 'Edición de usuario');
  const updated = (await updateResponse.json()) as {
    name: string;
    sellerId: number | null;
    role: string;
    active: boolean;
  };
  if (
    updated.name !== 'Usuario Editado Smoke' ||
    updated.sellerId !== updatedSellerId ||
    updated.role !== 'COMMERCIAL' ||
    updated.active
  ) {
    throw new Error('La edición no devolvió los valores esperados.');
  }

  const duplicateSellerUpdate = await api(`/api/users/${created.id}`, adminCookie, {
    method: 'PATCH',
    body: JSON.stringify({ sellerId: commercialSellerId }),
  });
  expectStatus(duplicateSellerUpdate, 409, 'Seller id duplicado en la edición');
  const duplicateSellerUpdateBody = (await duplicateSellerUpdate.json()) as {
    error?: { code?: string };
  };
  if (duplicateSellerUpdateBody.error?.code !== 'SELLER_ID_TAKEN') {
    throw new Error('La edición no expuso el conflicto por seller id al cliente.');
  }
  const afterConflict = await prisma.user.findUniqueOrThrow({ where: { id: created.id } });
  if (afterConflict.sellerId !== updatedSellerId) {
    throw new Error('La edición rechazada por seller id duplicado modificó el usuario.');
  }

  const emptySellerUpdate = await api(`/api/users/${created.id}`, adminCookie, {
    method: 'PATCH',
    body: JSON.stringify({ sellerId: '' }),
  });
  expectStatus(emptySellerUpdate, 400, 'Seller id vacío en la edición');

  const selfAccessResponse = await api(`/api/users/${adminId}`, adminCookie, {
    method: 'PATCH',
    body: JSON.stringify({ active: false }),
  });
  expectStatus(selfAccessResponse, 400, 'Cambio del propio acceso');

  const selfDeleteResponse = await api(`/api/users/${adminId}`, adminCookie, {
    method: 'DELETE',
  });
  expectStatus(selfDeleteResponse, 400, 'Eliminación de la propia cuenta');

  const forbiddenDelete = await api(`/api/users/${created.id}`, commercialCookie, {
    method: 'DELETE',
  });
  expectStatus(forbiddenDelete, 403, 'Eliminación de usuario como comercial');

  const deleteResponse = await api(`/api/users/${created.id}`, adminCookie, {
    method: 'DELETE',
  });
  expectStatus(deleteResponse, 200, 'Eliminación física de usuario');
  const deletedUser = await prisma.user.findUnique({ where: { id: created.id } });
  if (deletedUser !== null) throw new Error('El usuario continuó en la base de datos.');

  const disableCommercial = await api(`/api/users/${commercialId}`, adminCookie, {
    method: 'PATCH',
    body: JSON.stringify({ active: false }),
  });
  expectStatus(disableCommercial, 200, 'Desactivación de comercial');

  const revokedProfile = await api('/api/me', commercialCookie);
  expectStatus(revokedProfile, 401, 'Sesión revocada tras desactivación');

  process.stdout.write(
    'Users smoke: authentication, ADMIN access, RBAC denial, pagination, role filtering, seller id validation/unicity, create, duplicate, update, self-protection, physical deletion, disable and session revocation checks passed.\n',
  );
} finally {
  await prisma.user.deleteMany({
    where: {
      OR: [{ id: adminId }, { id: commercialId }, { email: createdEmail }],
    },
  });
  await app.close();
}
