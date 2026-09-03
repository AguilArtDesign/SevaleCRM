import '../apps/api/src/config/load-environment.js';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword } from 'better-auth/crypto';
import { io, type Socket } from 'socket.io-client';
import { AppModule } from '../apps/api/src/app.module.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { Role } from '../apps/api/src/generated/prisma/client.js';
import { RealtimeGateway } from '../apps/api/src/realtime/realtime.gateway.js';

process.env.BETTER_AUTH_SECRET ||= 'local-realtime-smoke-secret-at-least-32-characters';

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
  logger: false,
});
app.setGlobalPrefix('api');
await app.listen(0, '127.0.0.1');

const prisma = app.get(PrismaService);
const realtime = app.get(RealtimeGateway);
const baseUrl = await app.getUrl();
const origin = process.env.FRONTEND_URL || 'http://localhost:5173';
const password = `S-${randomUUID()}-9a!`;
const users = [
  {
    id: randomUUID(),
    email: `realtime-active-${randomUUID()}@example.invalid`,
    name: 'Realtime Active',
  },
  {
    id: randomUUID(),
    email: `realtime-inactive-${randomUUID()}@example.invalid`,
    name: 'Realtime Inactive',
  },
] as const;
const sockets: Socket[] = [];

function socketClient(cookie?: string) {
  const socket = io(baseUrl, {
    autoConnect: false,
    reconnection: false,
    timeout: 2_000,
    transports: ['websocket'],
    extraHeaders: {
      origin,
      ...(cookie ? { cookie } : {}),
    },
  });
  sockets.push(socket);
  return socket;
}

function waitFor<T>(socket: Socket, event: string): Promise<T> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error(`No se recibió ${event}.`)), 3_000);
    socket.once(event, (payload: T) => {
      clearTimeout(timeout);
      resolve(payload);
    });
  });
}

function expectRejected(socket: Socket, context: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(
      () => reject(new Error(`${context}: la conexión no respondió.`)),
      3_000,
    );
    socket.once('connect', () => {
      clearTimeout(timeout);
      reject(new Error(`${context}: la conexión fue aceptada.`));
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      if (error.message !== 'UNAUTHORIZED') {
        reject(new Error(`${context}: se expuso un error inesperado.`));
        return;
      }
      resolve();
    });
    socket.connect();
  });
}

function expectConnected(socket: Socket): Promise<void> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('La conexión autenticada expiró.')), 3_000);
    socket.once('connect', () => {
      clearTimeout(timeout);
      resolve();
    });
    socket.once('connect_error', (error) => {
      clearTimeout(timeout);
      reject(error);
    });
    socket.connect();
  });
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
  if (response.status !== 200) throw new Error(`No se pudo iniciar sesión: ${response.status}.`);
  const cookie = response.headers.getSetCookie()[0]?.split(';')[0];
  if (!cookie) throw new Error('Better Auth no creó la cookie de sesión.');
  return cookie;
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
        role: Role.ADMIN,
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

  const activeCookie = await login(users[0].email);
  const inactiveCookie = await login(users[1].email);
  await prisma.user.update({ where: { id: users[1].id }, data: { active: false } });

  await expectRejected(socketClient(), 'Socket anónimo');
  await expectRejected(socketClient(inactiveCookie), 'Socket de cuenta inactiva');

  const socket = socketClient(activeCookie);
  await expectConnected(socket);

  const createdPromise = waitFor<{ productId: number; sku: string }>(socket, 'product.created');
  realtime.emitProductCreated({ id: 501, sku: 'SOCKET-501' });
  const created = await createdPromise;
  if (created.productId !== 501 || created.sku !== 'SOCKET-501') {
    throw new Error('product.created no devolvió el payload normalizado esperado.');
  }

  const updatedPromise = waitFor<{ changedFields: string[] }>(socket, 'product.updated');
  const stockPromise = waitFor<{ change: { previous: number; current: number } }>(
    socket,
    'product.stock.updated',
  );
  const pricePromise = waitFor<{ priceCop: { previous: number; current: number } }>(
    socket,
    'product.price.updated',
  );
  const statusPromise = waitFor<{ change: { previous: string; current: string } }>(
    socket,
    'product.sync.status_changed',
  );
  realtime.emitProductUpdated(
    { id: 501, sku: 'SOCKET-501' },
    {
      priceCop: { previous: 90_000, current: 95_000 },
      priceUsd: null,
      stock: { previous: 10, current: 7 },
      syncStatus: { previous: 'SYNCED', current: 'OUT_OF_SYNC' },
    },
  );
  const [updated, stock, price, status] = await Promise.all([
    updatedPromise,
    stockPromise,
    pricePromise,
    statusPromise,
  ]);
  if (
    updated.changedFields.join(',') !== 'priceCop,stock,syncStatus' ||
    stock.change.previous !== 10 ||
    stock.change.current !== 7 ||
    price.priceCop.current !== 95_000 ||
    status.change.current !== 'OUT_OF_SYNC'
  ) {
    throw new Error('Los eventos de actualización no devolvieron los cambios esperados.');
  }

  const notificationPromise = waitFor<{ notificationId: number; productId: number | null }>(
    socket,
    'notification.created',
  );
  realtime.emitNotificationCreated({
    id: 801,
    type: 'TEST_NOTIFICATION',
    title: 'Notificación de prueba',
    message: 'Contenido normalizado',
    productId: 501,
    createdAt: new Date(),
  });
  const notification = await notificationPromise;
  if (notification.notificationId !== 801 || notification.productId !== 501) {
    throw new Error('notification.created no devolvió el payload esperado.');
  }

  process.stdout.write(
    'Realtime smoke: session authentication, inactive-user rejection and all initial Socket.IO events passed.\n',
  );
} finally {
  for (const socket of sockets) socket.disconnect();
  await prisma.user.deleteMany({ where: { id: { in: users.map((user) => user.id) } } });
  await app.close();
}
