export type WarehouseCatalogEntry = {
  /** Identificador que usa Siigo en `warehouses[].id`; -1 es «Sin asignar». */
  id: number;
  /** Nombre tal como lo devuelve Siigo. Se conserva para referencia y como respaldo. */
  siigoName: string;
  /** Nombre corto que ven los comerciales en el panel. */
  displayName: string;
  active: boolean;
  hasMovements: boolean;
};

/**
 * Glosario de bodegas del CRM. El panel muestra `displayName`, no el nombre crudo de Siigo:
 * por ejemplo, `185 / SERATUS BOGOTA PORTAL 80` se muestra como «Portal 80».
 *
 * Es la única fuente de los nombres visibles. Si Siigo agrega una bodega que no está aquí, se
 * usa el nombre recibido (o «Bodega {id}» si tampoco vino) para no ocultar el dato.
 */
export const warehouseCatalog: readonly WarehouseCatalogEntry[] = [
  {
    id: -1,
    siigoName: 'Sin asignar',
    displayName: 'Sin asignar',
    active: true,
    hasMovements: true,
  },
  { id: 177, siigoName: 'PALI', displayName: 'Pali', active: true, hasMovements: true },
  { id: 178, siigoName: 'SERATUS', displayName: 'Seratus', active: true, hasMovements: true },
  { id: 179, siigoName: 'MAYORCA', displayName: 'Mayorca', active: false, hasMovements: true },
  { id: 180, siigoName: 'BOGOTA', displayName: 'Bogotá', active: false, hasMovements: true },
  {
    id: 181,
    siigoName: 'PARQUE BERRIO',
    displayName: 'Parque Berrío',
    active: false,
    hasMovements: true,
  },
  { id: 182, siigoName: 'IBAGUE', displayName: 'Ibagué', active: false, hasMovements: true },
  { id: 184, siigoName: 'ARMENIA', displayName: 'Armenia', active: false, hasMovements: true },
  {
    id: 185,
    siigoName: 'SERATUS BOGOTA PORTAL 80',
    displayName: 'Portal 80',
    active: true,
    hasMovements: true,
  },
  {
    id: 188,
    siigoName: 'SERATUS SABANETA MALL VEGAS',
    displayName: 'Sabaneta',
    active: true,
    hasMovements: true,
  },
  {
    id: 193,
    siigoName: 'SERATUS BOGOTA SALITRE PLAZA',
    displayName: 'Salitre Plaza',
    active: true,
    hasMovements: true,
  },
];

const warehouseById = new Map(warehouseCatalog.map((warehouse) => [warehouse.id, warehouse]));

/** Nombre visible para una bodega; usa el nombre recibido solo si el id no está en el glosario. */
export function warehouseDisplayName(id: number, fallbackName?: string | null): string {
  const catalogEntry = warehouseById.get(id);
  if (catalogEntry) return catalogEntry.displayName;
  if (id === -1) return 'Sin asignar';
  const fallback = fallbackName?.trim();
  return fallback || `Bodega ${id}`;
}
