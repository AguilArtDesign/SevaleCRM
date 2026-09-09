import '../apps/api/src/config/load-environment.js';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword } from 'better-auth/crypto';
import { AppModule } from '../apps/api/src/app.module.js';
import { AuthService } from '../apps/api/src/auth/auth.service.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { Role } from '../apps/api/src/generated/prisma/client.js';

process.env.BETTER_AUTH_SECRET ||= 'local-auth-smoke-secret-at-least-32-characters';

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
const authService = app.get(AuthService);
const testId = randomUUID();
const testEmail = `auth-smoke-${testId}@example.invalid`;
const testPassword = `S-${randomUUID()}-9a!`;
const origin = process.env.FRONTEND_URL || 'http://localhost:5173';
const directHeaders = new Headers({ origin });
const baseUrl = await app.getUrl();

function cookieFrom(response: Response): string {
  const cookie = response.headers.getSetCookie()[0]?.split(';')[0];
  if (!cookie) throw new Error('Better Auth no creó la cookie de sesión.');
  return cookie;
}

function assertSessionCookieAttributes(response: Response): void {
  const cookie = response.headers.getSetCookie().find((value) => value.includes('session_token'));
  if (!cookie || !/;\s*HttpOnly/i.test(cookie) || !/;\s*SameSite=Lax/i.test(cookie)) {
    throw new Error('La cookie de sesión no incluye HttpOnly y SameSite=Lax.');
  }
  if (!/;\s*Max-Age=7200/i.test(cookie)) {
    throw new Error('La cookie de sesión no vence después de 2 horas.');
  }
  if (process.env.NODE_ENV === 'production' && !/;\s*Secure/i.test(cookie)) {
    throw new Error('La cookie de producción no incluye Secure.');
  }
}

try {
  await prisma.user.create({
    data: {
      id: testId,
      name: 'Auth Smoke Test',
      email: testEmail,
      emailVerified: true,
      role: Role.COMMERCIAL,
      active: true,
      accounts: {
        create: {
          id: randomUUID(),
          accountId: testId,
          providerId: 'credential',
          issuer: 'local:credential',
          password: await hashPassword(testPassword),
        },
      },
    },
  });

  const passwordResponse = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      'x-captcha-response': 'XXXX.DUMMY.TOKEN.XXXX',
    },
    body: JSON.stringify({ email: testEmail, password: testPassword }),
  });
  if (!passwordResponse.ok) throw new Error('El login HTTP con contraseña falló.');
  assertSessionCookieAttributes(passwordResponse);
  const passwordCookie = cookieFrom(passwordResponse);

  const profileResponse = await fetch(`${baseUrl}/api/me`, {
    headers: { cookie: passwordCookie, origin },
  });
  if (!profileResponse.ok) throw new Error('La ruta protegida rechazó una sesión válida.');

  const passwordSession = await authService.auth.api.getSession({
    headers: new Headers({ cookie: passwordCookie }),
  });
  if (!passwordSession) throw new Error('No se encontró la sesión creada con contraseña.');
  await prisma.session.update({
    where: { id: passwordSession.session.id },
    data: { updatedAt: new Date(Date.now() - 6 * 60 * 1000) },
  });
  const concurrentProfiles = await Promise.all(
    Array.from({ length: 20 }, () =>
      fetch(`${baseUrl}/api/me`, { headers: { cookie: passwordCookie, origin } }),
    ),
  );
  if (concurrentProfiles.some((response) => !response.ok)) {
    throw new Error('Las consultas concurrentes provocaron una colisión al renovar la sesión.');
  }

  const logoutResponse = await fetch(`${baseUrl}/api/auth/sign-out`, {
    method: 'POST',
    headers: { cookie: passwordCookie, origin },
  });
  if (!logoutResponse.ok) throw new Error('El cierre de sesión HTTP falló.');
  const closedProfileResponse = await fetch(`${baseUrl}/api/me`, {
    headers: { cookie: passwordCookie, origin },
  });
  if (closedProfileResponse.status !== 401) {
    throw new Error('La ruta protegida aceptó una sesión revocada.');
  }

  const otp = await authService.auth.api.createVerificationOTP({
    body: { email: testEmail, type: 'sign-in' },
  });
  const otpResponse = await authService.auth.api.signInEmailOTP({
    body: { email: testEmail, otp },
    headers: directHeaders,
    asResponse: true,
  });
  assertSessionCookieAttributes(otpResponse);
  const otpCookie = cookieFrom(otpResponse);
  const otpSession = await authService.auth.api.getSession({
    headers: new Headers({ cookie: otpCookie }),
  });
  if (otpSession?.user.id !== testId) throw new Error('La sesión con OTP no es válida.');

  await prisma.session.update({
    where: { id: otpSession.session.id },
    data: { createdAt: new Date(Date.now() - 8 * 60 * 60 * 1000 - 1_000) },
  });
  const absoluteTimeoutResponse = await fetch(`${baseUrl}/api/me`, {
    headers: { cookie: otpCookie, origin },
  });
  if (absoluteTimeoutResponse.status !== 401) {
    throw new Error('La ruta protegida aceptó una sesión con más de 8 horas.');
  }

  let reusedOtpRejected = false;
  try {
    await authService.auth.api.signInEmailOTP({
      body: { email: testEmail, otp },
      headers: directHeaders,
    });
  } catch {
    reusedOtpRejected = true;
  }
  if (!reusedOtpRejected) throw new Error('Un código OTP pudo utilizarse más de una vez.');

  await prisma.user.update({ where: { id: testId }, data: { active: false } });
  let inactiveRejected = false;
  try {
    await authService.auth.api.signInEmail({
      body: { email: testEmail, password: testPassword },
      headers: directHeaders,
    });
  } catch {
    inactiveRejected = true;
  }
  if (!inactiveRejected) throw new Error('Una cuenta inactiva pudo iniciar sesión.');

  process.stdout.write(
    'Auth smoke: password, OTP, one-time use, session, protected route, logout and inactive-user checks passed.\n',
  );
} finally {
  await prisma.user.deleteMany({ where: { id: testId } });
  await app.close();
}
