import type { IntegrationLogOutcome, Prisma } from '../generated/prisma/client.js';

/** Máximo por cuerpo: una respuesta de WooCommerce puede pesar cientos de KB y no aporta más. */
const maxBodyLength = 8_000;

export type IntegrationLogEntry = {
  integration: string;
  operation: string;
  outcome: IntegrationLogOutcome;
  method?: string | null;
  url?: string | null;
  statusCode?: number | null;
  code?: string | null;
  message?: string | null;
  requestBody?: unknown;
  responseBody?: unknown;
  durationMs?: number | null;
  referenceType?: string | null;
  referenceId?: string | number | null;
  userId?: string | null;
};

/** Claves que nunca deben quedar escritas, aunque la llamada no sea de autenticación. */
const confidentialKeys = /token|password|secret|authorization|access_key/i;

function redact(key: string, value: unknown): unknown {
  return confidentialKeys.test(key) ? '[omitido]' : value;
}

/**
 * Un cuerpo puede llegar como objeto o como la cadena que ya se envió. En el segundo caso se intenta
 * interpretarlo como JSON para enmascararlo igual: si se guarda la cadena cruda, las credenciales de
 * `POST /auth` quedan escritas tal cual aunque la clave se llame `access_key`.
 */
function redactBody(value: unknown): unknown {
  if (typeof value !== 'string') return value;
  const text = value.trim();
  if (!text.startsWith('{') && !text.startsWith('[')) return value;
  try {
    return JSON.parse(text, (key, item: unknown) => redact(key, item));
  } catch {
    // No era JSON: se conserva tal cual, porque recortarlo perdería el diagnóstico sin ganar nada.
    return value;
  }
}

/**
 * Serializa un cuerpo para guardarlo. Se recorta porque el log es para leer, no para reconstruir
 * la petición; y se descartan las claves que parecen credenciales por si alguna viaja en el cuerpo.
 */
export function serializeLogBody(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  let text: string;
  if (typeof value === 'string') {
    const redacted = redactBody(value);
    text = typeof redacted === 'string' ? redacted : JSON.stringify(redacted);
  } else {
    try {
      text = JSON.stringify(value, (key, item: unknown) => redact(key, item));
    } catch {
      return null;
    }
  }
  if (!text) return null;
  return text.length > maxBodyLength ? `${text.slice(0, maxBodyLength)}… [recortado]` : text;
}

export function logData(entry: IntegrationLogEntry): Prisma.IntegrationLogUncheckedCreateInput {
  return {
    integration: entry.integration.slice(0, 50),
    operation: entry.operation.slice(0, 100),
    outcome: entry.outcome,
    method: entry.method?.slice(0, 10) ?? null,
    url: entry.url ?? null,
    statusCode: entry.statusCode ?? null,
    code: entry.code?.slice(0, 100) ?? null,
    message: entry.message?.slice(0, 4_000) ?? null,
    requestBody: serializeLogBody(entry.requestBody),
    responseBody: serializeLogBody(entry.responseBody),
    durationMs: entry.durationMs ?? null,
    referenceType: entry.referenceType?.slice(0, 50) ?? null,
    referenceId:
      entry.referenceId === undefined || entry.referenceId === null
        ? null
        : String(entry.referenceId).slice(0, 64),
    userId: entry.userId ?? null,
  };
}
