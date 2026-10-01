import { bogotaTimeZone } from '@sevale/shared';
import { Chip } from '../components/Chip';
import type { OrderListRecord, OrderSource, OrderStatus } from './api';

const statusMeta: Record<OrderStatus, { label: string; color: 'warning' | 'success' | 'danger' }> =
  {
    PENDING: { label: 'Pendiente', color: 'warning' },
    COMPLETED: { label: 'Completada', color: 'success' },
    CANCELLED: { label: 'Cancelada', color: 'danger' },
  };

// Estados nativos de WooCommerce con la traducción y el color que usa la tienda.
const wooStatusMeta: Record<
  string,
  { label: string; color: 'accent' | 'danger' | 'default' | 'success' | 'warning' }
> = {
  pending: { label: 'Pendiente', color: 'warning' },
  processing: { label: 'Procesando', color: 'accent' },
  'on-hold': { label: 'En espera', color: 'warning' },
  completed: { label: 'Completado', color: 'success' },
  cancelled: { label: 'Cancelado', color: 'default' },
  refunded: { label: 'Reembolsado', color: 'default' },
  failed: { label: 'Fallido', color: 'danger' },
};

export function formattedMoney(value: string, currency: string): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency,
    minimumFractionDigits: currency === 'COP' ? 0 : 2,
  }).format(Number(value));
}

/**
 * Importe con el código de moneda al final, para totales donde la divisa no es obvia.
 * Intl separa el símbolo del importe con un espacio duro; el CRM los muestra pegados.
 */
export function formattedMoneyWithCode(value: string, currency: string): string {
  const parts = new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 0,
    maximumFractionDigits: currency === 'COP' ? 0 : 2,
  }).formatToParts(Number(value));

  const symbol = parts.find((part) => part.type === 'currency')?.value ?? '';
  const amount = parts
    .filter((part) => part.type !== 'currency' && part.type !== 'literal')
    .map((part) => part.value)
    .join('');

  return `${symbol}${amount} ${currency}`;
}

/**
 * Las fechas del CRM son eventos de negocio en Colombia, así que se muestran en hora de Bogotá sin
 * importar el huso horario de quien consulte.
 */
export function formattedDate(value: string): string {
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: bogotaTimeZone,
  }).format(new Date(value));
}

/**
 * El envío solo se puede asignar cuando la operación ya se completó, o cuando es un pedido de
 * WooCommerce que todavía no se canceló. El backend aplica la misma regla.
 */
export function allowsShipment(order: { status: OrderStatus; source: OrderSource }): boolean {
  return (
    order.status === 'COMPLETED' || (order.source === 'WOOCOMMERCE' && order.status !== 'CANCELLED')
  );
}

/** Un pedido cuenta como completado si el estado que ve el usuario es "Completado". */
// WooCommerce devuelve el estado en minúsculas y admite estados propios de plugins: los
// desconocidos se muestran tal cual, sin inventar una traducción.
export function resolveWooStatus(wooStatus: string) {
  return (
    wooStatusMeta[wooStatus.trim().toLocaleLowerCase('en')] ?? {
      label: wooStatus,
      color: 'default' as const,
    }
  );
}

// El chip refleja el estado real de la tienda cuando el pedido ya existe en WooCommerce; mientras no
// se haya creado, solo hay estado local del CRM.
export function OrderStatusChip({
  status,
  wooStatus,
}: {
  status: OrderStatus;
  wooStatus?: string | null;
}) {
  if (wooStatus) {
    const woo = resolveWooStatus(wooStatus);
    return <Chip color={woo.color}>{woo.label}</Chip>;
  }

  const meta = statusMeta[status];
  return <Chip color={meta.color}>{meta.label}</Chip>;
}

export function StoreChip({ store }: Pick<OrderListRecord, 'store'>) {
  return (
    <Chip
      className={store === 'SERATUS' ? 'inventory-store-chip-seratus' : 'inventory-store-chip-pali'}
    >
      {store === 'SERATUS' ? 'Seratus' : 'Pali'}
    </Chip>
  );
}
