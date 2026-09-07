import { Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { FastifyRequest } from 'fastify';
import { PrismaService } from '../database/prisma.service.js';
import { AuthService } from './auth.service.js';
import { IS_PUBLIC_ROUTE } from './public.decorator.js';

const ABSOLUTE_SESSION_TIMEOUT_MS = 8 * 60 * 60 * 1000;

export type AuthenticatedRequest = FastifyRequest & {
  auth: NonNullable<Awaited<ReturnType<AuthService['getSession']>>>;
};

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const session = await this.authService.getSession(request.headers);
    if (!session) throw new UnauthorizedException('Debes iniciar sesión.');

    const sessionCreatedAt = new Date(session.session.createdAt).getTime();
    if (
      !Number.isFinite(sessionCreatedAt) ||
      Date.now() - sessionCreatedAt >= ABSOLUTE_SESSION_TIMEOUT_MS
    ) {
      await this.prisma.session.deleteMany({ where: { id: session.session.id } });
      throw new UnauthorizedException('La sesión alcanzó su duración máxima de 8 horas.');
    }

    const user = await this.prisma.user.findUnique({
      where: { id: session.user.id },
      select: { active: true },
    });
    if (!user?.active) throw new UnauthorizedException('La cuenta no está activa.');

    request.auth = session;
    return true;
  }
}
