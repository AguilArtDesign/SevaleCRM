import { Catch, HttpException, HttpStatus, Logger } from '@nestjs/common';
import type { ArgumentsHost, ExceptionFilter } from '@nestjs/common';
import type { FastifyReply, FastifyRequest } from 'fastify';

type SafeError = {
  success: false;
  error: { code: string; message: string; details?: unknown };
};

const DEFAULT_ERRORS: Record<number, SafeError['error']> = {
  [HttpStatus.BAD_REQUEST]: { code: 'BAD_REQUEST', message: 'La solicitud no es válida.' },
  [HttpStatus.UNAUTHORIZED]: { code: 'UNAUTHORIZED', message: 'Debes iniciar sesión.' },
  [HttpStatus.FORBIDDEN]: { code: 'FORBIDDEN', message: 'No tienes permisos para esta acción.' },
  [HttpStatus.NOT_FOUND]: { code: 'NOT_FOUND', message: 'El recurso solicitado no existe.' },
  [HttpStatus.CONFLICT]: {
    code: 'CONFLICT',
    message: 'La solicitud entra en conflicto con el estado actual.',
  },
  [HttpStatus.TOO_MANY_REQUESTS]: {
    code: 'RATE_LIMIT_EXCEEDED',
    message: 'Se alcanzó el límite de solicitudes. Intenta más tarde.',
  },
  [HttpStatus.SERVICE_UNAVAILABLE]: {
    code: 'SERVICE_UNAVAILABLE',
    message: 'El servicio no está disponible temporalmente.',
  },
};

function isSafeError(value: unknown): value is SafeError {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Partial<SafeError>;
  return (
    candidate.success === false &&
    typeof candidate.error?.code === 'string' &&
    typeof candidate.error.message === 'string'
  );
}

@Catch()
export class ApiExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(ApiExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const http = host.switchToHttp();
    const request = http.getRequest<FastifyRequest>();
    const reply = http.getResponse<FastifyReply>();
    const status = exception instanceof HttpException ? exception.getStatus() : 500;
    const response = exception instanceof HttpException ? exception.getResponse() : null;
    const payload: SafeError = isSafeError(response)
      ? response
      : {
          success: false,
          error:
            DEFAULT_ERRORS[status] ||
            ({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Ocurrió un error interno.',
            } satisfies SafeError['error']),
        };

    if (status >= 500) {
      this.logger.error(
        `Solicitud fallida (${status}) ${request.method} ${request.routeOptions?.url || 'ruta desconocida'}`,
      );
    }
    void reply.status(status).send(payload);
  }
}
