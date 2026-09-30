import { useEffect, useState } from 'react';
import { Button, Drawer } from '@heroui/react';
import { ArrowChevronLeft } from '@gravity-ui/icons';
import type { CustomerOrderRecord } from '../orders/api';
import { formattedDate, formattedMoney, OrderStatusChip, StoreChip } from '../orders/presentation';

/** Detalle de un pedido de tienda: sus productos, totales y los datos de envío. */
function OrderDetail({ order }: { order: CustomerOrderRecord }) {
  const address = [
    order.shipping.address1,
    order.shipping.address2,
    order.shipping.city,
    order.shipping.state,
    order.shipping.postcode,
  ]
    .filter(Boolean)
    .join(', ');
  const recipient = [order.shipping.firstName, order.shipping.lastName].filter(Boolean).join(' ');

  return (
    <div className="order-detail">
      <section className="order-detail-overview">
        <div>
          <span>Estado</span>
          <OrderStatusChip status={order.status} wooStatus={order.wooStatus} />
        </div>
        <div>
          <span>Tienda</span>
          <StoreChip store={order.store} />
        </div>
        <div>
          <span>Operación</span>
          <strong>{order.operationCode}</strong>
          <small>{order.source === 'CRM' ? 'CRM' : 'WooCommerce'}</small>
        </div>
        <div>
          <span>Fecha</span>
          <strong>{formattedDate(order.wooCreatedAt ?? order.createdAt)}</strong>
        </div>
      </section>

      <section className="order-detail-section">
        <h3>Productos</h3>
        <div className="order-detail-stores">
          <article>
            <header>
              <div className="order-detail-store-heading">
                <StoreChip store={order.store} />
              </div>
              <strong>{formattedMoney(order.total, order.currency)}</strong>
            </header>
            {order.items.map((item) => (
              <div className="order-detail-item" key={item.id}>
                <div>
                  <strong>{item.nameSnapshot}</strong>
                  <span>
                    {item.skuSnapshot} · {item.quantity} unidad(es)
                  </span>
                </div>
                <div>
                  <strong>{formattedMoney(item.total, order.currency)}</strong>
                  {item.priceModified && <small>Precio modificado</small>}
                </div>
              </div>
            ))}
            <dl>
              <div>
                <dt>Subtotal</dt>
                <dd>{formattedMoney(order.subtotal, order.currency)}</dd>
              </div>
              {order.coupons.map((coupon) => (
                <div key={coupon.id}>
                  <dt>Cupón {coupon.code}</dt>
                  <dd>- {formattedMoney(coupon.discountTotal, order.currency)}</dd>
                </div>
              ))}
              <div>
                <dt>Descuento</dt>
                <dd>- {formattedMoney(order.discountTotal, order.currency)}</dd>
              </div>
              <div>
                <dt>Envío</dt>
                <dd>{formattedMoney(order.shippingTotal, order.currency)}</dd>
              </div>
              <div>
                <dt>Total</dt>
                <dd>{formattedMoney(order.total, order.currency)}</dd>
              </div>
            </dl>
          </article>
        </div>
      </section>

      <section className="order-detail-section">
        <h3>Envío</h3>
        <p>
          <strong>{recipient || 'Sin destinatario registrado'}</strong>
        </p>
        <p>{address || 'Sin dirección registrada'}</p>
        <p>
          {order.shipping.methodTitle || order.shipping.method || 'Sin método de envío'} ·{' '}
          {order.shipping.phone || 'Sin teléfono'}
        </p>
      </section>
    </div>
  );
}

/**
 * Detalle del pedido abierto desde el historial del cliente. Se muestra como un panel junto al
 * detalle del cliente: el drawer de cliente se corre la mitad de su ancho y este panel ocupa el
 * espacio que deja libre, así que los dos quedan visibles a la vez. "Volver a Detalles" lo cierra
 * y el drawer de cliente vuelve a su lugar.
 */
export function CustomerOrderPanel({
  order,
  onClose,
}: {
  order: CustomerOrderRecord | null;
  onClose: () => void;
}) {
  // El pedido se conserva mientras el panel se cierra: si no, quedaría vacío durante la salida.
  const [lastOrder, setLastOrder] = useState<CustomerOrderRecord | null>(null);
  useEffect(() => {
    if (order) setLastOrder(order);
  }, [order]);

  const shown = order ?? lastOrder;
  const code = shown ? `#${shown.wooOrderId ?? shown.id}` : '';

  return (
    <Drawer
      isOpen={order !== null}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      {/* El fondo atenuado lo aporta este overlay mientras el panel está abierto; el del detalle del
          cliente se vuelve transparente para no atenuar dos veces. El z-index deja todo el panel por
          debajo del drawer, así pasa por detrás al entrar y al salir. */}
      <Drawer.Backdrop className="customer-order-panel-backdrop">
        <Drawer.Content placement="right">
          <Drawer.Dialog className="customer-order-panel">
            <Drawer.Header>
              <div>
                <Button
                  className="customer-order-panel-back"
                  size="sm"
                  variant="ghost"
                  onPress={onClose}
                >
                  <ArrowChevronLeft width={16} height={16} />
                  Volver a Detalles
                </Button>
                <Drawer.Heading>Pedido {code}</Drawer.Heading>
              </div>
            </Drawer.Header>
            <Drawer.Body>{shown && <OrderDetail order={shown} />}</Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
