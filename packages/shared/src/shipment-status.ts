/**
 * Estados por los que pasa un envío. Antes era texto libre, así que la base guarda lo que cada uno
 * escribió («En camino», «en camino», «EN CAMINO»). El catálogo llega para que el panel de Envíos
 * pueda filtrar y contar; lo que ya está guardado se sigue mostrando tal cual, sin migración.
 */
export const shipmentStatuses = [
  'PREPARING',
  'DISPATCHED',
  'IN_TRANSIT',
  'DELIVERED',
  'ISSUE',
  'RETURNED',
] as const;

export type ShipmentStatusCode = (typeof shipmentStatuses)[number];

type ShipmentStatusMeta = {
  code: ShipmentStatusCode;
  label: string;
  color: 'default' | 'accent' | 'success' | 'warning' | 'danger';
};

export const shipmentStatusCatalog: readonly ShipmentStatusMeta[] = [
  { code: 'PREPARING', label: 'Preparando', color: 'default' },
  { code: 'DISPATCHED', label: 'Despachado', color: 'accent' },
  { code: 'IN_TRANSIT', label: 'En tránsito', color: 'accent' },
  { code: 'DELIVERED', label: 'Entregado', color: 'success' },
  { code: 'ISSUE', label: 'Novedad', color: 'warning' },
  { code: 'RETURNED', label: 'Devuelto', color: 'danger' },
];

/**
 * Traduce lo guardado al catálogo. Un valor que no está —texto libre de antes— se muestra tal cual
 * y en gris: inventarle una traducción sería mentir sobre lo que escribió logística.
 */
export function resolveShipmentStatus(value: string | null | undefined): {
  label: string;
  color: ShipmentStatusMeta['color'];
} {
  const code = value?.trim().toUpperCase() ?? '';
  const match = shipmentStatusCatalog.find((entry) => entry.code === code);
  if (match) return { label: match.label, color: match.color };
  return { label: value?.trim() || 'Sin estado', color: 'default' };
}

export function isShipmentStatusCode(value: string): value is ShipmentStatusCode {
  return shipmentStatusCatalog.some((entry) => entry.code === value);
}
