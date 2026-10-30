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
  /**
   * El proveedor pide credenciales en la query (Puntos Colombia) y su respuesta trae el token. Con
   * esto el registro guarda solo el origen y la ruta, y omite el cuerpo de la respuesta, para que el
   * secreto no quede escrito en la base ni visible en el panel de Logs.
   */
  confidential?: boolean;
};

/**
 * Rutas de autenticación. Se reconocen por la URL y no por una bandera en cada llamada: cualquier
 * integración futura queda cubierta sin que nadie tenga que acordarse de marcar la petición, y un
 * cambio de nombre en la llamada no puede reabrir la fuga.
 */
const authenticationPaths = /(^|\/)(auth|auth\/|oauth|token|tokens|session|login)(\/|$)/i;

/** Una llamada de autenticación intercambia credenciales: su cuerpo nunca se registra. */
export function isAuthenticationRequest(url: URL): boolean {
  return authenticationPaths.test(url.pathname);
}

/** Entrada que se entrega al registro persistente cuando algo llama a una API externa. */
export type IntegrationHttpLog = {
  integration: string;
  operation: string;
  outcome: 'SUCCESS' | 'ERROR';
  method: string;
  url: string;
  statusCode: number | null;
  code: string | null;
  message: string | null;
  requestBody: unknown;
  responseBody: unknown;
  durationMs: number;
};

type IntegrationLogSink = (entry: IntegrationHttpLog) => void;

let logSink: IntegrationLogSink | null = null;

/**
 * El registro vive en la base de datos, pero este módulo no conoce Prisma a propósito: es el punto
 * por el que pasa toda llamada externa y debe poder usarse en pruebas sin base de datos.
 */
export function setIntegrationLogSink(sink: IntegrationLogSink | null): void {
  logSink = sink;
}

function emitLog(entry: IntegrationHttpLog): void {
  try {
    logSink?.(entry);
  } catch {
    // El registro de diagnóstico nunca debe romper la integración que está describiendo.
  }
}

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

// Un recurso que ya no existe es un estado final y no un fallo transitorio: quien llama puede
// tratarlo como éxito (por ejemplo, un borrado que ya se había hecho a mano en la tienda).
export class IntegrationResourceMissingException extends BadGatewayException {
  constructor(integration: string) {
    super({
      success: false,
      error: {
        code: 'INTEGRATION_RESOURCE_MISSING',
        message: `${integration} no encontró el recurso solicitado.`,
      },
    });
  }
}

/**
 * El proveedor entendió la petición y la rechazó por una regla de negocio (4xx). Es un estado final:
 * repetirla con los mismos datos daría lo mismo. Se distingue del resto de fallos porque todos
 * salían como `BadGatewayException` y, por el estado 502, no había forma de saber si el proveedor
 * había aplicado algo o no.
 */
export class IntegrationRequestRejectedException extends BadGatewayException {
  constructor(
    integration: string,
    readonly statusCode: number,
    readonly providerDetail: string | null,
  ) {
    super({
      success: false,
      error: {
        code: 'INTEGRATION_REQUEST_FAILED',
        message: providerDetail
          ? `${integration} rechazó la solicitud: ${providerDetail}`
          : `${integration} no pudo completar la consulta.`,
      },
    });
  }
}

export function integrationErrorCode(error: unknown): string | null {
  if (!isRecord(error) || typeof error.getResponse !== 'function') return null;
  const response = (error as { getResponse: () => unknown }).getResponse();
  if (!isRecord(response) || !isRecord(response.error)) return null;
  const code = response.error.code;
  return typeof code === 'string' ? code : null;
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

  // Puntos Colombia describe el motivo en `resultMsg`.
  if (typeof payload.resultMsg === 'string') {
    const normalized = payload.resultMsg.trim().split(/\s+/u).join(' ');
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

type RequestTrace = {
  statusCode: number | null;
  responseBody: unknown;
};

/**
 * Envuelve la llamada para dejar rastro de todos los casos: éxito, rechazo del proveedor, timeout y
 * caída de red. El cuerpo de la petición se guarda tal cual se envió, sin cabeceras, salvo en las
 * llamadas de autenticación: allí lo que viaja son las credenciales del `.env`.
 */
async function integrationRequest(
  url: URL,
  integration: string,
  init: RequestInit,
  options: IntegrationRequestOptions = {},
): Promise<unknown> {
  const startedAt = Date.now();
  const method = (init.method ?? 'GET').toUpperCase();
  const operation = `${method} ${url.pathname}`;
  const trace: RequestTrace = { statusCode: null, responseBody: null };
  // Una llamada confidencial se registra sin query ni cuerpos: el secreto viaja en la URL o en el
  // cuerpo, y la respuesta puede traer el token. La autenticación lo es siempre, sin excepción.
  const confidential = options.confidential === true || isAuthenticationRequest(url);
  const logUrl = confidential ? `${url.origin}${url.pathname}` : url.toString();
  try {
    const payload = await performRequest(url, integration, init, options, trace);
    emitLog({
      integration,
      operation,
      outcome: 'SUCCESS',
      method,
      url: logUrl,
      statusCode: trace.statusCode ?? 200,
      code: null,
      message: null,
      requestBody: confidential ? null : init.body,
      responseBody: confidential ? null : payload,
      durationMs: Date.now() - startedAt,
    });
    return payload;
  } catch (error) {
    emitLog({
      integration,
      operation,
      outcome: 'ERROR',
      method,
      url: logUrl,
      statusCode: trace.statusCode,
      code: integrationErrorCode(error),
      message: exceptionMessage(error),
      requestBody: confidential ? null : init.body,
      responseBody: confidential ? null : trace.responseBody,
      durationMs: Date.now() - startedAt,
    });
    throw error;
  }
}

function exceptionMessage(error: unknown): string | null {
  if (!isRecord(error) || typeof error.getResponse !== 'function') {
    return error instanceof Error ? error.message : null;
  }
  const response = (error as { getResponse: () => unknown }).getResponse();
  if (!isRecord(response) || !isRecord(response.error)) return null;
  const message = response.error.message;
  return typeof message === 'string' ? message : null;
}

async function performRequest(
  url: URL,
  integration: string,
  init: RequestInit,
  options: IntegrationRequestOptions,
  trace: RequestTrace,
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

    trace.statusCode = response.status;
    try {
      trace.responseBody = await response.clone().json();
    } catch {
      trace.responseBody = null;
    }

    if (!response.ok) {
      const authenticationFailure = response.status === 401 || response.status === 403;
      if (authenticationFailure) {
        await logIntegrationFailure(url, integration, response);
        throw new IntegrationAuthenticationException(integration);
      }
      // Un 404 describe un estado final y no una condición transitoria: no se reintenta y se
      // informa con un código propio para que quien llama decida si cuenta como fallo.
      if (response.status === 404) {
        await logIntegrationFailure(url, integration, response);
        throw new IntegrationResourceMissingException(integration);
      }
      const transientFailure = response.status === 429 || response.status >= 500;
      if (transientFailure && attempt < retryCount) continue;
      await logIntegrationFailure(url, integration, response);
      const payload = trace.responseBody;
      const detail = integrationErrorMessage(payload);
      // Un 4xx es un rechazo de negocio: quien llama puede decidir si lo informa como fallo
      // definitivo en vez de tratarlo como resultado incierto.
      if (!transientFailure) {
        throw new IntegrationRequestRejectedException(integration, response.status, detail);
      }
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

    if (trace.responseBody === null) {
      throw new BadGatewayException({
        success: false,
        error: {
          code: 'INTEGRATION_INVALID_RESPONSE',
          message: `${integration} devolvió una respuesta no válida.`,
        },
      });
    }
    return trace.responseBody;
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
