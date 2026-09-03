import '../apps/api/src/config/load-environment.js';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword } from 'better-auth/crypto';
import { AppModule } from '../apps/api/src/app.module.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { Role, Store, SyncStatus } from '../apps/api/src/generated/prisma/client.js';

process.env.BETTER_AUTH_SECRET ||= 'local-notifications-smoke-secret-at-least-32-characters';

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
  logger: false,
});
app.setGlobalPrefix('api');
await app.listen(0, '127.0.0.1');

const prisma = app.get(PrismaService);
const baseUrl = await app.getUrl();
const origin = process.env.FRONTEND_URL || 'http://localhost:5173';
const runId = randomUUID();
const password = `S-${randomUUID()}-9a!`;
const users = [
  {
    id: randomUUID(),
    email: `notifications-a-${runId}@example.invalid`,
    name: 'Notifications User A',
  },
  {
    id: randomUUID(),
    email: `notifications-b-${runId}@example.invalid`,
    name: 'Notifications User B',
  },
] as const;
let productId: number | null = null;
const notificationIds: number[] = [];

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

async function api(path: string, cookie?: string, method = 'GET') {
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
        role: Role.COMMERCIAL,
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
  const product = await prisma.product.create({
    data: {
      siigoId: `notification-${runId}`,
      sku: `NOTIFICATION-${runId}`,
      siigoPriceCop: 1,
      siigoPriceUsd: 1,
      siigoStock: 1,
      store: Store.PALI,
      wooParentId: 1n,
      wooVariationId: 2n,
      wooSku: `NOTIFICATION-${runId}`,
      wooPriceCop: 1,
      wooPriceUsd: 1,
      wooStock: 1,
      syncStatus: SyncStatus.SYNCED,
      productName: 'Producto de notificaciones',
    },
  });
  productId = product.id;
  for (const [index, title] of ['Stock actualizado', 'Precio actualizado'].entries()) {
    const notification = await prisma.notification.create({
      data: {
        type: index === 0 ? 'SIIGO_STOCK_UPDATED' : 'SIIGO_PRICE_UPDATED',
        title,
        message: `Producto de notificaciones · NOTIFICATION-${runId}`,
        productId,
      },
    });
    notificationIds.push(notification.id);
  }

  expectStatus(await api('/api/notifications'), 401, 'Listado anónimo');
  const cookieA = await login(users[0].email);
  const cookieB = await login(users[1].email);

  const unreadAResponse = await api('/api/notifications?status=unread', cookieA);
  expectStatus(unreadAResponse, 200, 'No leídas del usuario A');
  const unreadA = (await unreadAResponse.json()) as {
    data: Array<{ id: number; readAt: string | null; product: { sku: string } }>;
    unreadCount: number;
  };
  if (
    unreadA.unreadCount < 2 ||
    !notificationIds.every((id) => unreadA.data.some((notification) => notification.id === id)) ||
    unreadA.data.find((notification) => notification.id === notificationIds[0])?.product.sku !==
      product.sku
  ) {
    throw new Error('El listado no devolvió las notificaciones normalizadas esperadas.');
  }

  expectStatus(
    await api(`/api/notifications/${notificationIds[0]}/read`, cookieA, 'PATCH'),
    200,
    'Marcar una como leída',
  );
  const readAResponse = await api('/api/notifications?status=read', cookieA);
  expectStatus(readAResponse, 200, 'Leídas del usuario A');
  const readA = (await readAResponse.json()) as {
    data: Array<{ id: number; readAt: string | null }>;
  };
  if (
    !readA.data.some(
      (notification) => notification.id === notificationIds[0] && notification.readAt,
    )
  ) {
    throw new Error('El estado leído no se guardó para el usuario A.');
  }

  const unreadBResponse = await api('/api/notifications?status=unread', cookieB);
  expectStatus(unreadBResponse, 200, 'No leídas del usuario B');
  const unreadB = (await unreadBResponse.json()) as { data: Array<{ id: number }> };
  if (!notificationIds.every((id) => unreadB.data.some((notification) => notification.id === id))) {
    throw new Error('Leer una notificación afectó incorrectamente al usuario B.');
  }

  const markAllResponse = await api('/api/notifications/read-all', cookieA, 'PATCH');
  expectStatus(markAllResponse, 200, 'Marcar todas como leídas');
  const afterAllResponse = await api('/api/notifications?status=unread', cookieA);
  const afterAll = (await afterAllResponse.json()) as { unreadCount: number; data: unknown[] };
  if (afterAll.unreadCount !== 0 || afterAll.data.length !== 0) {
    throw new Error('El usuario A todavía conserva notificaciones sin leer.');
  }

  expectStatus(
    await api('/api/notifications/not-a-number/read', cookieA, 'PATCH'),
    400,
    'Identificador inválido',
  );
  expectStatus(
    await api('/api/notifications/2147483647/read', cookieA, 'PATCH'),
    404,
    'Notificación inexistente',
  );

  process.stdout.write(
    'Notifications smoke: auth, list filters, unread count, per-user reads and mark-all checks passed.\n',
  );
} finally {
  if (notificationIds.length > 0) {
    await prisma.notification.deleteMany({ where: { id: { in: notificationIds } } });
  }
  if (productId !== null) await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  await app.close();
}
