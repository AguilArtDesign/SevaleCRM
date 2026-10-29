import { HttpException, Injectable, NotFoundException } from '@nestjs/common';
import { SiigoService } from '../integrations/siigo/siigo.service.js';
import { ExchangeRateService, type ExchangeRate } from '../integrations/trm/trm.service.js';
import { IntegrationLogsService } from '../integration-logs/integration-logs.service.js';
import { buildQuotation, quotationFingerprint } from './siigo-quotation-input.js';
import { OrderEventsRepository } from './order-events.repository.js';
import {
  OrdersRepository,
  type QuotationOperation,
  type SiigoQuotationClaim,
} from './orders.repository.js';

class SiigoQuotationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function safeMessage(error: unknown, fallback: string): string {
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
  return fallback;
}

function errorCode(error: unknown, fallback: string): string {
  return error instanceof SiigoQuotationError ? error.code : fallback;
}

/** Lo que dice la traza de integraciones según se haya creado o corregido la cotización. */
function pushLabels(update: boolean) {
  return update
    ? {
        operation: 'quotation.update',
        successCode: 'SIIGO_QUOTATION_UPDATED',
        failureCode: 'SIIGO_QUOTATION_UPDATE_FAILED',
        fallback: 'Siigo no pudo actualizar la cotización.',
        done: 'actualizada',
      }
    : {
        operation: 'quotation.create',
        successCode: 'SIIGO_QUOTATION_CREATED',
        failureCode: 'SIIGO_QUOTATION_CREATE_FAILED',
        fallback: 'Siigo no pudo crear la cotización.',
        done: 'creada',
      };
}

/** Vendedor sin resolver: la huella de la cotización no lo incluye, así que su valor es indiferente. */
const unresolvedSeller = { id: null, name: '', email: '' };

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
    const draft = this.draft(operation, {
      seller: seller ?? unresolvedSeller,
      rate,
    });
    const quotation = operation.siigoQuotation;
    // La cotización quedó con un contenido y el pedido ya tiene otro: los productos, las cantidades
    // o los precios cambiaron, así que Siigo sigue con la versión anterior hasta que se reenvíe.
    const outdated =
      quotation?.status === 'SYNCED' && quotation.quotedFingerprint !== draft.fingerprint;
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
      /** Sincronizada alguna vez, pero con un contenido que ya no corresponde al pedido. */
      quotationOutdated: outdated,
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

  /**
   * Reclama la cotización antes de salir a Siigo. La huella se calcula con el pedido tal como está
   * ahora, así que si ya se había cotizado otro contenido el reclamo vuelve marcado para actualizar
   * la cotización existente en lugar de crear una segunda.
   */
  async claim(operationId: number): Promise<SiigoQuotationClaim> {
    const operation = await this.orders.quotationOperation(operationId);
    if (!operation) return { outcome: 'NOT_FOUND' };
    // La huella ignora la TRM, así que su valor es indiferente para reclamar. Si la fuente falla,
    // la sincronización lo reporta con su propio código en vez de romper aquí el intento.
    const rate = await this.exchangeRateFor(operation).catch(() => null);
    return this.orders.claimSiigoQuotation(
      operationId,
      this.draft(operation, { seller: unresolvedSeller, rate }).fingerprint,
    );
  }

  /**
   * Operaciones de una página cuya cotización en Siigo ya no corresponde al pedido. La acción de la
   * fila usa esto para ofrecer "Actualizar" en vez de "Ver": la cotización existe, pero con los
   * productos y precios anteriores.
   */
  async outdatedQuotations(operationIds: number[]): Promise<Set<number>> {
    if (operationIds.length === 0) return new Set();
    const operations = await this.orders.quotationOperations(operationIds);
    const outdated = new Set<number>();
    for (const operation of operations) {
      const quotation = operation.siigoQuotation;
      // Solo una cotización sincronizada tiene contra qué comparar: con error o a medias todavía
      // queda enviarla, que es otro caso.
      if (quotation?.status !== 'SYNCED') continue;
      if (
        quotation.quotedFingerprint ===
        this.draft(operation, { seller: unresolvedSeller, rate: null }).fingerprint
      )
        continue;
      outdated.add(operation.id);
    }
    return outdated;
  }

  /**
   * Arma lo que se enviaría y la huella de ese contenido. La huella no incluye la TRM ni el
   * vendedor: cambian por razones ajenas al pedido y marcarlo desactualizado sin que nadie lo
   * tocara sería ruido.
   */
  private draft(
    operation: QuotationOperation,
    options: {
      seller: { id: number | null; name: string; email: string };
      rate: ExchangeRate | null;
    },
  ) {
    const draft = buildQuotation(operation, {
      seller: options.seller,
      exchangeRate: options.rate?.value ?? null,
      exchangeRateDate: options.rate?.validFrom ?? null,
    });
    return { ...draft, fingerprint: quotationFingerprint(draft.preview) };
  }

  async synchronize(quotationId: number, userId: string): Promise<void> {
    const job = await this.orders.siigoQuotationJob(quotationId);
    if (!job) return;
    // Ya existe en Siigo: se reenvía el documento completo para que reemplace la lista de ítems.
    const quotation = job.operation.siigoQuotation;
    const externalId = quotation?.externalId ?? null;
    const labels = pushLabels(externalId !== null);
    try {
      const seller = await this.orders.quotationSeller(userId);
      if (!seller) throw new SiigoQuotationError('SIIGO_USER_NOT_FOUND', 'El usuario no existe.');
      const rate = await this.exchangeRateFor(job.operation);
      const draft = this.draft(job.operation, { seller, rate });
      const issue = draft.preview.issues[0];
      if (issue || !draft.input) {
        throw new SiigoQuotationError(
          issue?.code ?? 'SIIGO_QUOTATION_INVALID',
          issue?.message ?? 'La operación no está lista para cotizar.',
        );
      }
      const result = externalId
        ? await this.siigo.updateQuotation(externalId, draft.input, {
            id: externalId,
            number: quotation?.number ?? '',
            name: quotation?.name ?? '',
            publicUrl: quotation?.url ?? null,
          })
        : await this.siigo.createQuotation(draft.input);
      const confirmed = await this.orders.markSiigoQuotationSynced(
        job.id,
        {
          ...result,
          // Se guarda la tasa que efectivamente viajó: Siigo la devuelve en dólares, pero no en pesos.
          exchangeRate: result.exchangeRate ?? draft.input.exchangeRate ?? null,
        },
        draft.fingerprint,
      );
      await this.logs.record({
        integration: 'SIIGO',
        operation: labels.operation,
        outcome: 'SUCCESS',
        code: labels.successCode,
        message: `Cotización ${result.name} ${labels.done} para ${job.operation.operationCode}.`,
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
          `Siigo ${externalId ? 'actualizó' : 'creó'} la cotización, pero el CRM no pudo guardar su identificador.`,
        );
      }
    } catch (error) {
      const code = errorCode(error, labels.failureCode);
      const message = safeMessage(error, labels.fallback);
      await this.orders.markSiigoQuotationError(job.id, code, message);
      // La cotización fallida es el caso que más se investiga: queda con su código y la operación
      // a la que pertenece para poder cruzarla con las llamadas HTTP del mismo intento.
      await this.logs.record({
        integration: 'SIIGO',
        operation: labels.operation,
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
