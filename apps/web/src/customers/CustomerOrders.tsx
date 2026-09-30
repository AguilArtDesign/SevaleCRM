import { useState } from 'react';
import { useInfiniteQuery } from '@tanstack/react-query';
import { Button, EmptyState, Modal, Spinner, Table } from '@heroui/react';
import { Eye, ShoppingCart } from '@gravity-ui/icons';
import { ordersApi, type CustomerOrderRecord, type CustomerOrdersResponse } from '../orders/api';
import {
  formattedDate,
  formattedMoney,
  formattedMoneyWithCode,
  OrderStatusChip,
  StoreChip,
} from '../orders/presentation';

const pageSize = 10;

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'No pudimos completar la solicitud.';
}

/** Totales por moneda: un cliente puede tener pedidos en COP y en USD y no se suman entre sí. */
function OrdersSummary({ summary }: { summary?: CustomerOrdersResponse['summary'] }) {
  const totals = summary?.completedTotals ?? [];
  return (
    <div className="customer-orders-summary">
      <article className="customer-orders-stat">
        <span>Total Pedidos</span>
        <strong>{summary ? summary.totalOrders : '—'}</strong>
      </article>
      <article className="customer-orders-stat">
        <span>Total Comprado</span>
        <strong>
          {totals.length === 0
            ? formattedMoneyWithCode('0', 'COP')
            : totals.map((entry) => (
                <span key={entry.currency} className="customer-orders-stat-amount">
                  {formattedMoneyWithCode(entry.total, entry.currency)}
                </span>
              ))}
        </strong>
      </article>
    </div>
  );
}

/** Detalle de un pedido de tienda: sus productos, totales y los datos de envío. */
function CustomerOrderDetail({ order }: { order: CustomerOrderRecord }) {
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
 * Pedidos del cliente dentro de su detalle. Cada fila es un pedido de tienda: una operación creada
 * en el CRM y enviada a ambas tiendas aparece una vez por tienda, igual que en el panel de Pedidos.
 */
export function CustomerOrders({ customerId }: { customerId: number }) {
  const [selected, setSelected] = useState<CustomerOrderRecord | null>(null);

  const ordersQuery = useInfiniteQuery({
    queryKey: ['orders', 'customer', customerId],
    queryFn: ({ pageParam }) => ordersApi.customerOrders(customerId, pageParam, pageSize),
    initialPageParam: 1,
    getNextPageParam: (lastPage) =>
      lastPage.pagination.page < lastPage.pagination.totalPages
        ? lastPage.pagination.page + 1
        : undefined,
  });

  if (ordersQuery.isError) {
    return (
      <section className="customer-detail-section">
        <h3>Pedidos</h3>
        <p className="customer-orders-error" role="alert">
          {messageFrom(ordersQuery.error)}
        </p>
      </section>
    );
  }

  const orders = ordersQuery.data?.pages.flatMap((page) => page.data) ?? [];
  const summary = ordersQuery.data?.pages[0]?.summary;

  return (
    <section className="customer-detail-section">
      <h3>Resumen General</h3>
      <OrdersSummary summary={summary} />

      <h3>Historial de Pedidos</h3>
      <Table className="customer-orders-table">
        <Table.ScrollContainer>
          <Table.Content aria-label="Historial de pedidos del cliente">
            <Table.Header>
              <Table.Column isRowHeader>Pedido</Table.Column>
              <Table.Column>Tienda</Table.Column>
              <Table.Column>Estado</Table.Column>
              <Table.Column>Total</Table.Column>
              <Table.Column>Fecha</Table.Column>
              <Table.Column className="customer-orders-actions-column">
                <span className="customer-orders-column-label">Acciones</span>
              </Table.Column>
            </Table.Header>
            <Table.Body
              renderEmptyState={() =>
                ordersQuery.isPending ? (
                  <div className="customer-orders-state">
                    <Spinner size="sm" />
                    <span>Cargando pedidos…</span>
                  </div>
                ) : (
                  <EmptyState className="customer-orders-state">
                    <ShoppingCart width={26} height={26} />
                    <strong>Sin pedidos</strong>
                    <span>Este cliente todavía no tiene pedidos.</span>
                  </EmptyState>
                )
              }
            >
              {orders.map((order) => (
                <Table.Row key={order.id} id={order.id}>
                  <Table.Cell>
                    <strong className="order-code">#{order.wooOrderId ?? order.id}</strong>
                  </Table.Cell>
                  <Table.Cell>
                    <StoreChip store={order.store} />
                  </Table.Cell>
                  <Table.Cell>
                    <OrderStatusChip status={order.status} wooStatus={order.wooStatus} />
                  </Table.Cell>
                  <Table.Cell className="customer-orders-total">
                    {formattedMoneyWithCode(order.total, order.currency)}
                  </Table.Cell>
                  <Table.Cell className="customer-orders-date">
                    {formattedDate(order.wooCreatedAt ?? order.createdAt)}
                  </Table.Cell>
                  <Table.Cell className="customer-orders-actions">
                    <Button
                      className="inventory-actions-trigger"
                      isIconOnly
                      size="sm"
                      variant="ghost"
                      aria-label={`Ver el pedido #${order.wooOrderId ?? order.id}`}
                      onPress={() => setSelected(order)}
                    >
                      <Eye width={17} height={17} />
                    </Button>
                  </Table.Cell>
                </Table.Row>
              ))}
              {orders.length > 0 && (
                <Table.LoadMore
                  isLoading={ordersQuery.isFetchingNextPage}
                  onLoadMore={() => {
                    if (ordersQuery.hasNextPage) void ordersQuery.fetchNextPage();
                  }}
                >
                  <Table.LoadMoreContent>
                    <Spinner size="sm" />
                    <span>Cargando más pedidos…</span>
                  </Table.LoadMoreContent>
                </Table.LoadMore>
              )}
            </Table.Body>
          </Table.Content>
        </Table.ScrollContainer>
      </Table>

      {selected && (
        <Modal
          isOpen
          onOpenChange={(open) => {
            if (!open) setSelected(null);
          }}
        >
          <Modal.Backdrop>
            <Modal.Container size="lg" placement="center" scroll="inside">
              <Modal.Dialog className="order-detail-modal">
                <Modal.CloseTrigger aria-label="Cerrar detalle" />
                <Modal.Header>
                  <div>
                    <Modal.Heading>#{selected.wooOrderId ?? selected.id}</Modal.Heading>
                    <p>Pedido enviado a la tienda.</p>
                  </div>
                </Modal.Header>
                <Modal.Body>
                  <CustomerOrderDetail order={selected} />
                </Modal.Body>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      )}
    </section>
  );
}
