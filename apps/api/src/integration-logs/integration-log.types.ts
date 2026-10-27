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

/**
 * Serializa un cuerpo para guardarlo. Se recorta porque el log es para leer, no para reconstruir
 * la petición; y se descartan las claves que parecen credenciales por si alguna viaja en el cuerpo.
 */
export function serializeLogBody(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  let text: string;
  if (typeof value === 'string') {
    text = value;
  } else {
    try {
      text = JSON.stringify(value, (key, item: unknown) =>
        /token|password|secret|authorization|access_key/i.test(key) ? '[omitido]' : item,
      );
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
