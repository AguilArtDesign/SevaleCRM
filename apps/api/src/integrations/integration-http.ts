import {
  BadGatewayException,
  GatewayTimeoutException,
  ServiceUnavailableException,
} from '@nestjs/common';

const REQUEST_TIMEOUT_MS = 10_000;

export type IntegrationRequestOptions = {
  timeoutMs?: number;
  retryCount?: number;
};

export class IntegrationAuthenticationException extends BadGatewayException {
  constructor(integration: string) {
    super({
      success: false,
      error: {
        code: 'INTEGRATION_AUTHENTICATION_FAILED',
        message: `${integration} rechazó las credenciales configuradas.`,
      },
    });
  }
}

export function requireIntegrationValue(name: string, integration: string): string {
  const value = process.env[name]?.trim();
  if (!value) {
    throw new ServiceUnavailableException({
      success: false,
      error: {
        code: 'INTEGRATION_NOT_CONFIGURED',
        message: `La integración con ${integration} no está configurada.`,
      },
    });
  }
  return value;
}

export function integrationUrl(baseUrl: string, path: string): URL {
  try {
    const normalizedBase = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
    const url = new URL(path.replace(/^\//, ''), normalizedBase);
    if (process.env.NODE_ENV === 'production' && url.protocol !== 'https:') {
      throw new Error('Production integrations require HTTPS.');
    }
    if (url.protocol !== 'https:' && url.protocol !== 'http:') {
      throw new Error('Unsupported integration protocol.');
    }
    return url;
  } catch {
    throw new ServiceUnavailableException({
      success: false,
      error: {
        code: 'INTEGRATION_NOT_CONFIGURED',
        message: 'La URL de la integración no es válida.',
      },
    });
  }
}

async function integrationRequest(
  url: URL,
  integration: string,
  init: RequestInit,
  options: IntegrationRequestOptions = {},
): Promise<unknown> {
  const timeoutMs = options.timeoutMs ?? REQUEST_TIMEOUT_MS;
  const retryCount = Math.max(0, options.retryCount ?? 0);

  for (let attempt = 0; attempt <= retryCount; attempt += 1) {
    let response: Response;
    try {
      response = await fetch(url, {
        ...init,
        headers: { accept: 'application/json', ...init.headers },
        signal: AbortSignal.timeout(timeoutMs),
      });
    } catch (error) {
      if (attempt < retryCount) continue;
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new GatewayTimeoutException({
          success: false,
          error: {
            code: 'INTEGRATION_TIMEOUT',
            message: `${integration} tardó demasiado en responder.`,
          },
        });
      }
      throw new BadGatewayException({
        success: false,
        error: {
          code: 'INTEGRATION_UNAVAILABLE',
          message: `No fue posible consultar ${integration}.`,
        },
      });
    }

    if (!response.ok) {
      const authenticationFailure = response.status === 401 || response.status === 403;
      if (authenticationFailure) throw new IntegrationAuthenticationException(integration);
      const transientFailure = response.status === 429 || response.status >= 500;
      if (transientFailure && attempt < retryCount) continue;
      throw new BadGatewayException({
        success: false,
        error: {
          code: 'INTEGRATION_REQUEST_FAILED',
          message: `${integration} no pudo completar la consulta.`,
        },
      });
    }

    try {
      return await response.json();
    } catch {
      throw new BadGatewayException({
        success: false,
        error: {
          code: 'INTEGRATION_INVALID_RESPONSE',
          message: `${integration} devolvió una respuesta no válida.`,
        },
      });
    }
  }

  throw new BadGatewayException();
}

export function integrationGet(
  url: URL,
  headers: HeadersInit,
  integration: string,
): Promise<unknown> {
  return integrationRequest(url, integration, { method: 'GET', headers });
}

export function integrationPost(
  url: URL,
  headers: HeadersInit,
  body: unknown,
  integration: string,
  options?: IntegrationRequestOptions,
): Promise<unknown> {
  return integrationRequest(
    url,
    integration,
    {
      method: 'POST',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    },
    options,
  );
}

export function integrationPut(
  url: URL,
  headers: HeadersInit,
  body: unknown,
  integration: string,
  options?: IntegrationRequestOptions,
): Promise<unknown> {
  return integrationRequest(
    url,
    integration,
    {
      method: 'PUT',
      headers: { 'content-type': 'application/json', ...headers },
      body: JSON.stringify(body),
    },
    options,
  );
}

export function invalidIntegrationResponse(integration: string): BadGatewayException {
  return new BadGatewayException({
    success: false,
    error: {
      code: 'INTEGRATION_INVALID_RESPONSE',
      message: `${integration} devolvió datos con un formato no reconocido.`,
    },
  });
}
