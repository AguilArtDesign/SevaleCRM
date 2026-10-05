import { useEffect, useState } from 'react';
import { Button, Drawer } from '@heroui/react';
import { ArrowRight } from '@gravity-ui/icons';
import { Chip } from '../components/Chip';
import type { CustomerOrderRecord } from '../orders/api';
import {
  addressLines,
  formattedDate,
  formattedMoneyWithCode,
  formattedPhone,
  OrderAddress,
  orderStatusEmoji,
  OrderStatusChip,
  ProductThumb,
  StoreChip,
  syncStatusMeta,
} from '../orders/presentation';

/** Detalle de un pedido de tienda, con el mismo formato de recibo que el detalle del panel de Pedidos. */
function OrderDetail({ order }: { order: CustomerOrderRecord }) {
  const recipient = [order.shipping.firstName, order.shipping.lastName].filter(Boolean).join(' ');
  const billingRecipient =
    [order.billing.firstName, order.billing.lastName].filter(Boolean).join(' ') ||
    order.billing.company ||
    '--';

  return (
    <div className="order-detail">
      <article className="order-ticket">
        <header className="order-ticket-head">
          <div className="order-ticket-chips">
            <StoreChip store={order.store} />
            <Chip color={syncStatusMeta[order.syncStatus].color}>
              {syncStatusMeta[order.syncStatus].label}
            </Chip>
          </div>
          <img
            className="order-ticket-emoji"
            src={orderStatusEmoji(order.status, order.wooStatus)}
            alt=""
          />
          <h3 className="order-ticket-title">Pedido #{order.wooOrderId ?? order.id}</h3>
          <p className="order-ticket-meta">
            {order.operationCode} · {order.source === 'CRM' ? 'CRM' : 'WooCommerce'}
          </p>
          <span className="order-ticket-status">
            <OrderStatusChip status={order.status} wooStatus={order.wooStatus} />
          </span>
        </header>

        <div className="order-ticket-perforation" aria-hidden="true" />

        <dl className="order-ticket-facts">
          <div>
            <dt>Fecha &amp; hora</dt>
            <dd>{formattedDate(order.wooCreatedAt ?? order.createdAt)}</dd>
          </div>
          <div className="order-ticket-fact-end">
            <dt>Método de pago</dt>
            <dd>{order.paymentMethodTitle || order.paymentMethod || 'N/A'}</dd>
          </div>
        </dl>

        <div className="order-ticket-items">
          <div className="order-ticket-items-head">
            <span>Producto</span>
            <span className="order-ticket-qty">Cant</span>
            <span className="order-ticket-amount">Total</span>
          </div>
          {order.items.map((item) => (
            <div className="order-ticket-item" key={item.id}>
              <div className="order-ticket-product">
                <ProductThumb src={item.product?.imageUrl} />
                <div>
                  <strong>{item.nameSnapshot}</strong>
                  <span>{item.skuSnapshot}</span>
                </div>
              </div>
              <span className="order-ticket-qty">{item.quantity}</span>
              <div className="order-ticket-amount">
                {item.priceModified && item.originalPrice && (
                  <del>{formattedMoneyWithCode(item.originalPrice, order.currency)}</del>
                )}
                <strong>{formattedMoneyWithCode(item.total, order.currency)}</strong>
              </div>
            </div>
          ))}
        </div>

        <div className="order-ticket-perforation" aria-hidden="true" />

        <dl className="order-ticket-lines">
          <div>
            <dt>Subtotal</dt>
            <dd>{formattedMoneyWithCode(order.subtotal, order.currency)}</dd>
          </div>
          <div>
            <dt>Envío</dt>
            <dd>{formattedMoneyWithCode(order.shippingTotal, order.currency)}</dd>
          </div>
          {order.coupons.map((coupon) => (
            <div key={coupon.id}>
              <dt className="order-ticket-coupon">
                Cupón
                <strong>{coupon.code}</strong>
              </dt>
              <dd>- {formattedMoneyWithCode(coupon.discountTotal, order.currency)}</dd>
            </div>
          ))}
        </dl>

        <div className="order-ticket-divider" aria-hidden="true" />

        <dl className="order-ticket-paid">
          <dt>Total pagado</dt>
          <dd>{formattedMoneyWithCode(order.total, order.currency)}</dd>
        </dl>

        <div className="order-ticket-perforation" aria-hidden="true" />

        <div className="order-ticket-data">
          <OrderAddress
            title="Datos de Facturación"
            name={billingRecipient}
            lines={[
              ...addressLines({
                address1: order.billing.address1,
                address2: order.billing.address2,
                city: order.billing.city,
                state: order.billing.state,
                postcode: order.billing.postcode,
                country: order.billing.country,
              }),
              order.billing.email,
              formattedPhone(order.billing.phone, order.billing.country),
            ]}
          />
          <OrderAddress
            title="Datos de Envío"
            name={recipient || 'Sin destinatario registrado'}
            lines={[
              ...addressLines({
                address1: order.shipping.address1,
                address2: order.shipping.address2,
                city: order.shipping.city,
                state: order.shipping.state,
                postcode: order.shipping.postcode,
                country: order.shipping.country,
              }),
              formattedPhone(order.shipping.phone, order.shipping.country),
            ]}
          />
          <div>
            <span>Creado por</span>
            <strong>
              {order.createdBy?.name ?? (order.source === 'WOOCOMMERCE' ? 'WooCommerce' : '--')}
            </strong>
            <p>{formattedDate(order.createdAt)}</p>
          </div>
          {order.updatedAt !== order.createdAt && (
            <div>
              <span>Última modificación</span>
              <p>{formattedDate(order.updatedAt)}</p>
            </div>
          )}
        </div>
      </article>
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
            <Drawer.Header className="customer-order-panel-header">
              <Button
                className="customer-order-panel-back"
                size="sm"
                variant="ghost"
                onPress={onClose}
              >
                Volver a Detalles
                <ArrowRight width={16} height={16} />
              </Button>
              {/* El número ya está en el recibo; el título se oculta pero se conserva para que el
                  panel siga teniendo nombre accesible. */}
              <Drawer.Heading className="customer-order-panel-heading">
                Pedido {code}
              </Drawer.Heading>
            </Drawer.Header>
            <Drawer.Body>{shown && <OrderDetail order={shown} />}</Drawer.Body>
          </Drawer.Dialog>
        </Drawer.Content>
      </Drawer.Backdrop>
    </Drawer>
  );
}
