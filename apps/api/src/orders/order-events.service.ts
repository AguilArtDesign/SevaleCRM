import { Injectable, Logger } from '@nestjs/common';
import type { OrderActivityQuery } from '@sevale/validation';
import { OrderEventsRepository, type OrderEventChange } from './order-events.repository.js';
import type { OrderOperationDetail } from './orders.repository.js';

/**
 * Campos de la cabecera que se comparan al editar. Los ítems quedan fuera a propósito: el guardado
 * borra y recrea las líneas, así que un diff producto a producto diría que todo cambió cada vez. Lo
 * que interesa es el dinero, la forma de pago, las direcciones y las tiendas de la operación.
 */
const trackedFields = [
  'currency',
  'paymentMethodTitle',
  'shippingMethodTitle',
  'couponCode',
  'subtotal',
  'discountTotal',
  'shippingTotal',
  'total',
  'billingFirstName',
  'billingLastName',
  'billingCompany',
  'billingAddress1',
  'billingAddress2',
  'billingCity',
  'billingState',
  'billingPostcode',
  'billingCountry',
  'billingEmail',
  'billingPhone',
  'shippingFirstName',
  'shippingLastName',
  'shippingCompany',
  'shippingAddress1',
  'shippingAddress2',
  'shippingCity',
  'shippingState',
  'shippingPostcode',
  'shippingCountry',
  'shippingPhone',
] as const;

type TrackedField = (typeof trackedFields)[number];

const moneyFields = new Set<TrackedField>(['subtotal', 'discountTotal', 'shippingTotal', 'total']);

/** Un cambio solo cuenta si el valor guardado es distinto; el orden de un arreglo también cuenta. */
function changed(before: unknown, after: unknown): boolean {
  return JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
}

/** Los importes se comparan como el texto que ve el panel, para no arrastrar ruido de decimales. */
function snapshot(operation: OrderOperationDetail): Record<TrackedField | 'stores', unknown> {
  const fields = {} as Record<TrackedField, unknown>;
  for (const field of trackedFields) {
    const value = operation[field as keyof OrderOperationDetail] as
      { toFixed: (decimals: number) => string } | string | null;
    fields[field] = moneyFields.has(field)
      ? ((value as { toFixed: (decimals: number) => string } | null)?.toFixed(2) ?? '0.00')
      : (value ?? null);
  }
  // Agregar o quitar la tienda de una operación cambia a dónde se envía el pedido: es un cambio de
  // cabecera aunque no se guarden los ítems.
  return { ...fields, stores: operation.orders.map(({ store }) => store).sort() };
}

function diff(before: OrderOperationDetail, after: OrderOperationDetail): OrderEventChange[] {
  const [beforeFields, afterFields] = [snapshot(before), snapshot(after)];
  const fields = [...trackedFields, 'stores'] as const;
  return fields
    .filter((field) => changed(beforeFields[field], afterFields[field]))
    .map((field) => ({
      field,
      from: beforeFields[field] ?? null,
      to: afterFields[field] ?? null,
    }));
}

type EventRow = Awaited<ReturnType<OrderEventsRepository['record']>>;
type EventRowWithUser = Awaited<ReturnType<OrderEventsRepository['list']>>[0][number];

function serializedActor(
  user: { id: string; name: string; email: string } | null,
  userName: string | null,
) {
  // El nombre copiado en la fila sobrevive al borrado de la cuenta; la relación no.
  return user ?? (userName ? { id: '', name: userName, email: '' } : null);
}

function serializeEvent(event: EventRowWithUser | EventRow) {
  const withUser = event as EventRowWithUser;
  const changes = Array.isArray(event.changes) ? (event.changes as OrderEventChange[]) : [];
  return {
    id: event.id,
    operationId: event.operationId,
    action: event.action,
    origin: event.origin,
    actor: serializedActor(withUser.user ?? null, event.userName),
    operationCode: event.operationCode,
    customerName: event.customerName,
    changes,
    provider: event.provider,
    outcome: event.outcome,
    message: event.message,
    createdAt: event.createdAt,
  };
}

type OperationRef = { id: number; operationCode: string; customerName: string | null };

@Injectable()
export class OrderEventsService {
  private readonly logger = new Logger(OrderEventsService.name);

  constructor(private readonly events: OrderEventsRepository) {}

  /**
   * La traza no puede tumbar una operación de negocio: si el registro falla, el pedido ya se creó o
   * se sincronizó y deshacerlo sería peor. Se avisa en el log del servidor y se sigue.
   */
  private async safe(operation: () => Promise<unknown>, context: string) {
    try {
      await operation();
    } catch (error) {
      this.logger.error(
        `No se pudo registrar la traza del pedido (${context}): ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
  }

  recordCreated(
    operation: OperationRef,
    userId: string | null,
    provider: 'SERATUS' | 'PALI' | null = null,
  ) {
    return this.safe(
      () =>
        this.events.record({
          operationId: operation.id,
          action: 'CREATED',
          userId,
          operationCode: operation.operationCode,
          customerName: operation.customerName,
          provider,
          // Un pedido que entra desde la tienda ya existe allá: el evento dice de dónde vino.
          message: provider ? 'Pedido importado desde la tienda.' : null,
        }),
      'alta',
    );
  }

  recordUpdated(before: OrderOperationDetail, after: OrderOperationDetail, userId: string) {
    const changes = diff(before, after);
    // Un guardado sin cambios reales no deja rastro: llenaría la traza de ruido y escondería las
    // ediciones que sí importan.
    if (changes.length === 0) return Promise.resolve();
    return this.safe(
      () =>
        this.events.record({
          operationId: after.id,
          action: 'UPDATED',
          userId,
          operationCode: after.operationCode,
          customerName: after.customer.displayName,
          changes,
        }),
      'edición',
    );
  }

  recordCompleted(operation: OrderOperationDetail, userId: string) {
    return this.safe(
      () =>
        this.events.record({
          operationId: operation.id,
          action: 'COMPLETED',
          userId,
          operationCode: operation.operationCode,
          customerName: operation.customer.displayName,
        }),
      'cierre de la operación',
    );
  }

  recordSynced(
    operation: OrderOperationDetail,
    results: Array<{
      provider: 'SERATUS' | 'PALI';
      status: 'SYNCED' | 'ERROR';
      message?: string | null;
    }>,
    userId: string | null,
  ) {
    // Un evento por tienda: el panel necesita poder decir "Seratus sí, Pali no".
    return Promise.all(
      results.map((result) =>
        this.safe(
          () =>
            this.events.record({
              operationId: operation.id,
              action: 'SYNCED',
              userId,
              operationCode: operation.operationCode,
              customerName: operation.customer.displayName,
              provider: result.provider,
              outcome: result.status,
              message: result.status === 'ERROR' ? (result.message ?? null) : null,
            }),
          `sincronización ${result.provider}`,
        ),
      ),
    );
  }

  recordQuoted(operation: OrderOperationDetail, userId: string) {
    const quotation = operation.siigoQuotation;
    // Sin cotización en la operación no hubo intento que registrar.
    if (!quotation) return Promise.resolve();
    return this.safe(
      () =>
        this.events.record({
          operationId: operation.id,
          action: 'QUOTED',
          userId,
          operationCode: operation.operationCode,
          customerName: operation.customer.displayName,
          provider: 'SIIGO',
          outcome: quotation.status === 'SYNCED' ? 'SYNCED' : 'ERROR',
          message:
            quotation.status === 'SYNCED'
              ? // El nombre completo (`C-1-846`) y no el consecutivo suelto: es como se busca la
                // cotización en Siigo, así que es el dato que sirve en la traza.
                (quotation.name ?? quotation.number ?? null)
              : (quotation.errorMessage ?? null),
        }),
      'cotización Siigo',
    );
  }

  recordDeleted(operation: OrderOperationDetail, userId: string | null) {
    return this.safe(
      () =>
        this.events.record({
          // La operación desaparece: el evento queda suelto y el código es el único rastro.
          operationId: null,
          action: 'DELETED',
          userId,
          operationCode: operation.operationCode,
          customerName: operation.customer.displayName,
          changes: [
            { field: 'total', from: operation.total.toFixed(2), to: null },
            { field: 'status', from: operation.status, to: null },
          ],
        }),
      'borrado',
    );
  }

  async list(operationId: number, query: OrderActivityQuery) {
    const [rows, total] = await this.events.list(operationId, query.page, query.pageSize);
    return {
      data: rows.map(serializeEvent),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }
}
