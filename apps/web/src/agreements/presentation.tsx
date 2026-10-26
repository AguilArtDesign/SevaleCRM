import type { AgreementTaskStatus } from './api';

/** Estado del convenio en la tabla. Un convenio inactivo sigue existiendo: se puede reactivar. */
export function AgreementStatusChip({ active }: { active: boolean }) {
  return (
    <span className={active ? 'agreement-status agreement-status--active' : 'agreement-status'}>
      {active ? 'Activo' : 'Inactivo'}
    </span>
  );
}

export const taskStatusMeta: Record<
  AgreementTaskStatus,
  { label: string; color: 'default' | 'success' | 'warning' | 'accent' }
> = {
  PENDING: { label: 'Pendiente', color: 'warning' },
  COMPLETED: { label: 'Completada', color: 'success' },
  CANCELLED: { label: 'Cancelada', color: 'default' },
};

const dateTimeFormatter = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

const dateOnlyFormatter = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' });

export function dateTime(value: string | null): string {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '--' : dateTimeFormatter.format(date);
}

export function dateOnly(value: string | null): string {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '--' : dateOnlyFormatter.format(date);
}

/** Fecha y hora de una tarea; el programado es lo que el comercial usa para priorizar. */
export function scheduledLabel(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  return dateTimeFormatter.format(date);
}

/**
 * Días que le quedan al convenio, contados por día de calendario y no por horas. El día de la
 * vigencia todavía cuenta como un día; al día siguiente quedan 0 y el convenio está vencido.
 */
export function validityDays(validUntil: string | null, today = new Date()): number | null {
  if (!validUntil) return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(validUntil);
  if (!match) return null;
  const end = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  if (Number.isNaN(end.getTime())) return null;
  const start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
  return Math.round((end.getTime() - start.getTime()) / 86_400_000);
}

/** «325 días», «1 día» o «Vencido»: un 0 no se muestra como número porque ya no hay vigencia. */
export function validityLabel(
  validUntil: string | null,
  today = new Date(),
): { label: string; expired: boolean } {
  const days = validityDays(validUntil, today);
  if (days === null) return { label: '--', expired: false };
  if (days <= 0) return { label: 'Vencido', expired: true };
  return { label: days === 1 ? '1 día' : `${days} días`, expired: false };
}

/** «Hoy», «Mañana» o la fecha: una tarea atrasada se reconoce de un vistazo. */
export function scheduledHint(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  const today = new Date();
  const days = Math.round(
    (new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime() -
      new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime()) /
      86_400_000,
  );
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Mañana';
  if (days === -1) return 'Ayer';
  if (days < 0) return `Hace ${Math.abs(days)} días`;
  if (days < 7) return `En ${days} días`;
  return '';
}

/** La dirección en una sola línea, omitiendo los huecos, como en la ficha del cliente. */
export function formatAddress(agreement: {
  addressLine1: string | null;
  addressLine2: string | null;
  cityName: string | null;
  regionName: string | null;
  postalCode: string | null;
}): string {
  return (
    [
      agreement.addressLine1,
      agreement.addressLine2,
      agreement.cityName,
      agreement.regionName,
      agreement.postalCode,
    ]
      .filter(Boolean)
      .join(', ') || '--'
  );
}

export function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'No pudimos completar la solicitud.';
}

/** Cuándo se escribió el comentario, con el autor tal como lo muestra la ficha. */
const chatDayFormatter = new Intl.DateTimeFormat('es-CO', {
  day: 'numeric',
  month: 'short',
  year: 'numeric',
});

const chatTimeFormatter = new Intl.DateTimeFormat('es-CO', {
  hour: '2-digit',
  minute: '2-digit',
});

/** Día del mensaje en el seguimiento; «Hoy» y «Ayer» se reconocen de un vistazo. */
export function chatDay(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '--';
  const today = new Date();
  const days = Math.round(
    (new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime() -
      new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime()) /
      86_400_000,
  );
  if (days === 0) return 'Hoy';
  if (days === 1) return 'Ayer';
  return chatDayFormatter.format(date);
}

/** Hora del mensaje, para que la conversación tenga una línea de tiempo real. */
export function chatTime(value: string): string {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '' : chatTimeFormatter.format(date);
}
