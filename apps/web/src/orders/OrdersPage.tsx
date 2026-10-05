import { useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Selection } from '@heroui/react';
import {
  Alert,
  AlertDialog,
  Button,
  Checkbox,
  Dropdown,
  EmptyState,
  Label,
  ListBox,
  Modal,
  SearchField,
  Separator,
  Spinner,
  Table,
  toast,
} from '@heroui/react';
import {
  ArrowRotateRight,
  Check,
  EllipsisVertical,
  Eye,
  FileText,
  Gift,
  Pencil,
  Plus,
  ShoppingCart,
  Car,
  TrashBin,
  Xmark,
} from '@gravity-ui/icons';
import type { CreateOrderOperationInput } from '@sevale/validation';
import { Chip } from '../components/Chip';
import { getPaginationItems, Pagination } from '../components/Pagination';
import { Select } from '../components/Select';
import type { ProductStore } from '../inventory/api';
import { useCurrentUser } from '../users/useCurrentUser';
import { OrderForm } from './OrderForm';
import {
  addressLines,
  allowsShipment,
  formattedDate,
  formattedMoney,
  formattedMoneyWithCode,
  OrderAddress,
  orderStatusEmoji,
  OrderStatusChip,
  ProductThumb,
  StoreChip,
  syncStatusMeta,
} from './presentation';
import { useFormattedPhone } from '../components/useFormattedPhone';
import { ShipmentModal } from './ShipmentModal';
import { ShipmentViewModal } from './ShipmentViewModal';
import {
  ordersApi,
  type OrderDetailRecord,
  type OrderListInput,
  type OrderListRecord,
} from './api';

const initialFilters: OrderListInput = {
  search: '',
  status: '',
  source: '',
  store: '',
  page: 1,
  pageSize: 20,
  sort: 'createdAt',
  order: 'desc',
};

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'No pudimos completar la solicitud.';
}

/** Acción de fila que necesita los datos del pedido antes de abrir su modal. */
type OrderActionTarget = {
  kind: 'shipment-form' | 'shipment-view';
  operationId: number;
};

function stopRowSelection(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

function OrderDetail({
  order,
  store,
  onSelectStore,
}: {
  order: OrderDetailRecord;
  store: ProductStore;
  onSelectStore: (store: ProductStore) => void;
}) {
  const billingRecipient =
    [order.billingFirstName, order.billingLastName].filter(Boolean).join(' ') ||
    order.billingCompany ||
    '--';
  const shippingRecipient =
    [order.shippingFirstName, order.shippingLastName].filter(Boolean).join(' ') ||
    order.shippingCompany ||
    '--';
  const billingPhone = useFormattedPhone(order.billingPhone, order.billingCountry);
  const shippingPhone = useFormattedPhone(order.shippingPhone, order.shippingCountry);

  // La operación puede tener un pedido por tienda, pero el detalle es del pedido de la fila
  // consultada: se muestran solo sus productos y sus totales.
  const storeOrder = order.orders.find((candidate) => candidate.store === store) ?? order.orders[0];
  // Si la operación tiene productos de las dos marcas hay un pedido hermano al que saltar.
  const siblings = order.orders.filter(
    (candidate) => candidate.store !== storeOrder?.store && candidate.items.length > 0,
  );

  return (
    <div className="order-detail">
      {storeOrder && (
        <article className="order-ticket">
          <header className="order-ticket-head">
            <div className="order-ticket-chips">
              <StoreChip store={storeOrder.store} />
              <Chip color={syncStatusMeta[storeOrder.syncStatus].color}>
                {syncStatusMeta[storeOrder.syncStatus].label}
              </Chip>
            </div>
            <img
              className="order-ticket-emoji"
              src={orderStatusEmoji(order.status, storeOrder.wooStatus)}
              alt=""
            />
            <h3 className="order-ticket-title">Pedido #{storeOrder.wooOrderId ?? storeOrder.id}</h3>
            <p className="order-ticket-meta">
              {order.operationCode} · {order.source === 'CRM' ? 'CRM' : 'WooCommerce'}
            </p>
            <span className="order-ticket-status">
              <OrderStatusChip status={order.status} wooStatus={storeOrder.wooStatus} />
            </span>
          </header>

          <div className="order-ticket-perforation" aria-hidden="true" />

          <dl className="order-ticket-facts">
            <div>
              <dt>Fecha &amp; hora</dt>
              <dd>{formattedDate(storeOrder.wooCreatedAt ?? order.createdAt)}</dd>
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
            {storeOrder.items.map((item) => (
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
              <dd>{formattedMoneyWithCode(storeOrder.subtotal, order.currency)}</dd>
            </div>
            <div>
              <dt>Envío</dt>
              <dd>{formattedMoneyWithCode(storeOrder.shippingTotal, order.currency)}</dd>
            </div>
            {storeOrder.coupons.map((coupon) => (
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
            <dd>{formattedMoneyWithCode(storeOrder.total, order.currency)}</dd>
          </dl>

          <div className="order-ticket-perforation" aria-hidden="true" />

          <div className="order-ticket-data">
            <OrderAddress
              title="Datos de Facturación"
              name={billingRecipient}
              lines={[
                ...addressLines({
                  address1: order.billingAddress1,
                  address2: order.billingAddress2,
                  city: order.billingCity,
                  state: order.billingState,
                  postcode: order.billingPostcode,
                  country: order.billingCountry,
                }),
                order.billingEmail,
                billingPhone,
              ]}
            />
            <OrderAddress
              title="Datos de Envío"
              name={shippingRecipient}
              lines={[
                ...addressLines({
                  address1: order.shippingAddress1,
                  address2: order.shippingAddress2,
                  city: order.shippingCity,
                  state: order.shippingState,
                  postcode: order.shippingPostcode,
                  country: order.shippingCountry,
                }),
                shippingPhone,
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
      )}
      {siblings.length > 0 && (
        <section className="order-detail-section">
          <h3>Pedidos asociados</h3>
          <div className="order-detail-siblings">
            {siblings.map((sibling) => (
              <Button
                key={sibling.id}
                className="order-detail-sibling"
                variant="secondary"
                onPress={() => onSelectStore(sibling.store)}
              >
                <span className="order-detail-store-heading">
                  <StoreChip store={sibling.store} />
                  <Chip color={syncStatusMeta[sibling.syncStatus].color}>
                    {syncStatusMeta[sibling.syncStatus].label}
                  </Chip>
                </span>
                <strong>#{sibling.wooOrderId ?? sibling.id}</strong>
                <span className="order-detail-sibling-total">
                  {formattedMoney(sibling.total, order.currency)}
                </span>
              </Button>
            ))}
          </div>
          <p>
            La operación tiene productos de las dos marcas: este es el pedido de la otra tienda.
          </p>
        </section>
      )}
    </div>
  );
}

export function OrdersPage() {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const canManage = user?.role === 'ADMIN' || user?.role === 'COMMERCIAL';
  // Logística es quien asigna el envío y el administrador puede todo; los demás solo lo consultan.
  const canAssignShipping = user?.role === 'ADMIN' || user?.role === 'LOGISTICS';
  const isAdmin = user?.role === 'ADMIN';
  const [searchDraft, setSearchDraft] = useState('');
  const [filters, setFilters] = useState<OrderListInput>(initialFilters);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  // El detalle es de un pedido concreto: la operación y la tienda de la fila consultada.
  const [selected, setSelected] = useState<{ operationId: number; store: ProductStore } | null>(
    null,
  );
  const selectedId = selected?.operationId ?? null;
  const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<OrderListRecord | null>(null);
  const [completeTarget, setCompleteTarget] = useState<OrderListRecord | null>(null);
  const [actionTarget, setActionTarget] = useState<OrderActionTarget | null>(null);
  const actionOperationId = actionTarget?.operationId ?? null;

  const ordersQuery = useQuery({
    queryKey: ['orders', filters],
    queryFn: () => ordersApi.list(filters),
    placeholderData: keepPreviousData,
  });
  const selectedQuery = useQuery({
    queryKey: ['orders', 'detail', selectedId],
    queryFn: () => ordersApi.detail(selectedId as number),
    enabled: selectedId !== null,
  });
  // Comparte la clave de caché con el detalle, así al abrir una acción desde el propio detalle los
  // datos ya están cargados y el modal aparece sin espera.
  const actionQuery = useQuery({
    queryKey: ['orders', 'detail', actionOperationId],
    queryFn: () => ordersApi.detail(actionOperationId as number),
    enabled: actionOperationId !== null,
  });
  const editingQuery = useQuery({
    queryKey: ['orders', 'detail', editingId],
    queryFn: () => ordersApi.detail(editingId as number),
    enabled: formOpen && editingId !== null,
  });
  const saveOrder = useMutation({
    mutationFn: (input: CreateOrderOperationInput) =>
      editingId ? ordersApi.update(editingId, input) : ordersApi.create(input),
    onSuccess: async (order) => {
      queryClient.setQueryData(['orders', 'detail', order.id], order);
      setFormOpen(false);
      setEditingId(null);
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
  const deleteOrder = useMutation({
    mutationFn: (order: OrderListRecord) => ordersApi.delete(order.operationId),
    onSuccess: async (order) => {
      queryClient.removeQueries({ queryKey: ['orders', 'detail', order.id] });
      if (selectedId === order.id) setSelected(null);
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
  const completeOrder = useMutation({
    mutationFn: (order: OrderListRecord) => ordersApi.complete(order.operationId),
    onSuccess: async (order) => {
      queryClient.setQueryData(['orders', 'detail', order.id], order);
      setCompleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
  const retrySync = useMutation({
    mutationFn: (order: OrderListRecord) => ordersApi.retryOrderSync(order.id),
    onSuccess: async (order) => {
      queryClient.setQueryData(['orders', 'detail', order.id], order);
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
  const updateShipment = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: number;
      input: Parameters<typeof ordersApi.updateShipment>[1];
    }) => ordersApi.updateShipment(id, input),
    onSuccess: async (order) => {
      queryClient.setQueryData(['orders', 'detail', order.id], order);
      setActionTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
  // La cotización de Siigo todavía no se puede crear: la opción del menú está deshabilitada hasta
  // que se ajuste la petición. El modal y ordersApi.createSiigoQuotation quedan listos para cuando
  // se habilite.

  const result = ordersQuery.data;
  const selectedIdSet = selectedKeys === 'all' ? new Set<number>() : selectedKeys;
  const currentPageIds = new Set((result?.data ?? []).map((order) => order.id));
  const currentPageSelection = new Set(
    [...selectedIdSet].filter((key) => currentPageIds.has(Number(key))),
  );
  const updatePageSelection = (selection: Selection) => {
    setSelectedKeys((current) => {
      const next = new Set(current === 'all' ? [] : current);
      currentPageIds.forEach((id) => next.delete(id));
      if (selection === 'all') currentPageIds.forEach((id) => next.add(id));
      else selection.forEach((key) => next.add(Number(key)));
      return next;
    });
  };
  const hasFilters = Boolean(filters.search || filters.status || filters.source || filters.store);
  const openCreate = () => {
    setEditingId(null);
    saveOrder.reset();
    setFormOpen(true);
  };
  const openEdit = (id: number) => {
    setEditingId(id);
    saveOrder.reset();
    setFormOpen(true);
  };
  const submitOrder = async (input: CreateOrderOperationInput) => {
    const isEditing = editingId !== null;
    const loadingId = toast(isEditing ? 'Guardando cambios del pedido…' : 'Creando pedido…', {
      isLoading: true,
      timeout: 0,
    });
    try {
      const order = await saveOrder.mutateAsync(input);
      toast.close(loadingId);
      toast.success(isEditing ? 'Pedido actualizado.' : `Pedido ${order.operationCode} creado.`);
    } catch (error) {
      toast.close(loadingId);
      toast.danger(messageFrom(error));
      throw error;
    }
  };
  const removeOrder = async () => {
    if (!deleteTarget || deleteOrder.isPending) return;
    try {
      await deleteOrder.mutateAsync(deleteTarget);
      toast.success('Pedido eliminado del CRM.');
    } catch (error) {
      toast.danger(messageFrom(error));
    }
  };
  const confirmOrder = async () => {
    if (!completeTarget || completeOrder.isPending) return;
    const loadingId = toast('Creando pedidos en WooCommerce…', {
      isLoading: true,
      timeout: 0,
    });
    try {
      const order = await completeOrder.mutateAsync(completeTarget);
      toast.close(loadingId);
      const failures = order.orders.filter(({ syncStatus }) => syncStatus === 'ERROR').length;
      if (failures) {
        toast.warning('La operación se completó, pero una integración requiere atención.');
      } else {
        toast.success('Operación completada y sincronizada.');
      }
    } catch (error) {
      toast.close(loadingId);
      toast.danger(messageFrom(error));
    }
  };
  const retryOrderSync = async (order: OrderListRecord) => {
    if (retrySync.isPending) return;
    const loadingId = toast('Reintentando sincronización…', { isLoading: true, timeout: 0 });
    try {
      const synchronized = await retrySync.mutateAsync(order);
      toast.close(loadingId);
      const synchronizedRow = synchronized.orders.find(({ id }) => id === order.id);
      if (synchronizedRow?.syncStatus === 'ERROR')
        toast.warning('La integración todavía requiere atención.');
      else toast.success('Sincronización recuperada.');
    } catch (error) {
      toast.close(loadingId);
      toast.danger(messageFrom(error));
    }
  };
  const saveShipment = async (input: Parameters<typeof ordersApi.updateShipment>[1]) => {
    if (!actionOperationId) return;
    try {
      await updateShipment.mutateAsync({ id: actionOperationId, input });
      toast.success('Información de envío guardada.');
    } catch (error) {
      toast.danger(messageFrom(error));
      throw error;
    }
  };

  return (
    <section className="orders-layout">
      <header className="orders-heading">
        <div>
          <h2>Pedidos</h2>
          <Chip>{result?.pagination.total ?? 0}</Chip>
        </div>
        {canManage && (
          <Button variant="primary" onPress={openCreate}>
            <Plus width={17} height={17} />
            Crear pedido
          </Button>
        )}
      </header>

      <div className="orders-toolbar">
        <div className="orders-filters">
          <Select
            aria-label="Filtrar por estado"
            value={filters.status || 'ALL'}
            variant="secondary"
            onChange={(value) =>
              setFilters((current) => ({
                ...current,
                status: value === 'ALL' ? '' : (String(value) as OrderListInput['status']),
                page: 1,
              }))
            }
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="ALL">Todos los estados</ListBox.Item>
                <ListBox.Item id="PENDING">Pendientes</ListBox.Item>
                <ListBox.Item id="COMPLETED">Completados</ListBox.Item>
                <ListBox.Item id="CANCELLED">Cancelados</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
          <Select
            aria-label="Filtrar por tienda"
            value={filters.store || 'ALL'}
            variant="secondary"
            onChange={(value) =>
              setFilters((current) => ({
                ...current,
                store: value === 'ALL' ? '' : (String(value) as OrderListInput['store']),
                page: 1,
              }))
            }
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="ALL">Todas las tiendas</ListBox.Item>
                <ListBox.Item id="SERATUS">Seratus</ListBox.Item>
                <ListBox.Item id="PALI">Pali</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
          <Select
            aria-label="Ordenar pedidos"
            value={`${filters.sort}:${filters.order}`}
            variant="secondary"
            onChange={(value) => {
              const [sort, order] = String(value).split(':') as [
                OrderListInput['sort'],
                OrderListInput['order'],
              ];
              setFilters((current) => ({ ...current, sort, order, page: 1 }));
            }}
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="createdAt:desc">Más recientes</ListBox.Item>
                <ListBox.Item id="createdAt:asc">Más antiguos</ListBox.Item>
                <ListBox.Item id="total:desc">Mayor total</ListBox.Item>
                <ListBox.Item id="total:asc">Menor total</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
          {hasFilters && (
            <Button
              size="sm"
              variant="danger-soft"
              onPress={() => {
                setSearchDraft('');
                setFilters(initialFilters);
              }}
            >
              <Xmark width={15} height={15} />
              Limpiar
            </Button>
          )}
        </div>
        <SearchField
          className="orders-search"
          value={searchDraft}
          onChange={setSearchDraft}
          onSubmit={(value) =>
            setFilters((current) => ({ ...current, search: value.trim(), page: 1 }))
          }
          onClear={() => {
            setSearchDraft('');
            setFilters((current) => ({ ...current, search: '', page: 1 }));
          }}
          aria-label="Buscar pedidos"
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Orden, cliente, documento, SKU…" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
      </div>

      {ordersQuery.isError ? (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Title>No pudimos cargar los pedidos</Alert.Title>
            <Alert.Description>{messageFrom(ordersQuery.error)}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : (
        <Table className="inventory-products-table orders-table">
          <Table.ScrollContainer>
            <Table.Content
              aria-label="Pedidos del CRM"
              selectionMode="multiple"
              selectedKeys={currentPageSelection}
              onSelectionChange={updatePageSelection}
            >
              <Table.Header>
                <Table.Column id="selection" className="inventory-selection-column">
                  <Checkbox
                    slot="selection"
                    aria-label="Seleccionar todos los pedidos de esta página"
                  >
                    <Checkbox.Content>
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                    </Checkbox.Content>
                  </Checkbox>
                </Table.Column>
                <Table.Column isRowHeader>Orden</Table.Column>
                <Table.Column>Cliente</Table.Column>
                <Table.Column>Tienda</Table.Column>
                <Table.Column>Origen</Table.Column>
                <Table.Column>Estado</Table.Column>
                <Table.Column>Sincronización</Table.Column>
                <Table.Column>Total</Table.Column>
                <Table.Column>Fecha</Table.Column>
                <Table.Column className="inventory-actions-column">Acciones</Table.Column>
              </Table.Header>
              <Table.Body
                renderEmptyState={() =>
                  ordersQuery.isPending ? (
                    <div className="orders-empty">
                      <Spinner />
                      <span>Cargando pedidos…</span>
                    </div>
                  ) : (
                    <EmptyState className="orders-empty">
                      <ShoppingCart width={28} height={28} />
                      <strong>No encontramos pedidos</strong>
                      <span>Crea una operación o cambia los filtros.</span>
                    </EmptyState>
                  )
                }
              >
                {(result?.data ?? []).map((order) => (
                  <Table.Row key={order.id} id={order.id}>
                    <Table.Cell className="inventory-selection-cell">
                      <Checkbox
                        slot="selection"
                        aria-label={`Seleccionar orden ${order.wooOrderId ?? order.id}`}
                        variant="secondary"
                      >
                        <Checkbox.Content>
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                        </Checkbox.Content>
                      </Checkbox>
                    </Table.Cell>
                    <Table.Cell onClick={stopRowSelection} onPointerDown={stopRowSelection}>
                      <strong className="order-code" title={String(order.wooOrderId ?? order.id)}>
                        #{order.wooOrderId ?? order.id}
                      </strong>
                    </Table.Cell>
                    <Table.Cell onClick={stopRowSelection} onPointerDown={stopRowSelection}>
                      <div className="order-customer-cell">
                        <strong>{order.customer.displayName}</strong>
                        <span>{order.customer.email || '--'}</span>
                      </div>
                    </Table.Cell>
                    <Table.Cell onClick={stopRowSelection} onPointerDown={stopRowSelection}>
                      <StoreChip store={order.store} />
                    </Table.Cell>
                    <Table.Cell onClick={stopRowSelection} onPointerDown={stopRowSelection}>
                      {order.source === 'CRM' ? 'CRM' : 'WooCommerce'}
                    </Table.Cell>
                    <Table.Cell onClick={stopRowSelection} onPointerDown={stopRowSelection}>
                      <OrderStatusChip status={order.status} wooStatus={order.wooStatus} />
                    </Table.Cell>
                    <Table.Cell onClick={stopRowSelection} onPointerDown={stopRowSelection}>
                      <Chip color={syncStatusMeta[order.syncStatus].color}>
                        {syncStatusMeta[order.syncStatus].label}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell onClick={stopRowSelection} onPointerDown={stopRowSelection}>
                      <strong className="order-total">
                        {formattedMoneyWithCode(order.total, order.currency)}
                      </strong>
                    </Table.Cell>
                    <Table.Cell onClick={stopRowSelection} onPointerDown={stopRowSelection}>
                      <span className="order-date">
                        {formattedDate(order.wooCreatedAt ?? order.createdAt)}
                      </span>
                    </Table.Cell>
                    <Table.Cell onClick={stopRowSelection} onPointerDown={stopRowSelection}>
                      <div className="inventory-row-actions">
                        <Dropdown>
                          <Button
                            className="inventory-actions-trigger"
                            isIconOnly
                            size="sm"
                            variant="ghost"
                            aria-label={`Acciones para la orden ${order.wooOrderId ?? order.id}`}
                          >
                            <EllipsisVertical width={17} height={17} />
                          </Button>
                          <Dropdown.Popover
                            className="inventory-actions-popover"
                            placement="bottom end"
                          >
                            <Dropdown.Menu
                              aria-label={`Acciones para la orden ${order.wooOrderId ?? order.id}`}
                              onAction={(key) => {
                                if (key === 'view')
                                  setSelected({
                                    operationId: order.operationId,
                                    store: order.store,
                                  });
                                if (key === 'edit') openEdit(order.operationId);
                                if (key === 'complete') setCompleteTarget(order);
                                if (key === 'retry') void retryOrderSync(order);
                                if (key === 'delete') setDeleteTarget(order);
                                if (key === 'shipment') {
                                  // Logística asigna el envío, pero solo cuando la operación ya lo
                                  // admite; si no, la acción muestra los datos en solo lectura.
                                  updateShipment.reset();
                                  setActionTarget({
                                    kind:
                                      canAssignShipping && allowsShipment(order)
                                        ? 'shipment-form'
                                        : 'shipment-view',
                                    operationId: order.operationId,
                                  });
                                }
                              }}
                            >
                              <Dropdown.Section>
                                <Dropdown.Item id="shipment" textValue="Envío">
                                  <Car className="size-4 shrink-0 text-muted" />
                                  <Label>Envío</Label>
                                </Dropdown.Item>
                              </Dropdown.Section>
                              <Separator />
                              <Dropdown.Section>
                                <Dropdown.Item id="view" textValue="Ver pedido">
                                  <Eye className="size-4 shrink-0 text-muted" />
                                  <Label>Ver pedido</Label>
                                </Dropdown.Item>
                                {canManage && order.status === 'PENDING' && (
                                  <Dropdown.Item id="edit" textValue="Editar pedido">
                                    <Pencil className="size-4 shrink-0 text-muted" />
                                    <Label>Editar</Label>
                                  </Dropdown.Item>
                                )}
                                {canManage &&
                                  order.source === 'CRM' &&
                                  order.status === 'PENDING' && (
                                    <Dropdown.Item id="complete" textValue="Completar operación">
                                      <Check className="size-4 shrink-0 text-success" />
                                      <Label>Completar</Label>
                                    </Dropdown.Item>
                                  )}
                                {canManage &&
                                  order.source === 'CRM' &&
                                  order.status === 'COMPLETED' &&
                                  order.syncStatus === 'ERROR' && (
                                    <Dropdown.Item
                                      id="retry"
                                      textValue="Reintentar sincronización Woo"
                                    >
                                      <ArrowRotateRight className="size-4 shrink-0 text-muted" />
                                      <Label>Reintentar sincronización Woo</Label>
                                    </Dropdown.Item>
                                  )}
                              </Dropdown.Section>
                              {canManage && (
                                <>
                                  <Separator />
                                  <Dropdown.Section>
                                    {/* Sin funcionalidad todavía: hay que ajustar la petición antes
                                        de habilitar la creación de cotizaciones en Siigo. */}
                                    <Dropdown.Item
                                      id="siigo-quotation"
                                      textValue="Cotización Siigo"
                                      isDisabled
                                    >
                                      <FileText className="size-4 shrink-0 text-muted" />
                                      <Label>Cotización Siigo</Label>
                                    </Dropdown.Item>
                                    {/* Todavía sin funcionalidad: se activará más adelante. */}
                                    <Dropdown.Item
                                      id="colombia-points"
                                      textValue="Puntos Colombia"
                                      isDisabled
                                    >
                                      <Gift className="size-4 shrink-0 text-muted" />
                                      <Label>Puntos Colombia</Label>
                                    </Dropdown.Item>
                                  </Dropdown.Section>
                                </>
                              )}
                              {isAdmin && (
                                <>
                                  <Separator />
                                  <Dropdown.Section>
                                    <Dropdown.Item
                                      id="delete"
                                      textValue="Eliminar pedido"
                                      variant="danger"
                                    >
                                      <TrashBin className="size-4 shrink-0 text-danger" />
                                      <Label>Eliminar</Label>
                                    </Dropdown.Item>
                                  </Dropdown.Section>
                                </>
                              )}
                            </Dropdown.Menu>
                          </Dropdown.Popover>
                        </Dropdown>
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
          {(result?.data.length ?? 0) > 0 && (
            <Table.Footer>
              <Pagination aria-label="Paginación de pedidos">
                <Pagination.Summary>
                  <span className="customers-page-size-control">
                    Filas por página
                    <Select
                      className="customers-page-size"
                      value={String(filters.pageSize)}
                      aria-label="Filas por página"
                      onChange={(value) =>
                        setFilters((current) => ({ ...current, pageSize: Number(value), page: 1 }))
                      }
                    >
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {[10, 20, 50, 100].map((size) => (
                            <ListBox.Item key={size} id={String(size)}>
                              {size}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </span>
                </Pagination.Summary>
                <Pagination.Content>
                  <Pagination.Item>
                    <Pagination.Previous
                      isDisabled={filters.page <= 1 || ordersQuery.isFetching}
                      onPress={() =>
                        setFilters((current) => ({ ...current, page: current.page - 1 }))
                      }
                    >
                      <Pagination.PreviousIcon />
                      Anterior
                    </Pagination.Previous>
                  </Pagination.Item>
                  {getPaginationItems(filters.page, result?.pagination.totalPages ?? 1).map(
                    (item, index) =>
                      item === 'ellipsis' ? (
                        <Pagination.Item key={`ellipsis-${index}`}>
                          <Pagination.Ellipsis />
                        </Pagination.Item>
                      ) : (
                        <Pagination.Item key={item}>
                          <Pagination.Link
                            isActive={item === filters.page}
                            onPress={() => setFilters((current) => ({ ...current, page: item }))}
                          >
                            {item}
                          </Pagination.Link>
                        </Pagination.Item>
                      ),
                  )}
                  <Pagination.Item>
                    <Pagination.Next
                      isDisabled={
                        !result ||
                        filters.page >= result.pagination.totalPages ||
                        ordersQuery.isFetching
                      }
                      onPress={() =>
                        setFilters((current) => ({ ...current, page: current.page + 1 }))
                      }
                    >
                      Siguiente
                      <Pagination.NextIcon />
                    </Pagination.Next>
                  </Pagination.Item>
                </Pagination.Content>
              </Pagination>
            </Table.Footer>
          )}
        </Table>
      )}

      {formOpen && (editingId === null || editingQuery.data) && (
        <OrderForm
          key={editingId ?? 'new'}
          isOpen
          order={editingQuery.data ?? null}
          isSubmitting={saveOrder.isPending}
          serverError={saveOrder.isError ? messageFrom(saveOrder.error) : ''}
          onClose={() => {
            setFormOpen(false);
            setEditingId(null);
          }}
          onSubmit={submitOrder}
        />
      )}
      {formOpen && editingId !== null && editingQuery.isPending && (
        <div className="order-edit-loading" aria-label="Cargando pedido">
          <Spinner />
        </div>
      )}

      <Modal isOpen={selected !== null} onOpenChange={(open) => !open && setSelected(null)}>
        <Modal.Backdrop>
          <Modal.Container size="lg" placement="center" scroll="inside">
            <Modal.Dialog className="order-detail-modal">
              <Modal.CloseTrigger aria-label="Cerrar detalle" />
              <Modal.Header>
                <Modal.Heading>
                  {selectedQuery.data?.operationCode ?? 'Detalle del pedido'}
                </Modal.Heading>
              </Modal.Header>
              <Modal.Body>
                {selectedQuery.isPending && (
                  <div className="orders-empty">
                    <Spinner />
                    <span>Cargando pedido…</span>
                  </div>
                )}
                {selectedQuery.isError && (
                  <Alert status="danger">
                    <Alert.Content>
                      <Alert.Description>{messageFrom(selectedQuery.error)}</Alert.Description>
                    </Alert.Content>
                  </Alert>
                )}
                {selected && selectedQuery.data && (
                  <OrderDetail
                    order={selectedQuery.data}
                    store={selected.store}
                    onSelectStore={(store) =>
                      setSelected({ operationId: selected.operationId, store })
                    }
                  />
                )}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {/* Una fila puede pedir datos que todavía no están cargados: el aviso evita el salto en seco.
          La vista de envío no lo necesita porque muestra su propia carga dentro del modal. */}
      {actionTarget && actionTarget.kind !== 'shipment-view' && actionQuery.isPending && (
        <div className="order-edit-loading" aria-label="Cargando pedido">
          <Spinner />
        </div>
      )}

      {actionTarget?.kind === 'shipment-form' && actionQuery.data && (
        <ShipmentModal
          isOpen
          order={actionQuery.data}
          isSubmitting={updateShipment.isPending}
          serverError={updateShipment.isError ? messageFrom(updateShipment.error) : ''}
          onClose={() => setActionTarget(null)}
          onSubmit={saveShipment}
        />
      )}

      {actionTarget?.kind === 'shipment-view' && (
        <ShipmentViewModal isOpen order={actionQuery.data} onClose={() => setActionTarget(null)} />
      )}

      <AlertDialog
        isOpen={completeTarget !== null}
        onOpenChange={(open) => !open && setCompleteTarget(null)}
      >
        <AlertDialog.Backdrop>
          <AlertDialog.Container size="sm">
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Icon status="success">
                  <Check />
                </AlertDialog.Icon>
                <AlertDialog.Heading>Completar operación</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                Se marcará <strong>{completeTarget?.operationCode}</strong> como completada y se
                crearán sus pedidos en Seratus y Pali según corresponda. Después no podrá editarse.
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button
                  variant="ghost"
                  onPress={() => setCompleteTarget(null)}
                  isDisabled={completeOrder.isPending}
                >
                  Cancelar
                </Button>
                <Button
                  variant="primary"
                  onPress={() => void confirmOrder()}
                  isPending={completeOrder.isPending}
                >
                  Completar
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>

      <AlertDialog
        isOpen={deleteTarget !== null}
        onOpenChange={(open) => !open && setDeleteTarget(null)}
      >
        <AlertDialog.Backdrop>
          <AlertDialog.Container size="sm">
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger">
                  <TrashBin />
                </AlertDialog.Icon>
                <AlertDialog.Heading>Eliminar pedido</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                Se eliminará definitivamente la operación{' '}
                <strong>{deleteTarget?.operationCode}</strong> y todos sus pedidos asociados del CRM
                local. Los pedidos ya creados en WooCommerce no se eliminarán.
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button
                  variant="ghost"
                  onPress={() => setDeleteTarget(null)}
                  isDisabled={deleteOrder.isPending}
                >
                  Cancelar
                </Button>
                <Button
                  variant="danger"
                  onPress={() => void removeOrder()}
                  isPending={deleteOrder.isPending}
                >
                  Eliminar
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </section>
  );
}
