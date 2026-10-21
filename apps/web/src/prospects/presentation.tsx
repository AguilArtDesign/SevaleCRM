import type { ProspectRecord, ProspectSource, ProspectStatus } from './api';

export const prospectStatusMeta: Record<
  ProspectStatus,
  { label: string; color: 'default' | 'success' | 'warning' | 'accent' | 'danger' }
> = {
  NEW: { label: 'Nuevo', color: 'default' },
  IN_PROGRESS: { label: 'En progreso', color: 'accent' },
  QUALIFIED: { label: 'Calificado', color: 'success' },
  CONVERTED: { label: 'Convertido', color: 'success' },
  LOST: { label: 'Perdido', color: 'danger' },
};

export const prospectSourceMeta: Record<ProspectSource, string> = {
  MANUAL: 'Manual',
  WHATSAPP: 'WhatsApp',
  WEB: 'Web',
  REFERRAL: 'Referido',
  OTHER: 'Otro',
};

/**
 * El filtro `all` excluye los convertidos: al pasar a Clientes dejan de ser trabajo comercial. Se
 * etiqueta «En gestión» porque «Todos» prometería incluirlos.
 */
export const prospectStatusFilterOptions: Array<{ id: string; label: string }> = [
  { id: 'all', label: 'En gestión' },
  { id: 'NEW', label: prospectStatusMeta.NEW.label },
  { id: 'IN_PROGRESS', label: prospectStatusMeta.IN_PROGRESS.label },
  { id: 'QUALIFIED', label: prospectStatusMeta.QUALIFIED.label },
  { id: 'LOST', label: prospectStatusMeta.LOST.label },
  { id: 'CONVERTED', label: prospectStatusMeta.CONVERTED.label },
];

const dateOnlyFormatter = new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' });
const dateTimeFormatter = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'medium',
  timeStyle: 'short',
});

export function dateOnly(value: string | null): string {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '--' : dateOnlyFormatter.format(date);
}

export function dateTime(value: string | null): string {
  if (!value) return '--';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? '--' : dateTimeFormatter.format(date);
}

export function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'No pudimos completar la solicitud.';
}

/** Dirección en una línea, omitiendo huecos, como en la ficha del cliente. */
export function formatProspectAddress(prospect: ProspectRecord): string {
  return (
    [
      prospect.addressLine1,
      prospect.addressLine2,
      prospect.location.cityName,
      prospect.location.regionName,
      prospect.location.countryName,
      prospect.postalCode,
    ]
      .filter(Boolean)
      .join(', ') || '--'
  );
}

/** Cómo se nombra cada requisito de conversión que la API reporta como faltante. */
export const completenessLabels: Record<string, string> = {
  personType: 'tipo de persona',
  firstName: 'nombres',
  lastName: 'apellidos',
  company: 'empresa',
  documentType: 'tipo de documento',
  documentNumber: 'número de documento',
  email: 'correo',
  phone: 'teléfono',
  country: 'país',
  region: 'departamento o región',
  cityCode: 'ciudad',
  cityName: 'ciudad',
  addressLine1: 'dirección',
};

export function missingFieldsText(missing: string[]): string {
  return missing.map((field) => completenessLabels[field] ?? field).join(', ');
}
