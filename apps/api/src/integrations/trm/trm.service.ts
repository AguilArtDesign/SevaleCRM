import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { integrationGet, integrationUrl } from '../integration-http.js';

/**
 * Cotizaciones de dolarapi. Cada moneda tiene su ruta y devuelve los pesos colombianos por unidad:
 * se usa `ultimoCierre` como tasa, que es la referencia con la que se cotiza en Siigo.
 */
const defaultBaseUrl = 'https://co.dolarapi.com/v1/cotizaciones';
/** La tasa cambia una vez al día; una hora de caché evita consultarla en cada vista previa. */
const cacheLifetimeMs = 60 * 60 * 1000;

export const quotedCurrencies = ['USD', 'MXN', 'EUR'] as const;

export type QuotedCurrency = (typeof quotedCurrencies)[number];

export type ExchangeRate = {
  currency: QuotedCurrency;
  /** Pesos colombianos por una unidad de la moneda. */
  value: number;
  /** Momento en que la fuente actualizó la cotización. */
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
      message: 'La fuente de la tasa de cambio devolvió datos con un formato no reconocido.',
    },
  });
}

function isQuotedCurrency(value: string): value is QuotedCurrency {
  return (quotedCurrencies as readonly string[]).includes(value);
}

function parseRate(payload: unknown, currency: QuotedCurrency): ExchangeRate {
  if (!isRecord(payload)) throw invalidPayload();
  const value = Number(payload.ultimoCierre);
  const validFrom =
    typeof payload.fechaActualizacion === 'string' ? payload.fechaActualizacion : '';
  if (!Number.isFinite(value) || value <= 0 || !validFrom) throw invalidPayload();
  return { currency, value, validFrom };
}

/**
 * Tasa de cambio de las monedas extranjeras. Siigo exige `exchange_rate` en las cotizaciones que no
 * son en pesos, así que se consulta al momento de cotizar en lugar de guardarla: el CRM sigue
 * trabajando con el precio en la moneda del producto y esta tasa solo viaja en el documento.
 *
 * La fuente es una sola para las tres monedas, con caché por moneda: una vista previa en euros no
 * invalida la del dólar.
 */
@Injectable()
export class ExchangeRateService {
  private readonly cache = new Map<QuotedCurrency, { rate: ExchangeRate; expiresAt: number }>();

  async current(currency: string): Promise<ExchangeRate> {
    if (!isQuotedCurrency(currency)) {
      throw new ServiceUnavailableException({
        success: false,
        error: {
          code: 'EXCHANGE_RATE_CURRENCY_NOT_SUPPORTED',
          message: `No hay una tasa de cambio configurada para la moneda ${currency}.`,
        },
      });
    }
    const cached = this.cache.get(currency);
    if (cached && cached.expiresAt > Date.now()) return cached.rate;

    const base = process.env.EXCHANGE_RATE_API_URL?.trim() || defaultBaseUrl;
    const url = integrationUrl(`${base.replace(/\/$/, '')}/${currency.toLowerCase()}`, '');
    let payload: unknown;
    try {
      payload = await integrationGet(url, {}, 'TASA DE CAMBIO');
    } catch {
      throw new ServiceUnavailableException({
        success: false,
        error: {
          code: 'EXCHANGE_RATE_UNAVAILABLE',
          message: 'No fue posible consultar la tasa de cambio del día.',
        },
      });
    }
    const rate = parseRate(payload, currency);
    this.cache.set(currency, { rate, expiresAt: Date.now() + cacheLifetimeMs });
    return rate;
  }
}
