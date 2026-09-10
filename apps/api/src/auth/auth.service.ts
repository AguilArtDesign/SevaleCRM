import { Injectable } from '@nestjs/common';
import { prismaAdapter } from '@better-auth/prisma-adapter';
import { betterAuth } from 'better-auth';
import { APIError, createAuthMiddleware } from 'better-auth/api';
import { captcha, emailOTP } from 'better-auth/plugins';
import { fromNodeHeaders } from 'better-auth/node';
import { emailSchema } from '@sevale/validation';
import type { IncomingHttpHeaders } from 'node:http';
import { PrismaService } from '../database/prisma.service.js';
import { MailService } from './mail.service.js';

const DEVELOPMENT_TURNSTILE_SECRET = '1x0000000000000000000000000000000AA';

function isSessionWriteConflict(error: unknown): boolean {
  if (!error || typeof error !== 'object') return false;
  const candidate = error as { code?: unknown; message?: unknown };
  return (
    candidate.code === 'P2039' &&
    typeof candidate.message === 'string' &&
    candidate.message.includes('Record has changed since last read')
  );
}

function getRequiredAuthSecret(): string | undefined {
  const secret = process.env.BETTER_AUTH_SECRET;

  if (process.env.NODE_ENV === 'production' && (!secret || secret.length < 32)) {
    throw new Error('BETTER_AUTH_SECRET debe tener al menos 32 caracteres en producción.');
  }

  return secret || undefined;
}

function getTurnstileSecret(): string {
  const secret = process.env.TURNSTILE_SECRET_KEY;

  if (secret) return secret;
  if (process.env.NODE_ENV !== 'production') return DEVELOPMENT_TURNSTILE_SECRET;

  throw new Error('TURNSTILE_SECRET_KEY es obligatoria en producción.');
}

@Injectable()
export class AuthService {
  readonly auth;

  constructor(
    private readonly prisma: PrismaService,
    mail: MailService,
  ) {
    this.auth = betterAuth({
      appName: 'SevaleCRM',
      baseURL: process.env.BETTER_AUTH_URL || 'http://localhost:3000',
      basePath: '/api/auth',
      secret: getRequiredAuthSecret(),
      trustedOrigins: [process.env.FRONTEND_URL || 'http://localhost:5173'],
      database: prismaAdapter(prisma, {
        provider: 'mysql',
        usePlural: false,
        transaction: true,
      }),
      emailAndPassword: {
        enabled: true,
        disableSignUp: true,
        minPasswordLength: 8,
        maxPasswordLength: 128,
      },
      user: {
        additionalFields: {
          role: {
            type: ['ADMIN', 'COMMERCIAL', 'LOGISTICS'],
            input: false,
            defaultValue: 'COMMERCIAL',
          },
          active: { type: 'boolean', input: false, defaultValue: true },
          lastLoginAt: { type: 'date', required: false, input: false, returned: false },
        },
      },
      session: {
        expiresIn: 60 * 60 * 2,
        updateAge: 60 * 5,
        cookieCache: { enabled: false },
      },
      rateLimit: {
        enabled: true,
        window: 60,
        max: 100,
        customRules: {
          '/sign-in/email': { window: 60, max: 5 },
          '/sign-in/email-otp': { window: 60, max: 5 },
          '/email-otp/send-verification-otp': { window: 60, max: 3 },
        },
      },
      hooks: {
        before: createAuthMiddleware(async (context) => {
          const protectedPaths = [
            '/email-otp/send-verification-otp',
            '/sign-in/email',
            '/sign-in/email-otp',
          ];

          if (!protectedPaths.includes(context.path)) return;

          const body = context.body as { email?: unknown } | undefined;
          const parsedEmail = emailSchema.safeParse(body?.email);
          if (!parsedEmail.success) return;
          const email = parsedEmail.data;

          const user = await this.prisma.user.findUnique({
            where: { email },
            select: { active: true },
          });

          if (context.path === '/email-otp/send-verification-otp' && (!user || !user.active)) {
            return context.json({ success: true });
          }

          if (!user?.active) {
            throw new APIError('UNAUTHORIZED', { message: 'Credenciales inválidas.' });
          }
        }),
        after: createAuthMiddleware(async (context) => {
          const userId = context.context.newSession?.user.id;
          if (!userId || !context.path.startsWith('/sign-in/')) return;

          await this.prisma.user.update({
            where: { id: userId },
            data: { lastLoginAt: new Date() },
          });
        }),
      },
      plugins: [
        emailOTP({
          otpLength: 6,
          expiresIn: 300,
          allowedAttempts: 5,
          disableSignUp: true,
          storeOTP: 'hashed',
          resendStrategy: 'rotate',
          rateLimit: { window: 60, max: 3 },
          sendVerificationOTP: async ({ email, otp, type }) => {
            if (type === 'sign-in') await mail.sendSignInCode(email, otp);
          },
        }),
        ...(process.env.NODE_ENV === 'production'
          ? [
              captcha({
                provider: 'cloudflare-turnstile',
                secretKey: getTurnstileSecret(),
                endpoints: ['/sign-in/email', '/email-otp/send-verification-otp'],
              }),
            ]
          : []),
      ],
      advanced: {
        useSecureCookies: process.env.NODE_ENV === 'production',
        defaultCookieAttributes: {
          httpOnly: true,
          secure: process.env.NODE_ENV === 'production',
          sameSite: 'lax',
          path: '/',
        },
        ipAddress: { ipAddressHeaders: ['x-client-ip'] },
      },
      telemetry: { enabled: false },
    });
  }

  async getSession(headers: IncomingHttpHeaders) {
    const normalizedHeaders = fromNodeHeaders(headers);
    try {
      return await this.auth.api.getSession({ headers: normalizedHeaders });
    } catch (error) {
      if (!isSessionWriteConflict(error)) throw error;
      return this.auth.api.getSession({ headers: normalizedHeaders });
    }
  }
}
