import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { amountForRedemptionPoints, pointsRedemptionMinimum } from '@sevale/shared';
import type {
  PointsAccountLookupInput,
  PointsRedemptionInput,
  PointsRedemptionInvoiceInput,
} from '@sevale/validation';
import {
  IntegrationAuthenticationException,
  IntegrationRequestRejectedException,
  IntegrationResourceMissingException,
} from '../integrations/integration-http.js';
import {
  PointsAccountNotFoundError,
  PuntosColombiaService,
  puntoColombiaDate,
  type PointsBalance,
  type PointsRedemptionChallenge,
  type TransactionIdentifier,
} from '../integrations/puntos-colombia/puntos-colombia.service.js';
import { puntosColombiaConfig } from '../integrations/puntos-colombia/puntos-colombia-config.js';
import { SiigoService } from '../integrations/siigo/siigo.service.js';
import { PointsRedemptionsRepository } from './points-redemptions.repository.js';
import { PointsInvoicesService, type SessionUser } from './points-invoices.service.js';
import { serializeRedemption } from './points-redemption-view.js';

function businessError(
  type:
    | typeof BadRequestException
    | typeof ConflictException
    | typeof ForbiddenException
    | typeof NotFoundException,
  code: string,
  message: string,
) {
  return new type({ success: false, error: { code, message } });
}

/**
 * Un error ambiguo deja la redención abierta; uno definitivo permite reintentar. Es la misma
 * distinción que en la acumulación: un rechazo `4xx` no quemó nada, pero un timeout o un `5xx` pudo
 * haber descontado los puntos, y reintentar a ciegas se los quitaría dos veces al cliente.
 */
function isAmbiguous(error: unknown): boolean {
  if (error instanceof IntegrationRequestRejectedException) return false;
  if (error instanceof IntegrationResourceMissingException) return false;
  return (
    error instanceof IntegrationAuthenticationException ||
    (typeof error === 'object' &&
      error !== null &&
      'getStatus' in error &&
      typeof (error as { getStatus: () => number }).getStatus === 'function' &&
      (error as { getStatus: () => number }).getStatus() >= 500)
  );
}

function safeMessage(error: unknown, fallback: string): string {
  if (error instanceof Error && error.message.length <= 300) return error.message;
  return fallback;
}

function serializeBalance(balance: PointsBalance) {
  return {
    name: balance.name,
    pointsAmount: balance.pointsAmount,
    pointsValueInMoney: balance.pointsValueInMoney,
    allowAccrual: balance.allowAccrual,
    allowRedemption: balance.allowRedemption,
  };
}

/**
 * Redención de puntos. Es el camino inverso a la acumulación: primero se quitan los puntos de la
 * cuenta del cliente y la factura de Siigo se asocia después, cuando el comercial la emite en el
 * punto de venta con el medio de pago de Puntos Colombia.
 */
@Injectable()
export class PointsRedemptionsService {
  private readonly logger = new Logger(PointsRedemptionsService.name);

  constructor(
    private readonly redemptions: PointsRedemptionsRepository,
    private readonly puntos: PuntosColombiaService,
    private readonly siigo: SiigoService,
    private readonly invoices: PointsInvoicesService,
  ) {}

  private terminalId(): string {
    return puntosColombiaConfig().terminalId;
  }

  private cashierId(): string {
    return puntosColombiaConfig().cashierId;
  }

  private locationCode(): string {
    return puntosColombiaConfig().locationCode;
  }

  /**
   * Primer paso del modal: consulta la cuenta y devuelve el saldo, para que el comercial sepa de una
   * vez cuántos puntos tiene el cliente antes de acordar la redención.
   */
  async lookup(input: PointsAccountLookupInput) {
    try {
      const balance = await this.puntos.lookupAccount(input.documentNumber, input.documentType);
      return { found: true as const, balance: serializeBalance(balance) };
    } catch (error) {
      if (error instanceof PointsAccountNotFoundError) return { found: false as const };
      throw error;
    }
  }

  /**
   * Pide el código de un solo uso. No crea ninguna fila: la redención todavía no existe y el cliente
   * puede no autorizarla. El código que el proveedor devuelve en la respuesta se descarta: el cliente
   * lo recibe en su celular o su correo, y guardarlo dejaría la autorización sin valor.
   */
  requestChallenge(input: PointsAccountLookupInput): Promise<PointsRedemptionChallenge> {
    return this.puntos
      .requestRedemptionChallenge(input.documentNumber, input.documentType)
      .catch((error) => {
        if (error instanceof PointsAccountNotFoundError) {
          throw businessError(
            BadRequestException,
            'POINTS_ACCOUNT_NOT_FOUND',
            'El cliente no está registrado en Puntos Colombia.',
          );
        }
        throw error;
      });
  }

  /**
   * Quema los puntos. La cuenta se revalida antes de enviar: el saldo que vio el comercial en
   * pantalla pudo cambiar, y es el proveedor el que decide si alcanza.
   */
  async redeem(input: PointsRedemptionInput, user: SessionUser) {
    const balance = await this.puntos
      .lookupAccount(input.documentNumber, input.documentType)
      .catch((error) => {
        if (error instanceof PointsAccountNotFoundError) {
          throw businessError(
            BadRequestException,
            'POINTS_ACCOUNT_NOT_FOUND',
            'El cliente no está registrado en Puntos Colombia.',
          );
        }
        throw error;
      });
    if (!balance.allowRedemption) {
      throw businessError(
        BadRequestException,
        'POINTS_REDEMPTION_NOT_ENABLED',
        'La cuenta existe, pero no está habilitada para redimir puntos.',
      );
    }
    if (balance.pointsAmount < input.points) {
      throw businessError(
        BadRequestException,
        'POINTS_INSUFFICIENT_BALANCE',
        `El cliente tiene ${balance.pointsAmount} puntos y quiere redimir ${input.points}.`,
      );
    }
    // El mínimo lo impone el proveedor: avisar antes evita pedir el código para nada.
    if (input.points < pointsRedemptionMinimum) {
      throw businessError(
        BadRequestException,
        'POINTS_REDEMPTION_BELOW_MINIMUM',
        `El mínimo que se puede redimir son ${pointsRedemptionMinimum} puntos.`,
      );
    }

    // El identificador se arma y se guarda antes del envío: si la respuesta se pierde, es lo que
    // permite conciliar con el proveedor sin inventar otro.
    const now = new Date();
    const stamp = puntoColombiaDate(now).replace(/[-:T]/g, '');
    const transactionIdentifier: TransactionIdentifier = {
      terminalId: this.terminalId(),
      transactionId: stamp,
      cashierId: this.cashierId(),
      locationCode: this.locationCode(),
      transactionDate: puntoColombiaDate(now),
      nut: stamp,
    };

    const attempt = await this.redemptions.create({
      documentNumber: input.documentNumber,
      documentType: input.documentType,
      customerName: balance.name,
      pointsRequested: input.points,
      amountCop: new Prisma.Decimal(amountForRedemptionPoints(input.points)),
      validationMethod: 'OTP',
      transactionIdentifier,
      createdByUserId: user.id,
    });

    try {
      const result = await this.puntos.redeemPoints({
        documentNumber: input.documentNumber,
        documentType: input.documentType,
        pin: input.pin,
        points: input.points,
        transactionIdentifier,
      });
      const applied = await this.redemptions.markApplied(attempt.id, result);
      return serializeRedemption(applied);
    } catch (error) {
      // Un rechazo es definitivo: nada se quemó, así que la fila queda fallida y se puede repetir.
      if (error instanceof PointsAccountNotFoundError) {
        await this.redemptions.markFailed(
          attempt.id,
          'POINTS_ACCOUNT_NOT_FOUND',
          'Cuenta no encontrada.',
        );
        throw businessError(
          BadRequestException,
          'POINTS_ACCOUNT_NOT_FOUND',
          'El cliente no está registrado en Puntos Colombia.',
        );
      }
      if (isAmbiguous(error)) {
        this.logger.warn(`Redención ${attempt.id} quedó por verificar.`);
        await this.redemptions.markUnverified(
          attempt.id,
          'POINTS_REDEMPTION_UNVERIFIED',
          safeMessage(error, 'No se pudo confirmar la redención con Puntos Colombia.'),
        );
        throw new BadGatewayException({
          success: false,
          error: {
            code: 'POINTS_REDEMPTION_UNVERIFIED',
            message:
              'No se pudo confirmar la redención. Consulta el saldo del cliente en Puntos Colombia antes de reintentar.',
          },
        });
      }
      await this.redemptions.markFailed(
        attempt.id,
        'POINTS_REDEMPTION_REJECTED',
        safeMessage(error, 'Puntos Colombia rechazó la redención.'),
      );
      throw businessError(
        BadRequestException,
        'POINTS_REDEMPTION_REJECTED',
        safeMessage(error, 'Puntos Colombia rechazó la redención.'),
      );
    }
  }

  /**
   * Asocia la factura de Siigo que documenta la venta. Es el paso que cierra la redención: hasta que
   * exista, los puntos del cliente están gastados sin un documento que los respalde.
   */
  async attachInvoice(id: number, input: PointsRedemptionInvoiceInput, user: SessionUser) {
    const redemption = await this.redemptions.find(id);
    if (!redemption) {
      throw businessError(
        NotFoundException,
        'POINTS_REDEMPTION_NOT_FOUND',
        'La redención no existe en el panel.',
      );
    }
    if (redemption.status !== 'PENDING_INVOICE') {
      throw businessError(
        ConflictException,
        'POINTS_REDEMPTION_NOT_PENDING',
        'Solo se puede asociar una factura a una redención pendiente de factura.',
      );
    }

    const { prefix, sellerId } = await this.invoices.resolveInvoicePrefix(user, input.sellerId);
    const name = `${prefix}${input.number}`;
    const invoice = await this.siigo.findInvoiceByName(name);
    if (!invoice) {
      throw businessError(
        NotFoundException,
        'POINTS_INVOICE_NOT_FOUND',
        `No encontramos la factura ${name} en Siigo.`,
      );
    }
    if (user.role !== 'ADMIN' && sellerId !== invoice.sellerId) {
      throw businessError(
        ForbiddenException,
        'POINTS_INVOICE_NOT_OWNED',
        'La factura pertenece a otro vendedor.',
      );
    }

    const updated = await this.redemptions.attachInvoice(id, {
      siigoInvoiceId: invoice.id,
      invoiceName: invoice.name,
      invoiceDate: new Date(`${invoice.date}T00:00:00.000Z`),
      invoiceTotal: new Prisma.Decimal(invoice.total.toFixed(2)),
    });
    return serializeRedemption(updated);
  }
}
