import { Injectable, Logger } from '@nestjs/common';
import type { CustomerActivityQuery } from '@sevale/validation';
import {
  CustomerEventsRepository,
  type CustomerEventChange,
} from './customer-events.repository.js';
import type { CustomerWithIntegrations } from './customers.repository.js';

/**
 * Campos que se comparan al editar. Se comparan los valores ya guardados, no lo que se escribió: el
 * saneamiento puede cambiar mayúsculas o espacios, y la traza debe reflejar lo que de verdad cambió
 * en la ficha, no lo que el formulario recibió.
 */
const trackedFields = [
  'firstName',
  'lastName',
  'displayName',
  'company',
  'documentType',
  'documentNumber',
  'checkDigit',
  'email',
  'phone',
  'country',
  'region',
  'cityCode',
  'cityName',
  'postalCode',
  'addressLine1',
  'addressLine2',
  'agreementId',
  'vatResponsible',
  'fiscalResponsibilities',
  'active',
] as const;

type TrackedField = (typeof trackedFields)[number];

/** Un cambio solo cuenta si el valor guardado es distinto; el orden de un arreglo también cuenta. */
function changed(before: unknown, after: unknown): boolean {
  return JSON.stringify(before ?? null) !== JSON.stringify(after ?? null);
}

function diff(
  before: CustomerWithIntegrations,
  after: CustomerWithIntegrations,
): CustomerEventChange[] {
  const fieldsOf = (customer: CustomerWithIntegrations) =>
    customer as unknown as Record<TrackedField, unknown>;
  const [beforeFields, afterFields] = [fieldsOf(before), fieldsOf(after)];
  return trackedFields
    .filter((field) => changed(beforeFields[field], afterFields[field]))
    .map((field) => ({
      field,
      from: beforeFields[field] ?? null,
      to: afterFields[field] ?? null,
    }));
}

type EventRow = Awaited<ReturnType<CustomerEventsRepository['record']>>;
type EventRowWithUser = Awaited<ReturnType<CustomerEventsRepository['list']>>[0][number];

function serializedActor(
  user: { id: string; name: string; email: string } | null,
  userName: string | null,
) {
  // El nombre copiado en la fila sobrevive al borrado de la cuenta; la relación no.
  return user ?? (userName ? { id: '', name: userName, email: '' } : null);
}

function serializeEvent(event: EventRowWithUser | EventRow) {
  const withUser = event as EventRowWithUser;
  const changes = Array.isArray(event.changes) ? (event.changes as CustomerEventChange[]) : [];
  return {
    id: event.id,
    customerId: event.customerId,
    action: event.action,
    origin: event.origin,
    actor: serializedActor(withUser.user ?? null, event.userName),
    customerName: event.customerName,
    customerDocument: event.customerDocument,
    changes,
    provider: event.provider,
    outcome: event.outcome,
    message: event.message,
    createdAt: event.createdAt,
  };
}

@Injectable()
export class CustomerEventsService {
  private readonly logger = new Logger(CustomerEventsService.name);

  constructor(private readonly events: CustomerEventsRepository) {}

  /**
   * La traza no puede tumbar una operación de negocio: si el registro falla, el cliente ya se creó o
   * se modificó y deshacerlo sería peor. Se avisa en el log del servidor y se sigue.
   */
  private async safe(operation: () => Promise<unknown>, context: string) {
    try {
      await operation();
    } catch (error) {
      this.logger.error(
        `No se pudo registrar la traza del cliente (${context}): ${
          error instanceof Error ? error.message : 'error desconocido'
        }`,
      );
    }
  }

  recordCreated(
    customer: { id: number; displayName: string; documentNumber: string },
    userId: string | null,
  ) {
    return this.safe(
      () =>
        this.events.record({
          customerId: customer.id,
          action: 'CREATED',
          userId,
          customerName: customer.displayName,
          customerDocument: customer.documentNumber,
        }),
      'alta',
    );
  }

  recordUpdated(before: CustomerWithIntegrations, after: CustomerWithIntegrations, userId: string) {
    const changes = diff(before, after);
    // Un guardado sin cambios reales no deja rastro: llenaría la traza de ruido y escondería las
    // ediciones que sí importan.
    if (changes.length === 0) return Promise.resolve();
    return this.safe(
      () =>
        this.events.record({
          customerId: after.id,
          action: 'UPDATED',
          userId,
          customerName: after.displayName,
          customerDocument: after.documentNumber,
          changes,
        }),
      'edición',
    );
  }

  recordSynced(
    customer: { id: number; displayName: string; documentNumber: string },
    results: Array<{
      provider: 'SIIGO' | 'SERATUS' | 'PALI';
      status: 'SYNCED' | 'ERROR';
      message?: string | null;
    }>,
    userId: string | null,
  ) {
    // Un evento por proveedor: el panel necesita poder decir "Seratus sí, Pali no".
    return Promise.all(
      results.map((result) =>
        this.safe(
          () =>
            this.events.record({
              customerId: customer.id,
              action: 'SYNCED',
              userId,
              customerName: customer.displayName,
              customerDocument: customer.documentNumber,
              provider: result.provider,
              outcome: result.status,
              message: result.status === 'ERROR' ? (result.message ?? null) : null,
            }),
          `sincronización ${result.provider}`,
        ),
      ),
    );
  }

  recordDeleted(
    customer: {
      id: number;
      displayName: string;
      documentNumber: string;
      createdByUserId: string | null;
    },
    userId: string | null,
  ) {
    return this.safe(async () => {
      // Se copia también el autor del alta: al desaparecer el cliente, el evento que lo dice es
      // lo único que queda.
      await this.events.record({
        customerId: null,
        action: 'DELETED',
        userId,
        customerName: customer.displayName,
        customerDocument: customer.documentNumber,
        changes: customer.createdByUserId
          ? [{ field: 'createdByUserId', from: customer.createdByUserId, to: null }]
          : null,
      });
    }, 'borrado');
  }

  async list(customerId: number, query: CustomerActivityQuery) {
    const [rows, total] = await this.events.list(customerId, query.page, query.pageSize);
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
