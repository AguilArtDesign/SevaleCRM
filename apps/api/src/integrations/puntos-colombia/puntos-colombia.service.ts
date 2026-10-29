import { Injectable, Logger } from '@nestjs/common';
import {
  IntegrationAuthenticationException,
  IntegrationResourceMissingException,
  integrationGet,
  integrationPost,
  integrationUrl,
  invalidIntegrationResponse,
} from '../integration-http.js';
import {
  puntosColombiaConfig,
  puntosColombiaHeaders,
  type PuntosColombiaConfig,
} from './puntos-colombia-config.js';
import { PuntosColombiaTokenService } from './puntos-colombia-token.service.js';

type UnknownRecord = Record<string, unknown>;

export type PointsDocumentType = '2' | '3' | '5';

/** Lo que el panel necesita del saldo: nada más se guarda ni se muestra. */
export type PointsBalance = {
  name: string | null;
  pointsAmount: number;
  pointsValueInMoney: number;
  allowAccrual: boolean;
};

export type PointsAccrualResult = {
  pointsEarned: number;
  pointsBalance: number;
  approbationNumber: string | null;
};

/** El proveedor contestó que la cuenta no existe; es un resultado de negocio, no un fallo técnico. */
export class PointsAccountNotFoundError extends Error {}

export type TransactionIdentifier = {
  terminalId: string;
  transactionId: string;
  cashierId: string;
  locationCode: string;
  /** `YYYY-MM-DDTHH:mm:ss` en hora de Colombia, sin sufijo ni milisegundos. */
  transactionDate: string;
  nut: string;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function finiteNumber(value: unknown): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/**
 * Fecha y hora de la operación tal como las espera el proveedor: hora de Colombia y sin zona
 * explícita. Se arma con las partes de `America/Bogota` para que no dependa de la zona del servidor.
 */
export function puntoColombiaDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((result, part) => {
      if (part.type !== 'literal') result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:${parts.minute}:${parts.second}`;
}

/**
 * Cliente de las tres fases de Puntos Colombia: token, consulta de cuenta y acumulación. Todo sale
 * del backend; React nunca ve credenciales ni llama al proveedor.
 */
@Injectable()
export class PuntosColombiaService {
  private readonly logger = new Logger(PuntosColombiaService.name);

  constructor(private readonly tokens: PuntosColombiaTokenService) {}

  /**
   * Saldo corto de una cuenta. `documentNo` va en la ruta y `documentType` en la query, como exige el
   * proveedor. Un 401 se reintenta una sola vez con token nuevo: es el único fallo que el token
   * explica, y repetir más veces solo duplicaría llamadas.
   */
  lookupAccount(documentNumber: string, documentType: PointsDocumentType): Promise<PointsBalance> {
    return this.withToken((token, config) =>
      this.requestBalance(token, config, documentNumber, documentType),
    );
  }

  processSale(
    documentNumber: string,
    documentType: PointsDocumentType,
    transactionIdentifier: TransactionIdentifier,
    mainPoints: number,
  ): Promise<PointsAccrualResult> {
    return this.withToken((token, config) =>
      this.requestProcessSale(token, config, {
        documentNo: documentNumber,
        documentType,
        partnerCode: config.partnerCode,
        transactionIdentifier,
        mainPoints,
      }),
    );
  }

  private async withToken<T>(
    request: (token: string, config: PuntosColombiaConfig) => Promise<T>,
  ): Promise<T> {
    const config = puntosColombiaConfig();
    const token = await this.tokens.getAccessToken();
    try {
      return await request(token, config);
    } catch (error) {
      if (!(error instanceof IntegrationAuthenticationException)) throw error;
      this.logger.warn('Puntos Colombia rechazó el token; se renueva y se reintenta una vez.');
      const renewed = await this.tokens.refreshAccessToken(token);
      return request(renewed, config);
    }
  }

  private async requestBalance(
    token: string,
    config: PuntosColombiaConfig,
    documentNumber: string,
    documentType: PointsDocumentType,
  ): Promise<PointsBalance> {
    const url = integrationUrl(
      config.baseUrl,
      `pos-management/v1/accounts/${encodeURIComponent(documentNumber)}/shortBalance`,
    );
    url.searchParams.set('PartnerCode', config.partnerCode);
    url.searchParams.set('LocationCode', config.locationCode);
    url.searchParams.set('documentType', documentType);

    let payload: unknown;
    try {
      payload = await integrationGet(url, puntosColombiaHeaders(config, token), 'Puntos Colombia');
    } catch (error) {
      // La cuenta inexistente llega como 404 con `resultCode: POS_CUSTOMER_NOT_FOUND`. Es un
      // resultado de negocio —el cliente no está en el programa— y no un fallo técnico, así que se
      // informa como tal para que el panel lo muestre en vez de un error de integración.
      if (error instanceof IntegrationResourceMissingException) {
        throw new PointsAccountNotFoundError();
      }
      throw error;
    }
    if (!isRecord(payload)) throw invalidIntegrationResponse('Puntos Colombia');
    if (payload.resultCode === 'POS_CUSTOMER_NOT_FOUND') throw new PointsAccountNotFoundError();
    if (typeof payload.resultCode === 'string' && payload.resultCode) {
      throw invalidIntegrationResponse('Puntos Colombia');
    }
    const balance = isRecord(payload.mainBalance) ? payload.mainBalance : null;
    if (!balance) throw invalidIntegrationResponse('Puntos Colombia');
    return {
      name: typeof payload.name === 'string' ? payload.name : null,
      pointsAmount: Math.trunc(finiteNumber(balance.pointsAmount)),
      pointsValueInMoney: finiteNumber(balance.pointsValueInMoney),
      // Solo `allowAccrual` decide: `allowRedemption` habla de canje y no de acumular.
      allowAccrual: payload.allowAccrual === true,
    };
  }

  private async requestProcessSale(
    token: string,
    config: PuntosColombiaConfig,
    body: UnknownRecord,
  ): Promise<PointsAccrualResult> {
    const url = integrationUrl(config.baseUrl, 'pos-management/v1/transactions/processsale');
    const payload = await integrationPost(
      url,
      { ...puntosColombiaHeaders(config, token), 'content-type': 'application/json' },
      body,
      'Puntos Colombia',
    );
    if (!isRecord(payload)) throw invalidIntegrationResponse('Puntos Colombia');
    const balance = isRecord(payload.mainBalance) ? payload.mainBalance : null;
    if (!balance) throw invalidIntegrationResponse('Puntos Colombia');
    return {
      // Lo acreditado lo dice el proveedor: no se asume que sea igual a lo solicitado.
      pointsEarned: Math.trunc(finiteNumber(balance.pointsEarned)),
      pointsBalance: Math.trunc(finiteNumber(balance.pointsBalance)),
      approbationNumber:
        typeof payload.approbationNumber === 'string' ? payload.approbationNumber : null,
    };
  }
}
