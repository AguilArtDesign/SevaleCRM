import {
  Injectable,
  ServiceUnavailableException,
  UnauthorizedException,
  type CanActivate,
  type ExecutionContext,
} from '@nestjs/common';
import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyRequest } from 'fastify';

function digest(value: string): Buffer {
  return createHash('sha256').update(value).digest();
}

@Injectable()
export class N8nApiKeyGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const configuredKey = process.env.N8N_API_KEY;
    if (!configuredKey) {
      throw new ServiceUnavailableException({
        success: false,
        error: {
          code: 'N8N_INTEGRATION_NOT_CONFIGURED',
          message: 'La integración con n8n no está configurada.',
        },
      });
    }

    const request = context.switchToHttp().getRequest<FastifyRequest>();
    const authorization = request.headers.authorization;
    const presentedKey = authorization?.startsWith('Bearer ')
      ? authorization.slice('Bearer '.length)
      : '';
    if (!presentedKey || !timingSafeEqual(digest(presentedKey), digest(configuredKey))) {
      throw new UnauthorizedException({
        success: false,
        error: {
          code: 'INVALID_INTEGRATION_CREDENTIALS',
          message: 'Las credenciales de integración no son válidas.',
        },
      });
    }
    return true;
  }
}
