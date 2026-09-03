import { ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { CanActivate, ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { rolePermissions, roles } from '@sevale/permissions';
import type { Permission, Role } from '@sevale/permissions';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { IS_PUBLIC_ROUTE } from '../auth/public.decorator.js';
import { REQUIRED_PERMISSIONS } from './require-permissions.decorator.js';

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && roles.some((role) => role === value);
}

@Injectable()
export class PermissionsGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_ROUTE, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    const required = this.reflector.getAllAndOverride<Permission[]>(REQUIRED_PERMISSIONS, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required?.length) return true;

    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const role = request.auth?.user.role;
    if (!isRole(role)) throw new UnauthorizedException('La sesión no contiene un rol válido.');

    const granted = rolePermissions[role] as readonly Permission[];
    if (!required.every((permission) => granted.includes(permission))) {
      throw new ForbiddenException('No tienes permisos para realizar esta acción.');
    }
    return true;
  }
}
