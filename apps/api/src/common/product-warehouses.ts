import { warehouseDisplayGroupId, warehouseDisplayName } from './warehouse-catalog.js';

export type ProductWarehouseStock = {
  id: number;
  /** Nombre recibido del proveedor para esta bodega; puede venir vacío. */
  name: string;
  quantity: number;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** Tolera números y strings numéricos, como el resto de normalizadores de proveedores. */
function finiteNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === '') return null;
  const number = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(number) ? number : null;
}

/**
 * Normaliza el desglose de bodegas que llega de Siigo, de n8n o del JSON guardado.
 *
 * Devuelve `null` cuando el valor no es una lista reconocible: así un proveedor que deja de
 * enviar el campo no borra un snapshot anterior. Una lista válida sin unidades devuelve `[]`,
 * que sí reemplaza el snapshot porque significa que se consultó y no había existencias.
 */
export function parseWarehouseSnapshot(value: unknown): ProductWarehouseStock[] | null {
  if (!Array.isArray(value)) return null;

  const valid: ProductWarehouseStock[] = [];
  for (const item of value) {
    if (!isRecord(item)) continue;

    const id = finiteNumber(item.id);
    const quantity = finiteNumber(item.quantity);
    if (id === null || !Number.isSafeInteger(id)) continue;
    if (quantity === null || !Number.isSafeInteger(quantity) || quantity < 0) continue;

    // El nombre es opcional: el visible se resuelve con el glosario de bodegas al serializar.
    // Se conserva el nombre del proveedor como respaldo para ids que aún no estén en el glosario.
    const name = typeof item.name === 'string' ? item.name.trim() : '';
    valid.push({ id, name, quantity });
  }

  // Una lista con datos pero sin ninguna entrada reconocible indica que cambió la forma del
  // proveedor; no se debe interpretar como «cero existencias».
  if (value.length > 0 && valid.length === 0) return null;

  return valid.filter((warehouse) => warehouse.quantity > 0);
}

/**
 * Convierte el snapshot almacenado en la forma que consume el panel. El nombre visible sale
 * siempre del glosario; el nombre del proveedor solo se usa para ids desconocidos. Las bodegas
 * principales (PALI y SERATUS) se agrupan en una sola fila y sus unidades se suman.
 */
export function displayWarehouses(
  warehouses: ProductWarehouseStock[] | null,
): ProductWarehouseStock[] | null {
  if (!warehouses) return null;

  const merged = new Map<number, ProductWarehouseStock>();
  for (const warehouse of warehouses) {
    const groupId = warehouseDisplayGroupId(warehouse.id);
    const existing = merged.get(groupId);
    if (existing) {
      existing.quantity += warehouse.quantity;
      continue;
    }
    merged.set(groupId, {
      ...warehouse,
      id: groupId,
      name: warehouseDisplayName(warehouse.id, warehouse.name),
    });
  }
  return [...merged.values()];
}
