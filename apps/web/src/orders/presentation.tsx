import {
  bogotaTimeZone,
  formatPhoneInternational,
  resolveCustomerCountryName,
  resolveCustomerRegionName,
} from '@sevale/shared';
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

type AddressParts = {
  address1: string | null;
  address2: string | null;
  city: string | null;
  state: string | null;
  postcode: string | null;
  country: string | null;
};

/**
 * Dirección desglosada: un dato por línea, en el orden en que se lee. Las tiendas guardan el país y
 * la región como códigos (`CO`, `CO-ANT`), así que se traducen al nombre real; el resto de la
 * dirección ya viene escrito.
 */
export function addressLines(parts: AddressParts): string[] {
  const region = resolveCustomerRegionName(parts.country, parts.state);
  const country = resolveCustomerCountryName(parts.country);

  return [parts.address1, parts.address2, parts.city, region, country, parts.postcode].filter(
    (line): line is string => Boolean(line),
  );
}

/**
 * Teléfono con la agrupación del país: las tiendas lo mandan pegado (`+573044251788`) y el CRM lo
 * muestra espaciado (`+57 304 4251788`). Si no se puede interpretar, se deja tal cual; si no hay
 * teléfono no devuelve línea, para no dejar un renglón vacío en la lista de la dirección.
 */
export function formattedPhone(phone: string | null, country: string | null): string | null {
  if (!phone) return null;
  if (!country) return phone;
  return formatPhoneInternational(phone, country) ?? phone;
}

/**
 * Bloque de una dirección: el nombre en primer plano y, debajo, un dato por línea. Se comparte entre
 * el detalle del panel de Pedidos y el del historial del cliente para que los dos se vean igual.
 */
export function OrderAddress({
  title,
  name,
  lines,
}: {
  title: string;
  name: string;
  lines: Array<string | null>;
}) {
  return (
    <div>
      <span>{title}</span>
      <strong>{name}</strong>
      {lines
        .filter((line): line is string => Boolean(line))
        .map((line) => (
          <p key={line}>{line}</p>
        ))}
    </div>
  );
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

/**
 * Emoji de estado del recibo: un archivo por estado de WooCommerce. Dos archivos no siguen la
 * ortografía de la tienda (`procesing` sin la segunda "c" y `canceled` con una sola "l"), así que el
 * mapa traduce del estado al nombre real del archivo.
 */
const wooStatusEmoji: Record<string, string> = {
  pending: 'pending',
  processing: 'procesing',
  'on-hold': 'on-hold',
  completed: 'completed',
  cancelled: 'canceled',
  refunded: 'refunded',
  failed: 'failed',
};

// Mientras el pedido no exista en la tienda solo hay estado local del CRM.
const crmStatusEmoji: Record<OrderStatus, string> = {
  PENDING: 'pending',
  COMPLETED: 'completed',
  CANCELLED: 'canceled',
};

/** Imagen que sustituye al producto cuando no está en el inventario o no tiene foto cargada. */
export const productImageFallback = '/status/fallback.webp';

export function orderStatusEmoji(status: OrderStatus, wooStatus?: string | null): string {
  const clave = wooStatus?.trim().toLocaleLowerCase('en') ?? '';
  const archivo = wooStatusEmoji[clave] ?? crmStatusEmoji[status];
  return `/status/${archivo}.webp`;
}

/** Estado de la sincronización del pedido con su tienda. */
export const syncStatusMeta = {
  PENDING: { label: 'Pendiente', color: 'warning' as const },
  SYNCING: { label: 'Sincronizando', color: 'accent' as const },
  SYNCED: { label: 'Sincronizado', color: 'success' as const },
  ERROR: { label: 'Error', color: 'danger' as const },
};

/**
 * Miniatura del producto en el recibo. Cae a la imagen de respaldo cuando el producto no está en el
 * inventario (sin `imageUrl`) o cuando la foto de la tienda no carga: son URLs externas y pueden
 * responder con error. La marca en `dataset` evita un bucle si el propio respaldo fallara.
 */
export function ProductThumb({ src }: { src?: string | null }) {
  return (
    <img
      className="order-ticket-thumb"
      src={src || productImageFallback}
      alt=""
      onError={(event) => {
        const image = event.currentTarget;
        if (image.dataset.fallback === 'true') return;
        image.dataset.fallback = 'true';
        image.src = productImageFallback;
      }}
    />
  );
}

// El chip refleja el estado real de la tienda cuando el pedido ya existe en WooCommerce; mientras no
// se haya creado, solo hay estado local del CRM.
export function resolveOrderStatus(status: OrderStatus, wooStatus?: string | null) {
  return wooStatus ? resolveWooStatus(wooStatus) : statusMeta[status];
}

export function OrderStatusChip({
  status,
  wooStatus,
}: {
  status: OrderStatus;
  wooStatus?: string | null;
}) {
  const meta = resolveOrderStatus(status, wooStatus);
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
