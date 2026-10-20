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
export function commentStamp(createdAt: string, authorName: string | null): string {
  return `${dateOnly(createdAt)} · ${authorName ?? 'Usuario eliminado'}`;
}
