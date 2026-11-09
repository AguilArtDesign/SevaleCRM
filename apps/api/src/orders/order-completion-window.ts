import { reopenableOrder } from './order-reopen-window.js';

/**
 * Estados de WooCommerce en los que el pedido sigue abierto y la tienda no va a moverlo sola: el
 * pago está pendiente o en verificación y alguien tiene que decidir qué pasa con él.
 *
 * Mientras el pedido está así, el comercial puede cobrar por fuera de la pasarela —transferencia,
 * datáfono, pago con el asesor— y cerrarlo desde el CRM. Sin esta salida, la operación quedaba
 * congelada: se editaba en el CRM pero nunca llegaba a la tienda, porque completar es lo que dispara
 * la sincronización.
 */
const openWooStatuses = new Set(['pending', 'on-hold', 'processing']);

type StoreOrderState = {
  wooStatus: string | null;
  wooCreatedAt: Date | null;
};

/**
 * Si el comercial puede cerrar desde el CRM una operación que vino de la tienda.
 *
 * Dos caminos: la tienda la cerró y alguien la reabrió —eso ya lo decide `reopenedAt`—, o la tienda
 * la dejó abierta esperando una gestión humana. En el segundo caso manda la fecha, igual que en la
 * reapertura: los pedidos anteriores al corte ya son historial y nadie los va a retomar.
 */
export function completableStoreOperation(
  orders: StoreOrderState[],
  createdAt: Date,
  reopened: boolean,
): boolean {
  if (reopened) return true;
  return orders.some(({ wooStatus, wooCreatedAt }) => {
    if (!wooStatus) return false;
    if (!openWooStatuses.has(wooStatus.trim().toLocaleLowerCase('en'))) return false;
    return reopenableOrder(wooCreatedAt ?? createdAt);
  });
}
