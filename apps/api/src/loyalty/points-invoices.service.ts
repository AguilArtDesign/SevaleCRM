import {
  BadGatewayException,
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GatewayTimeoutException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import type {
  PointsAccountLookupInput,
  PointsAccrualInput,
  PointsInvoiceListQuery,
  PointsInvoiceSearchInput,
} from '@sevale/validation';
import { SiigoService, type SiigoInvoice } from '../integrations/siigo/siigo.service.js';
import {
  IntegrationAuthenticationException,
  IntegrationResourceMissingException,
} from '../integrations/integration-http.js';
import {
  PointsAccountNotFoundError,
  PointsCancellationRejectedError,
  PuntosColombiaService,
  puntoColombiaDate,
  type PointsBalance,
  type TransactionIdentifier,
} from '../integrations/puntos-colombia/puntos-colombia.service.js';
import { puntosColombiaConfig } from '../integrations/puntos-colombia/puntos-colombia-config.js';
import { IntegrationLogsService } from '../integration-logs/integration-logs.service.js';
import {
  PointsInvoicesRepository,
  type PointsInvoiceWithAccrual,
} from './points-invoices.repository.js';

/** Regla fija acordada: cada $1.000 de la factura valen un punto, redondeando hacia abajo. */
export function pointsForTotal(total: Prisma.Decimal | number): number {
  const amount = total instanceof Prisma.Decimal ? total : new Prisma.Decimal(total);
  return amount.dividedBy(1000).floor().toNumber();
}

export type SessionUser = { id: string; role: string };

function businessError(
  type: typeof BadRequestException,
  code: string,
  message: string,
): BadRequestException {
  return new type({ success: false, error: { code, message } });
}

/**
 * Un error ambiguo deja la acumulación abierta; uno definitivo permite reintentar. Un
 * `POS_DUPLICATE_TRANSACTION` entra aquí: el proveedor ya conoce ese identificador, así que pudo
 * haber acreditado. Sin correlacionar no es ni un fallo definitivo ni un éxito, y reintentar con
 * otro identificador arriesga una segunda acumulación.
 */
function isAmbiguous(error: unknown): boolean {
  if (error instanceof Error && error.message.includes('POS_DUPLICATE_TRANSACTION')) return true;
  return (
    error instanceof GatewayTimeoutException ||
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

/**
 * Código con el que el panel decide qué hacer. Un error de transporte trae su propio código
 * genérico (`INTEGRATION_REQUEST_FAILED`), que no distingue un fallo definitivo de uno ambiguo, así
 * que solo se respeta un código propio del módulo.
 */
function errorCode(error: unknown, fallback: string): string {
  if (typeof error === 'object' && error !== null && 'getResponse' in error) {
    const response = (error as { getResponse: () => unknown }).getResponse();
    if (
      typeof response === 'object' &&
      response !== null &&
      'error' in response &&
      typeof (response as { error?: { code?: unknown } }).error?.code === 'string'
    ) {
      const code = (response as { error: { code: string } }).error.code;
      if (code.startsWith('POINTS_')) return code;
    }
  }
  return fallback;
}

function serializeInvoice(invoice: PointsInvoiceWithAccrual, sellerName: string | null = null) {
  const [accrual] = invoice.accruals;
  return {
    id: invoice.id,
    source: invoice.source,
    siigoInvoiceId: invoice.siigoInvoiceId,
    name: invoice.name,
    invoiceDate: invoice.invoiceDate.toISOString().slice(0, 10),
    sellerId: invoice.sellerId,
    sellerName,
    customerIdentification: invoice.customerIdentification,
    customerDocumentType: invoice.customerDocumentType,
    total: invoice.total.toFixed(2),
    itemCount: invoice.itemCount,
    points: invoice.points,
    status: invoice.status,
    completedAt: invoice.completedAt,
    createdBy: invoice.createdBy,
    createdAt: invoice.createdAt,
    accrual: accrual
      ? {
          ...accrual,
          balanceValueInMoney: accrual.balanceValueInMoney?.toFixed(2) ?? null,
        }
      : null,
  };
}

function serializeBalance(balance: PointsBalance) {
  return {
    name: balance.name,
    pointsAmount: balance.pointsAmount,
    pointsValueInMoney: balance.pointsValueInMoney,
    allowAccrual: balance.allowAccrual,
  };
}

@Injectable()
export class PointsInvoicesService {
  private readonly logger = new Logger(PointsInvoicesService.name);

  constructor(
    private readonly invoices: PointsInvoicesRepository,
    private readonly siigo: SiigoService,
    private readonly puntos: PuntosColombiaService,
    private readonly logs: IntegrationLogsService,
  ) {}

  async list(query: PointsInvoiceListQuery) {
    const [rows, total] = await this.invoices.list(query);
    const names = await this.sellerNames(rows.map((row) => row.sellerId));
    return {
      data: rows.map((row) =>
        serializeInvoice(row, row.sellerId === null ? null : (names.get(row.sellerId) ?? null)),
      ),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async detail(id: number) {
    const invoice = await this.invoices.detail(id);
    if (!invoice) throw new NotFoundException('La factura no existe en el panel.');
    const names = await this.sellerNames([invoice.sellerId]);
    return serializeInvoice(
      invoice,
      invoice.sellerId === null ? null : (names.get(invoice.sellerId) ?? null),
    );
  }

  /**
   * Nombre del vendedor para la tabla. Primero se busca entre los usuarios del CRM, que es la
   * fuente natural; si el `sellerId` de la factura no corresponde a ninguno (vendedores históricos
   * o cuentas de Siigo que nunca se dieron de alta aquí), se consulta Siigo para no mostrar el
   * número suelto. Un fallo de Siigo no rompe el listado: la columna cae al número.
   */
  private async sellerNames(ids: (number | null)[]) {
    const distinct = [...new Set(ids.filter((id): id is number => id !== null))];
    const rows = await this.invoices.sellerNames(distinct);
    const names = new Map<number, string>();
    for (const row of rows) {
      if (row.sellerId !== null) names.set(row.sellerId, row.name);
    }
    await Promise.all(
      distinct
        .filter((id) => !names.has(id))
        .map(async (id) => {
          try {
            const name = await this.siigo.sellerName(id);
            if (name) names.set(id, name);
          } catch {
            // Sin nombre el panel muestra `Siigo #id`, que sigue siendo identificable.
          }
        }),
    );
    return names;
  }

  /** Prefijos disponibles para el buscador del administrador. */
  async prefixOptions() {
    const users = await this.invoices.invoicePrefixes();
    return users
      .filter((user) => user.siigoInvoicePrefix)
      .map((user) => ({
        prefix: user.siigoInvoicePrefix as string,
        sellerId: user.sellerId,
        userName: user.name,
      }));
  }

  /**
   * Consulta la factura en Siigo y devuelve la vista previa, sin guardarla. El prefijo lo pone el
   * backend: el navegador solo manda el número, así que no puede pedir la factura de otro seller.
   */
  async search(input: PointsInvoiceSearchInput, user: SessionUser) {
    const { prefix, sellerId } = await this.resolvePrefix(user, input.sellerId);
    const name = `${prefix}${input.number}`;
    const invoice = await this.siigo.findInvoiceByName(name);
    if (!invoice) {
      throw businessError(
        NotFoundException,
        'POINTS_INVOICE_NOT_FOUND',
        `No encontramos la factura ${name} en Siigo.`,
      );
    }
    // La pertenencia se comprueba contra el seller que devuelve Siigo, no contra el prefijo: varios
    // sellers comparten prefijo y compartirlo no da acceso a sus facturas.
    if (user.role !== 'ADMIN' && sellerId !== invoice.sellerId) {
      throw businessError(
        ForbiddenException,
        'POINTS_INVOICE_NOT_OWNED',
        'La factura pertenece a otro vendedor.',
      );
    }
    const existing = await this.invoices.bySiigoId(invoice.id);
    return {
      invoice: {
        id: invoice.id,
        name: invoice.name,
        date: invoice.date,
        sellerId: invoice.sellerId,
        total: invoice.total.toFixed(2),
        customerIdentification: invoice.customerIdentification,
        itemCount: invoice.itemCount,
        points: pointsForTotal(invoice.total),
      },
      /** Ya registrada: el panel ofrece abrir su fila en lugar de duplicarla. */
      existingId: existing?.id ?? null,
    };
  }

  /** Registra la factura ya validada. Se vuelve a consultar Siigo: el navegador no es la fuente. */
  async register(input: PointsInvoiceSearchInput, user: SessionUser) {
    const { prefix, sellerId } = await this.resolvePrefix(user, input.sellerId);
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
    const existing = await this.invoices.bySiigoId(invoice.id);
    if (existing) return this.detail(existing.id);

    const points = pointsForTotal(invoice.total);
    if (points <= 0) {
      throw businessError(
        BadRequestException,
        'POINTS_INVOICE_TOO_SMALL',
        'La factura no alcanza el mínimo de $1.000 para generar puntos.',
      );
    }
    const created = await this.invoices.create({
      source: 'SIIGO',
      siigoInvoiceId: invoice.id,
      name: invoice.name,
      invoiceDate: new Date(`${invoice.date}T00:00:00.000Z`),
      sellerId: invoice.sellerId,
      customerIdentification: invoice.customerIdentification,
      total: new Prisma.Decimal(invoice.total.toFixed(2)),
      itemCount: invoice.itemCount,
      points,
      status: 'PENDING',
      createdByUserId: user.id,
    });
    return this.detail(created.id);
  }

  /** Consulta de cuenta: valida en Puntos Colombia si el cliente puede acumular. */
  async lookupAccount(input: PointsAccountLookupInput) {
    try {
      const balance = await this.puntos.lookupAccount(input.documentNumber, input.documentType);
      return { found: true as const, balance: serializeBalance(balance) };
    } catch (error) {
      if (error instanceof PointsAccountNotFoundError) return { found: false as const };
      throw error;
    }
  }

  /**
   * Acumula los puntos de una factura. Todo lo que viaja al proveedor sale de la factura guardada y
   * de la configuración, nunca del navegador: el único dato del operador son el documento y su tipo.
   */
  async accrue(id: number, input: PointsAccrualInput, user: SessionUser) {
    const invoice = await this.invoices.detail(id);
    if (!invoice) throw new NotFoundException('La factura no existe en el panel.');
    if (invoice.source === 'SIIGO' && user.role !== 'ADMIN') {
      const own = await this.ownPrefix(user.id);
      if (!own?.sellerId || invoice.sellerId !== own.sellerId) {
        throw businessError(
          ForbiddenException,
          'POINTS_INVOICE_NOT_OWNED',
          'La factura pertenece a otro vendedor.',
        );
      }
    }

    // Se revalida la cuenta antes de acumular: el estado del botón no es una garantía.
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
    if (!balance.allowAccrual) {
      throw businessError(
        BadRequestException,
        'POINTS_ACCOUNT_NOT_ENABLED',
        'La cuenta existe, pero no está habilitada para acumular puntos.',
      );
    }

    // El identificador se genera y se guarda antes del envío: si el resultado es incierto, no se
    // puede regenerar, porque es lo que le permite conciliar la operación.
    const transactionIdentifier: TransactionIdentifier = {
      terminalId: this.terminalId(),
      transactionId: invoice.name,
      cashierId: this.cashierId(),
      locationCode: this.locationCode(),
      transactionDate: puntoColombiaDate(),
      nut: invoice.name,
    };

    const claim = await this.invoices.claim(id, user.id, {
      documentNumber: input.documentNumber,
      documentType: input.documentType,
      transactionIdentifier: transactionIdentifier,
    });
    if (claim.outcome === 'NOT_FOUND')
      throw new NotFoundException('La factura no existe en el panel.');
    if (claim.outcome === 'ALREADY_COMPLETED') {
      throw businessError(
        ConflictException,
        'POINTS_INVOICE_ALREADY_ACCRUED',
        'Esta factura ya acumuló sus puntos.',
      );
    }
    if (claim.outcome === 'IN_PROGRESS') {
      throw businessError(
        ConflictException,
        'POINTS_ACCRUAL_IN_PROGRESS',
        'La acumulación de esta factura está en curso.',
      );
    }
    if (claim.outcome === 'UNVERIFIED') {
      throw businessError(
        ConflictException,
        'POINTS_ACCRUAL_UNVERIFIED',
        'La acumulación anterior quedó por verificar. Concíliala antes de reintentar.',
      );
    }

    try {
      const result = await this.puntos.processSale(
        input.documentNumber,
        input.documentType,
        transactionIdentifier,
        claim.points,
      );
      await this.invoices.markCompleted(id, claim.accrualId, result);
      // El saldo en pesos se consulta aparte: si falla, la acumulación sigue siendo un éxito.
      const valueInMoney = await this.puntos
        .lookupAccount(input.documentNumber, input.documentType)
        .then((updated) => updated.pointsValueInMoney)
        .catch(() => null);
      if (valueInMoney !== null) {
        await this.invoices.recordBalanceValue(claim.accrualId, valueInMoney);
      }
      await this.logs.record({
        integration: 'PUNTOS_COLOMBIA',
        operation: 'accrual.processsale',
        outcome: 'SUCCESS',
        code: 'POINTS_ACCRUED',
        message: `Factura ${invoice.name}: ${result.pointsEarned} puntos acreditados.`,
        responseBody: result,
        referenceType: 'POINTS_INVOICE',
        referenceId: id,
        userId: user.id,
      });
      return this.detail(id).then((updated) => ({
        invoice: updated,
        pointsEarned: result.pointsEarned,
        pointsBalance: result.pointsBalance,
        balanceValueInMoney: valueInMoney,
      }));
    } catch (error) {
      const unverified = isAmbiguous(error);
      const code = errorCode(
        error,
        unverified ? 'POINTS_ACCRUAL_UNVERIFIED' : 'POINTS_ACCRUAL_FAILED',
      );
      const message = safeMessage(error, 'Puntos Colombia no pudo procesar la acumulación.');
      await this.invoices.markFailed(id, claim.accrualId, code, message, unverified);
      this.logger.warn(`Acumulación de ${invoice.name} falló (${code}).`);
      throw new BadGatewayException({
        success: false,
        error: { code, message },
      });
    }
  }

  /**
   * Anula los puntos ya acreditados de una factura. Necesita dos identificadores: el original, que
   * quedó guardado cuando se acumuló, y uno nuevo para la anulación. El nuevo se genera y se guarda
   * antes del envío, igual que en la acumulación, para que un resultado incierto siga siendo
   * conciliable.
   */
  async revoke(id: number, user: SessionUser) {
    const invoice = await this.invoices.detail(id);
    if (!invoice) throw new NotFoundException('La factura no existe en el panel.');
    if (invoice.source === 'SIIGO' && user.role !== 'ADMIN') {
      const own = await this.ownPrefix(user.id);
      if (!own?.sellerId || invoice.sellerId !== own.sellerId) {
        throw businessError(
          ForbiddenException,
          'POINTS_INVOICE_NOT_OWNED',
          'La factura pertenece a otro vendedor.',
        );
      }
    }
    const accrual = invoice.accruals[0];
    if (!accrual) {
      throw businessError(
        ConflictException,
        'POINTS_INVOICE_NOT_ACCRUED',
        'Solo se pueden revocar los puntos de una factura ya acumulada.',
      );
    }

    // El identificador original se reutiliza tal cual: es el que el proveedor reconoce.
    const original = accrual.transactionIdentifier as unknown as TransactionIdentifier;
    const cancellation: TransactionIdentifier = {
      terminalId: this.terminalId(),
      transactionId: invoice.name,
      cashierId: this.cashierId(),
      locationCode: this.locationCode(),
      transactionDate: puntoColombiaDate(),
      nut: invoice.name,
    };

    const claim = await this.invoices.claimRevocation(id, user.id, { ...cancellation });
    if (claim.outcome === 'NOT_FOUND')
      throw new NotFoundException('La factura no existe en el panel.');
    if (claim.outcome === 'NOT_ACCRUED') {
      throw businessError(
        ConflictException,
        'POINTS_INVOICE_NOT_ACCRUED',
        'Solo se pueden revocar los puntos de una factura ya acumulada.',
      );
    }
    if (claim.outcome === 'ALREADY_REVOKED') {
      throw businessError(
        ConflictException,
        'POINTS_INVOICE_ALREADY_REVOKED',
        'Los puntos de esta factura ya se revocaron.',
      );
    }
    if (claim.outcome === 'IN_PROGRESS') {
      throw businessError(
        ConflictException,
        'POINTS_REVOCATION_IN_PROGRESS',
        'La revocación de esta factura está en curso.',
      );
    }
    if (claim.outcome === 'UNVERIFIED') {
      throw businessError(
        ConflictException,
        'POINTS_REVOCATION_UNVERIFIED',
        'La revocación anterior quedó por verificar. Concíliala antes de reintentar.',
      );
    }

    try {
      await this.puntos.cancelTransaction(original, cancellation);
      await this.invoices.markRevoked(id, claim.accrualId);
      await this.logs.record({
        integration: 'PUNTOS_COLOMBIA',
        operation: 'accrual.cancel',
        outcome: 'SUCCESS',
        code: 'POINTS_REVOKED',
        message: `Factura ${invoice.name}: se revocaron ${accrual.pointsEarned ?? accrual.pointsRequested} puntos.`,
        responseBody: { original, cancellation },
        referenceType: 'POINTS_INVOICE',
        referenceId: id,
        userId: user.id,
      });
      return this.detail(id);
    } catch (error) {
      // Un rechazo del proveedor es definitivo: reintentar con los mismos datos daría lo mismo. Un
      // 404 de la anulación también lo es: la operación original no existe en el proveedor.
      const rejected =
        error instanceof PointsCancellationRejectedError ||
        error instanceof IntegrationResourceMissingException;
      const unverified =
        !rejected && !(error instanceof IntegrationAuthenticationException) && isAmbiguous(error);
      const code = rejected
        ? 'POINTS_REVOCATION_REJECTED'
        : unverified
          ? 'POINTS_REVOCATION_UNVERIFIED'
          : 'POINTS_REVOCATION_FAILED';
      const message = safeMessage(error, 'Puntos Colombia no pudo anular la acumulación.');
      await this.invoices.markRevocationFailed(id, claim.accrualId, code, message, unverified);
      this.logger.warn(`Revocación de ${invoice.name} falló (${code}).`);
      throw new BadGatewayException({
        success: false,
        error: { code, message },
      });
    }
  }

  /** El prefijo sale del usuario; el administrador lo elige entre los configurados. */ private async resolvePrefix(
    user: SessionUser,
    requestedSellerId?: number,
  ): Promise<{ prefix: string; sellerId: number | null }> {
    if (user.role === 'ADMIN' && requestedSellerId) {
      const owner = await this.invoices
        .invoicePrefixes()
        .then((rows) => rows.find((row) => row.sellerId === requestedSellerId));
      if (!owner?.siigoInvoicePrefix) {
        throw businessError(
          BadRequestException,
          'POINTS_PREFIX_NOT_CONFIGURED',
          'Ese vendedor no tiene un prefijo de factura configurado.',
        );
      }
      return { prefix: owner.siigoInvoicePrefix, sellerId: owner.sellerId };
    }
    const own = await this.ownPrefix(user.id);
    if (!own?.siigoInvoicePrefix) {
      throw businessError(
        BadRequestException,
        'POINTS_PREFIX_NOT_CONFIGURED',
        'Tu usuario no tiene un prefijo de factura configurado. Pídeselo a un administrador.',
      );
    }
    return { prefix: own.siigoInvoicePrefix, sellerId: own.sellerId };
  }

  /** El prefijo y el seller del usuario que opera. El prefijo no es único; el seller sí. */
  private ownPrefix(userId: string) {
    return this.invoices
      .invoicePrefixes()
      .then((rows) => rows.find((row) => row.id === userId) ?? null);
  }

  private terminalId() {
    return puntosColombiaConfig().terminalId;
  }

  private cashierId() {
    return puntosColombiaConfig().cashierId;
  }

  private locationCode() {
    return puntosColombiaConfig().locationCode;
  }
}

export type { SiigoInvoice };
