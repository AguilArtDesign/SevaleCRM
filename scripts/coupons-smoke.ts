import '../apps/api/src/config/load-environment.js';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword } from 'better-auth/crypto';
import {
  couponTypes,
  paymentMethods,
  resolveCouponType,
  resolvePaymentMethod,
  resolveShippingMethod,
  shippingMethods,
} from '@sevale/shared';
import { AppModule } from '../apps/api/src/app.module.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { Role } from '../apps/api/src/generated/prisma/client.js';

process.env.BETTER_AUTH_SECRET ||= 'local-coupons-smoke-secret-at-least-32-characters';

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
const couponCode = `smoke-${runId}`;
const password = `S-${randomUUID()}-9a!`;

if (
  paymentMethods.length !== 5 ||
  resolvePaymentMethod('avalpay')?.payment_method_title !== 'AvalPay' ||
  shippingMethods.length !== 3 ||
  resolveShippingMethod('free_shipping')?.rules.COP?.minimum_order_total !== 100000 ||
  resolveShippingMethod('flat_rate')?.rules.USD?.shipping_total !== 20 ||
  couponTypes.length !== 1 ||
  resolveCouponType('percent')?.title !== 'Porcentaje'
) {
  throw new Error('Los catálogos comerciales no contienen los valores esperados.');
}

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
  const adminEmail = `coupons-admin-${runId}@example.invalid`;
  const commercialEmail = `coupons-commercial-${runId}@example.invalid`;
  await prisma.user.create({
    data: {
      id: adminId,
      name: 'Coupons Smoke Admin',
      email: adminEmail,
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
      name: 'Coupons Smoke Commercial',
      email: commercialEmail,
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

  expectStatus(await api('/api/coupons'), 401, 'Listado anónimo');
  const adminCookie = await login(adminEmail);
  const commercialCookie = await login(commercialEmail);
  expectStatus(
    await api('/api/coupons?search=&page=1&pageSize=20', commercialCookie),
    200,
    'Listado como comercial',
  );

  const forbiddenCreate = await api('/api/coupons', commercialCookie, {
    method: 'POST',
    body: JSON.stringify({
      coupon: couponCode,
      description: 'Sin permisos',
      type: 'percent',
      amount: 20,
      active: true,
    }),
  });
  expectStatus(forbiddenCreate, 403, 'Creación como comercial');

  const invalidZero = await api('/api/coupons', adminCookie, {
    method: 'POST',
    body: JSON.stringify({
      coupon: `${couponCode}-zero`,
      description: null,
      type: 'percent',
      amount: 0,
      active: true,
    }),
  });
  expectStatus(invalidZero, 400, 'Porcentaje cero');

  const invalidMaximum = await api('/api/coupons', adminCookie, {
    method: 'POST',
    body: JSON.stringify({
      coupon: `${couponCode}-maximum`,
      description: null,
      type: 'percent',
      amount: 101,
      active: true,
    }),
  });
  expectStatus(invalidMaximum, 400, 'Porcentaje mayor a cien');

  const invalidType = await api('/api/coupons', adminCookie, {
    method: 'POST',
    body: JSON.stringify({
      coupon: `${couponCode}-type`,
      description: null,
      type: 'fixed',
      amount: 20,
      active: true,
    }),
  });
  expectStatus(invalidType, 400, 'Tipo no permitido');

  const createResponse = await api('/api/coupons', adminCookie, {
    method: 'POST',
    body: JSON.stringify({
      coupon: couponCode.toUpperCase(),
      description: 'Cupón smoke inicial',
      type: 'percent',
      amount: 20,
      active: true,
    }),
  });
  expectStatus(createResponse, 201, 'Creación de cupón');
  const created = (await createResponse.json()) as {
    id: number;
    coupon: string;
    amount: number;
    active: boolean;
  };
  if (created.coupon !== couponCode || created.amount !== 20 || !created.active) {
    throw new Error('El cupón creado no fue normalizado o serializado correctamente.');
  }

  const duplicate = await api('/api/coupons', adminCookie, {
    method: 'POST',
    body: JSON.stringify({
      coupon: couponCode,
      description: 'Duplicado',
      type: 'percent',
      amount: 15,
      active: true,
    }),
  });
  expectStatus(duplicate, 409, 'Código duplicado');

  const searchResponse = await api(
    `/api/coupons?search=${encodeURIComponent(runId)}&active=true&page=1&pageSize=20&sort=coupon&order=asc`,
    commercialCookie,
  );
  expectStatus(searchResponse, 200, 'Búsqueda de cupones activos');
  const searchResult = (await searchResponse.json()) as {
    data: Array<{ id: number }>;
    pagination: { total: number };
  };
  if (searchResult.pagination.total !== 1 || searchResult.data[0]?.id !== created.id) {
    throw new Error('El listado no respetó búsqueda, estado o paginación.');
  }

  const forbiddenUpdate = await api(`/api/coupons/${created.id}`, commercialCookie, {
    method: 'PATCH',
    body: JSON.stringify({ amount: 15 }),
  });
  expectStatus(forbiddenUpdate, 403, 'Edición como comercial');

  const updateResponse = await api(`/api/coupons/${created.id}`, adminCookie, {
    method: 'PATCH',
    body: JSON.stringify({ description: 'Cupón smoke editado', amount: 15 }),
  });
  expectStatus(updateResponse, 200, 'Edición de cupón');
  const updated = (await updateResponse.json()) as { description: string; amount: number };
  if (updated.description !== 'Cupón smoke editado' || updated.amount !== 15) {
    throw new Error('La edición del cupón no persistió los valores esperados.');
  }

  const forbiddenDeactivate = await api(`/api/coupons/${created.id}`, commercialCookie, {
    method: 'DELETE',
  });
  expectStatus(forbiddenDeactivate, 403, 'Desactivación como comercial');

  const deactivateResponse = await api(`/api/coupons/${created.id}`, adminCookie, {
    method: 'DELETE',
  });
  expectStatus(deactivateResponse, 200, 'Desactivación de cupón');
  const deactivated = (await deactivateResponse.json()) as { active: boolean };
  if (deactivated.active) throw new Error('El cupón continuó activo después de desactivarlo.');

  const activeList = await api(
    `/api/coupons?search=${encodeURIComponent(runId)}&active=true&page=1&pageSize=20`,
    commercialCookie,
  );
  expectStatus(activeList, 200, 'Listado posterior a desactivación');
  const activeResult = (await activeList.json()) as { pagination: { total: number } };
  if (activeResult.pagination.total !== 0) {
    throw new Error('El cupón desactivado apareció entre los cupones activos.');
  }

  const reactivateResponse = await api(`/api/coupons/${created.id}`, adminCookie, {
    method: 'PATCH',
    body: JSON.stringify({ active: true }),
  });
  expectStatus(reactivateResponse, 200, 'Reactivación de cupón');

  process.stdout.write(
    'Coupons smoke: auth, RBAC, create, unique code, validation, search, edit, deactivate and reactivate checks passed.\n',
  );
} finally {
  await prisma.coupon.deleteMany({ where: { coupon: { startsWith: 'smoke-' } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, commercialId] } } });
  await app.close();
}
