import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { integrationGet, integrationUrl } from '../integration-http.js';

const defaultUrl = 'https://www.datos.gov.co/resource/32sa-8pi3.json';
/** La TRM cambia una vez al día; una hora de caché evita consultarla en cada vista previa. */
const cacheLifetimeMs = 60 * 60 * 1000;

export type ExchangeRate = {
  /** Pesos por dólar. */
  value: number;
  /** Primer día de vigencia informado por la fuente. */
  validFrom: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function invalidPayload() {
  return new ServiceUnavailableException({
    success: false,
    error: {
      code: 'EXCHANGE_RATE_INVALID_RESPONSE',
      message: 'La fuente de la TRM devolvió datos con un formato no reconocido.',
    },
  });
}

function parseRate(payload: unknown): ExchangeRate {
  const record = Array.isArray(payload) ? payload.find(isRecord) : payload;
  if (!isRecord(record)) throw invalidPayload();
  const value = Number(record.valor);
  const validFrom = typeof record.vigenciadesde === 'string' ? record.vigenciadesde : '';
  if (!Number.isFinite(value) || value <= 0 || !validFrom) throw invalidPayload();
  return { value, validFrom };
}

/**
 * TRM oficial publicada en datos.gov.co. Siigo exige `exchange_rate` en las cotizaciones en
 * dólares, así que se consulta al momento de cotizar en lugar de guardarla: el CRM sigue trabajando
 * con el precio en dólares del producto y esta tasa solo viaja en el documento de Siigo.
 */
@Injectable()
export class ExchangeRateService {
  private cache: { rate: ExchangeRate; expiresAt: number } | null = null;

  async current(): Promise<ExchangeRate> {
    if (this.cache && this.cache.expiresAt > Date.now()) return this.cache.rate;
    const url = integrationUrl(process.env.TRM_API_URL?.trim() || defaultUrl, '');
    url.searchParams.set('$limit', '1');
    url.searchParams.set('$order', 'vigenciadesde DESC');
    let payload: unknown;
    try {
      payload = await integrationGet(url, {}, 'TRM');
    } catch {
      throw new ServiceUnavailableException({
        success: false,
        error: {
          code: 'EXCHANGE_RATE_UNAVAILABLE',
          message: 'No fue posible consultar la TRM del día.',
        },
      });
    }
    const rate = parseRate(payload);
    this.cache = { rate, expiresAt: Date.now() + cacheLifetimeMs };
    return rate;
  }
}
