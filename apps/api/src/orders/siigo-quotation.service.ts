import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { SiigoService } from '../integrations/siigo/siigo.service.js';
import { ExchangeRateService } from '../integrations/trm/trm.service.js';
import { IntegrationLogsService } from '../integration-logs/integration-logs.service.js';
import { buildQuotation } from './siigo-quotation-input.js';
import { OrderEventsRepository } from './order-events.repository.js';
import { OrdersRepository, type QuotationOperation } from './orders.repository.js';

class SiigoQuotationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function safeMessage(error: unknown): string {
  if (error instanceof SiigoQuotationError) return error.message;
  if (error instanceof HttpException) {
    const response: unknown = error.getResponse();
    if (typeof response === 'object' && response !== null && 'error' in response) {
      const detail = (response as { error?: unknown }).error;
      if (typeof detail === 'object' && detail !== null && 'message' in detail) {
        const message = (detail as { message?: unknown }).message;
        if (typeof message === 'string' && message.length <= 500) return message;
      }
    }
  }
  return 'Siigo no pudo crear la cotización.';
}

function errorCode(error: unknown): string {
  return error instanceof SiigoQuotationError ? error.code : 'SIIGO_QUOTATION_CREATE_FAILED';
}

@Injectable()
export class SiigoQuotationService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly siigo: SiigoService,
    private readonly exchangeRate: ExchangeRateService,
    private readonly logs: IntegrationLogsService,
    private readonly events: OrderEventsRepository,
  ) {}

  /** Vista previa: no toca Siigo, solo arma lo que se enviaría y señala lo que lo impide. */
  async preview(operationId: number, userId: string) {
    const [operation, seller, lastQuoted] = await Promise.all([
      this.orders.quotationOperation(operationId),
      this.orders.quotationSeller(userId),
      this.events.latestQuoted(operationId),
    ]);
    if (!operation) throw new NotFoundException('La operación no existe.');
    const rate = await this.exchangeRateFor(operation);
    const draft = buildQuotation(operation, {
      seller: seller ?? { id: null, name: '', email: '' },
      exchangeRate: rate?.value ?? null,
      exchangeRateDate: rate?.validFrom ?? null,
    });
    const quotation = operation.siigoQuotation;
    // Quién sincronizó sale de la traza, no de `quotation.syncedAt`: la fecha sola no dice a quién
    // preguntarle, y en un fallo no hay `synced_at` pero sí el intento con su autor.
    const lastSync = lastQuoted
      ? {
          name: lastQuoted.user?.name ?? lastQuoted.userName,
          at: lastQuoted.createdAt.toISOString(),
        }
      : quotation?.syncedAt
        ? { name: null, at: quotation.syncedAt.toISOString() }
        : null;
    return {
      ...draft.preview,
      // Un pedido importado de la tienda no lo creó un comercial: el panel lo muestra como Sistema
      // en vez de atribuírselo a quien abrió la vista previa.
      source: operation.source,
      lastSync,
      quotation: quotation
        ? {
            status: quotation.status,
            number: quotation.number,
            name: quotation.name,
            url: quotation.url,
            syncedAt: quotation.syncedAt,
            errorCode: quotation.errorCode,
            errorMessage: quotation.errorMessage,
          }
        : null,
    };
  }

  async synchronize(quotationId: number, userId: string): Promise<void> {
    const job = await this.orders.siigoQuotationJob(quotationId);
    if (!job) return;
    try {
      const seller = await this.orders.quotationSeller(userId);
      if (!seller) throw new SiigoQuotationError('SIIGO_USER_NOT_FOUND', 'El usuario no existe.');
      const rate = await this.exchangeRateFor(job.operation);
      const draft = buildQuotation(job.operation, {
        seller,
        exchangeRate: rate?.value ?? null,
        exchangeRateDate: rate?.validFrom ?? null,
      });
      const issue = draft.preview.issues[0];
      if (issue || !draft.input) {
        throw new SiigoQuotationError(
          issue?.code ?? 'SIIGO_QUOTATION_INVALID',
          issue?.message ?? 'La operación no está lista para cotizar.',
        );
      }
      const result = await this.siigo.createQuotation(draft.input);
      const confirmed = await this.orders.markSiigoQuotationSynced(job.id, {
        ...result,
        // Se guarda la tasa que efectivamente viajó: Siigo la devuelve en dólares, pero no en pesos.
        exchangeRate: result.exchangeRate ?? draft.input.exchangeRate ?? null,
      });
      await this.logs.record({
        integration: 'SIIGO',
        operation: 'quotation.create',
        outcome: 'SUCCESS',
        code: 'SIIGO_QUOTATION_CREATED',
        message: `Cotización ${result.name} creada para ${job.operation.operationCode}.`,
        requestBody: draft.input,
        responseBody: result,
        referenceType: 'ORDER_OPERATION',
        referenceId: job.operation.id,
        userId,
      });
      if (confirmed.count !== 1) {
        await this.orders.markSiigoQuotationError(
          job.id,
          'SIIGO_QUOTATION_CONFIRMATION_FAILED',
          'Siigo creó la cotización, pero el CRM no pudo guardar su identificador.',
        );
      }
    } catch (error) {
      const code = errorCode(error);
      const message = safeMessage(error);
      await this.orders.markSiigoQuotationError(job.id, code, message);
      // La cotización fallida es el caso que más se investiga: queda con su código y la operación
      // a la que pertenece para poder cruzarla con las llamadas HTTP del mismo intento.
      await this.logs.record({
        integration: 'SIIGO',
        operation: 'quotation.create',
        outcome: 'ERROR',
        code,
        message,
        referenceType: 'ORDER_OPERATION',
        referenceId: job.operation.id,
        userId,
      });
    }
  }

  /**
   * La TRM solo hace falta en dólares y Siigo la exige en el documento. Si la fuente no responde,
   * la cotización queda marcada con ese error en lugar de enviarse con una tasa inventada.
   */
  private async exchangeRateFor(operation: QuotationOperation) {
    if (operation.currency !== 'USD') return null;
    try {
      return await this.exchangeRate.current();
    } catch {
      throw new SiigoQuotationError(
        'EXCHANGE_RATE_UNAVAILABLE',
        'No fue posible consultar la TRM del día.',
      );
    }
  }
}
