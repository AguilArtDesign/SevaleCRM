import { Injectable, Logger } from '@nestjs/common';
import {
  IntegrationAuthenticationException,
  IntegrationRequestRejectedException,
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
  /** Si la cuenta puede redimir. Es una habilitación aparte de la de acumular. */
  allowRedemption: boolean;
};

export type PointsAccrualResult = {
  pointsEarned: number;
  pointsBalance: number;
  approbationNumber: string | null;
};

/**
 * Lo que el proveedor pide para redimir. Cuando el método es `OTP` envía un código al celular o al
 * correo del cliente; cuando es `TOTP` el cliente lo genera en su app y el proveedor no envía nada.
 */
export type PointsRedemptionChallenge = {
  validationMethod: string;
  /** Texto sugerido por el proveedor para explicarle al cliente por dónde le llega el código. */
  suggestedMessage: string | null;
};

/** Resultado de una redención aplicada: los puntos quemados y el saldo que queda. */
export type PointsRedemptionResult = {
  pointsRedeemed: number;
  pointsBalance: number;
  approbationNumber: string | null;
};

/** Datos que el proveedor necesita para quemar puntos de una cuenta. */
export type PointsRedemptionRequest = {
  documentNumber: string;
  documentType: PointsDocumentType;
  pin: string;
  points: number;
  transactionIdentifier: TransactionIdentifier;
};

/** El proveedor contestó que la cuenta no existe; es un resultado de negocio, no un fallo técnico. */
export class PointsAccountNotFoundError extends Error {}

/**
 * El proveedor rechazó la anulación con un `resultCode` propio. Es un fallo definitivo: reintentar
 * con los mismos datos daría lo mismo, así que se informa tal cual y no se marca como ambiguo.
 */
export class PointsCancellationRejectedError extends Error {
  constructor(
    readonly resultCode: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * El proveedor rechazó la acumulación sin aplicarla. Salvo un duplicado, es definitivo y se puede
 * reintentar: nada quedó acreditado. Sin distinguirlo, un `400` de negocio acababa marcado como
 * «por verificar» y bloqueaba la factura para siempre.
 */
export class PointsAccrualRejectedError extends Error {
  constructor(
    readonly resultCode: string,
    message: string,
  ) {
    super(message);
  }
}

/**
 * El proveedor rechazó la redención o la solicitud del código. Es definitivo: los puntos no se
 * quemaron, así que el operador puede corregir y volver a intentar cuando el cliente resuelva el
 * motivo (sin saldo, código vencido, cuenta inhabilitada).
 */
export class PointsRedemptionRejectedError extends Error {
  constructor(
    readonly resultCode: string,
    message: string,
  ) {
    super(message);
  }
}

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
 * Códigos con los que el proveedor confirma en lugar de rechazar. No hay contrato documentado de la
 * respuesta de anulación, así que se aceptan las dos formas: sin `resultCode` y con un código de
 * éxito conocido. Cualquier otro código se trata como rechazo.
 */
const cancellationSuccessCodes = new Set(['0', '00', '200', 'OK', 'SUCCESS']);

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

  /**
   * Pide al proveedor el código de un solo uso con el que el cliente autoriza la redención. Va a la
   * ruta de validación de identidad, no a la de redención: la de redención exige un `pin` y con uno
   * real quemaría los puntos en vez de enviar el código.
   */
  requestRedemptionChallenge(
    documentNumber: string,
    documentType: PointsDocumentType,
  ): Promise<PointsRedemptionChallenge> {
    return this.withToken((token, config) =>
      this.requestOtpChallenge(token, config, documentNumber, documentType),
    );
  }

  /**
   * Quema los puntos de una cuenta. Se diferencia de `processSale` en que aquí los puntos se gastan y
   * el `pin` es lo que prueba que el cliente lo autorizó.
   */
  redeemPoints(request: PointsRedemptionRequest): Promise<PointsRedemptionResult> {
    return this.withToken((token, config) => this.requestRedemption(token, config, request));
  }

  /**
   * Anula una acumulación ya acreditada. El proveedor exige los dos identificadores: el de la
   * operación que se anula —el que quedó guardado cuando se acumuló— y uno nuevo para la anulación,
   * que solo se distingue del original por la fecha.
   */
  cancelTransaction(
    original: TransactionIdentifier,
    cancellation: TransactionIdentifier,
  ): Promise<void> {
    return this.withToken((token, config) =>
      this.requestCancel(token, config, {
        partnerCode: config.partnerCode,
        transactionIdentifier: cancellation,
        originalTransactionIdentifier: original,
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
      // Las dos habilitaciones son independientes: el programa puede permitir acumular y no redimir.
      allowAccrual: payload.allowAccrual === true,
      allowRedemption: payload.allowRedemption === true,
    };
  }

  private async requestProcessSale(
    token: string,
    config: PuntosColombiaConfig,
    body: UnknownRecord,
  ): Promise<PointsAccrualResult> {
    const url = integrationUrl(config.baseUrl, 'pos-management/v1/transactions/processsale');
    let payload: unknown;
    try {
      payload = await integrationPost(
        url,
        { ...puntosColombiaHeaders(config, token), 'content-type': 'application/json' },
        body,
        'Puntos Colombia',
      );
    } catch (error) {
      // Un 4xx es un rechazo del proveedor, no un fallo incierto: se informa como tal para que no
      // quede como «por verificar» algo que el proveedor ya descartó.
      if (error instanceof IntegrationRequestRejectedException) {
        throw new PointsAccrualRejectedError(
          error.providerCode ?? String(error.statusCode),
          error.providerDetail ?? 'Puntos Colombia rechazó la acumulación.',
        );
      }
      throw error;
    }
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

  /**
   * Paso 1 de la redención: pide el código al proveedor. El cuerpo lleva `otpActions` con
   * `validate: false` y `redeem: true`, que es como el proveedor entiende «estoy pidiendo un código
   * para quemar puntos», no para consultar nada.
   */
  private async requestOtpChallenge(
    token: string,
    config: PuntosColombiaConfig,
    documentNumber: string,
    documentType: PointsDocumentType,
  ): Promise<PointsRedemptionChallenge> {
    const url = integrationUrl(
      config.baseUrl,
      'Vinculacion/v1/accounts/me/beginidentityvalidation',
    );
    let payload: unknown;
    try {
      payload = await integrationPost(
        url,
        {
          ...puntosColombiaHeaders(config, token),
          'content-type': 'application/json',
          // La solicitud del código sí pide el partner code también como cabecera, como la anulación.
          'CA-PARTNERCODE': config.partnerCode,
        },
        {
          documentNo: documentNumber,
          documentType,
          otpActions: { validate: false, redeem: true },
        },
        'Puntos Colombia',
      );
    } catch (error) {
      if (error instanceof IntegrationRequestRejectedException) {
        throw new PointsRedemptionRejectedError(
          error.providerCode ?? String(error.statusCode),
          error.providerDetail ?? 'Puntos Colombia rechazó la solicitud del código.',
        );
      }
      throw error;
    }
    if (!isRecord(payload)) throw invalidIntegrationResponse('Puntos Colombia');
    if (payload.processed !== true) {
      throw invalidIntegrationResponse('Puntos Colombia');
    }
    const validationMethod =
      typeof payload.validationMethod === 'string' ? payload.validationMethod.trim() : '';
    if (!validationMethod) throw invalidIntegrationResponse('Puntos Colombia');
    return {
      validationMethod,
      suggestedMessage:
        typeof payload.suggestedMessage === 'string' && payload.suggestedMessage.trim()
          ? payload.suggestedMessage.trim()
          : null,
    };
  }

  /**
   * Paso 2: quema los puntos. El proveedor devuelve `mainBalance` como texto y con lo que queda en la
   * cuenta, así que el saldo que se guarda es el suyo y no una resta nuestra.
   */
  private async requestRedemption(
    token: string,
    config: PuntosColombiaConfig,
    request: PointsRedemptionRequest,
  ): Promise<PointsRedemptionResult> {
    const url = integrationUrl(config.baseUrl, 'pos-management/v1/transactions/processredemption');
    let payload: unknown;
    try {
      payload = await integrationPost(
        url,
        {
          ...puntosColombiaHeaders(config, token),
          'content-type': 'application/json',
          'CA-PARTNERCODE': config.partnerCode,
        },
        {
          documentNo: request.documentNumber,
          documentType: request.documentType,
          pin: request.pin,
          partnerCode: config.partnerCode,
          mainPointsRedeemed: request.points,
          transactionIdentifier: request.transactionIdentifier,
        },
        'Puntos Colombia',
      );
    } catch (error) {
      if (error instanceof IntegrationRequestRejectedException) {
        throw new PointsRedemptionRejectedError(
          error.providerCode ?? String(error.statusCode),
          error.providerDetail ?? 'Puntos Colombia rechazó la redención.',
        );
      }
      throw error;
    }
    if (!isRecord(payload)) throw invalidIntegrationResponse('Puntos Colombia');
    // Los dos nombres conviven en la respuesta del proveedor; se acepta cualquiera de los dos.
    const burned = payload.mainPointsBurned ?? payload.mainPointsRedeemed;
    if (burned === undefined || burned === null)
      throw invalidIntegrationResponse('Puntos Colombia');
    return {
      // Lo quemado lo dice el proveedor: no se asume que sea igual a lo pedido.
      pointsRedeemed: Math.trunc(finiteNumber(burned)),
      pointsBalance: Math.trunc(finiteNumber(payload.mainBalance)),
      approbationNumber:
        typeof payload.approbationNumber === 'string' ? payload.approbationNumber : null,
    };
  }

  /**
   * La anulación copia la forma de la acumulación: un `resultCode` no vacío es un rechazo de negocio
   * y no una respuesta válida. El contrato documentado de este endpoint no trae un cuerpo de éxito
   * que valga la pena guardar, así que el resultado solo se confirma por el estado HTTP.
   */
  private async requestCancel(
    token: string,
    config: PuntosColombiaConfig,
    body: UnknownRecord,
  ): Promise<void> {
    const url = integrationUrl(config.baseUrl, 'pos-management/v1/transactions/cancel');
    let payload: unknown;
    try {
      payload = await integrationPost(
        url,
        {
          ...puntosColombiaHeaders(config, token),
          // La anulación pide el partner code también como cabecera. `processsale` ya está
          // certificado sin ella, así que la cabecera se agrega solo aquí en vez de cambiar el flujo
          // que funciona.
          'CA-PARTNERCODE': config.partnerCode,
        },
        body,
        'Puntos Colombia',
      );
    } catch (error) {
      // Un 4xx es un rechazo del proveedor, no un fallo incierto: se informa como tal para que no
      // quede como «por verificar» algo que el proveedor ya descartó.
      if (error instanceof IntegrationRequestRejectedException) {
        throw new PointsCancellationRejectedError(
          String(error.statusCode),
          error.providerDetail ?? 'Puntos Colombia rechazó la anulación.',
        );
      }
      throw error;
    }
    if (!isRecord(payload)) throw invalidIntegrationResponse('Puntos Colombia');
    if (typeof payload.resultCode === 'string' && payload.resultCode) {
      const code = payload.resultCode.trim();
      if (cancellationSuccessCodes.has(code.toUpperCase())) return;
      const message =
        typeof payload.resultMsg === 'string' && payload.resultMsg
          ? payload.resultMsg
          : typeof payload.message === 'string' && payload.message
            ? payload.message
            : 'Puntos Colombia rechazó la anulación.';
      throw new PointsCancellationRejectedError(code, message);
    }
  }
}
