import {
  BadGatewayException,
  GatewayTimeoutException,
  Logger,
  ServiceUnavailableException,
} from '@nestjs/common';

const REQUEST_TIMEOUT_MS = 10_000;
const integrationLogger = new Logger('Integrations');

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function integrationErrorMessage(payload: unknown): string | null {
  if (!isRecord(payload)) return null;
  const errors = payload.Errors;
  if (Array.isArray(errors)) {
    const messages = errors
      .map((error) => {
        if (!isRecord(error)) return null;
        const message = error.Message;
        if (typeof message !== 'string') return null;
        const normalized = message.trim().split(/\s+/u).join(' ');
        return normalized ? normalized.slice(0, 300) : null;
      })
      .filter((message): message is string => message !== null)
      .slice(0, 3);

    if (messages.length > 0) return messages.join(' ').slice(0, 450);
  }

  // La REST API de WooCommerce responde { code, message } cuando rechaza una solicitud.
  if (typeof payload.message === 'string') {
    const normalized = payload.message.trim().split(/\s+/u).join(' ');
    return normalized ? normalized.slice(0, 450) : null;
  }

  return null;
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

// Registra el estado HTTP y el mensaje del proveedor sin exponer credenciales ni datos del cliente.
async function logIntegrationFailure(
  url: URL,
  integration: string,
  response: Response,
): Promise<void> {
  let providerMessage = '';
  try {
    const parsed: unknown = await response.clone().json();
    if (
      parsed !== null &&
      typeof parsed === 'object' &&
      'message' in parsed &&
      typeof (parsed as { message?: unknown }).message === 'string'
    ) {
      providerMessage = (parsed as { message: string }).message;
    }
  } catch {
    // La respuesta de error no era JSON: el estado HTTP es suficiente para el diagnóstico.
  }
  integrationLogger.error(
    `${integration} respondió ${response.status} en ${url.pathname}${providerMessage ? `: ${providerMessage}` : ''}`,
  );
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
      if (authenticationFailure) {
        await logIntegrationFailure(url, integration, response);
        throw new IntegrationAuthenticationException(integration);
      }
      const transientFailure = response.status === 429 || response.status >= 500;
      if (transientFailure && attempt < retryCount) continue;
      await logIntegrationFailure(url, integration, response);
      const payload = (await response.json().catch(() => null)) as unknown;
      const detail = integrationErrorMessage(payload);
      throw new BadGatewayException({
        success: false,
        error: {
          code: 'INTEGRATION_REQUEST_FAILED',
          message: detail
            ? `${integration} rechazó la solicitud: ${detail}`
            : `${integration} no pudo completar la consulta.`,
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
  options?: IntegrationRequestOptions,
): Promise<unknown> {
  return integrationRequest(url, integration, { method: 'GET', headers }, options);
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

export function integrationDelete(
  url: URL,
  headers: HeadersInit,
  integration: string,
  options?: IntegrationRequestOptions,
): Promise<unknown> {
  return integrationRequest(url, integration, { method: 'DELETE', headers }, options);
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
