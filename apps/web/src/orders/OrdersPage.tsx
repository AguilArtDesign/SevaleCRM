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
import { useCurrentUser } from '../users/useCurrentUser';
import { OrderForm } from './OrderForm';
import { ShipmentModal } from './ShipmentModal';
import { SiigoQuotationModal } from './SiigoQuotationModal';
import {
  ordersApi,
  type OrderDetailRecord,
  type OrderListInput,
  type OrderListRecord,
  type OrderStatus,
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

const statusMeta: Record<OrderStatus, { label: string; color: 'warning' | 'success' | 'danger' }> =
  {
    PENDING: { label: 'Pendiente', color: 'warning' },
    COMPLETED: { label: 'Completada', color: 'success' },
    CANCELLED: { label: 'Cancelada', color: 'danger' },
  };

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'No pudimos completar la solicitud.';
}

function formattedMoney(value: string, currency: string): string {
  return new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency,
    minimumFractionDigits: currency === 'COP' ? 0 : 2,
  }).format(Number(value));
}

function formattedMoneyWithCode(value: string, currency: string): string {
  const amount = new Intl.NumberFormat('es-CO', {
    style: 'currency',
    currency,
    currencyDisplay: 'narrowSymbol',
    minimumFractionDigits: 0,
    maximumFractionDigits: currency === 'COP' ? 0 : 2,
  }).format(Number(value));

  return `${amount} ${currency}`;
}

function formattedDate(value: string): string {
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function stopRowSelection(event: { stopPropagation: () => void }) {
  event.stopPropagation();
}

function OrderStatusChip({ status }: { status: OrderStatus }) {
  const meta = statusMeta[status];
  return <Chip color={meta.color}>{meta.label}</Chip>;
}

const syncStatusMeta = {
  PENDING: { label: 'Pendiente', color: 'warning' as const },
  SYNCING: { label: 'Sincronizando', color: 'accent' as const },
  SYNCED: { label: 'Sincronizado', color: 'success' as const },
  ERROR: { label: 'Error', color: 'danger' as const },
};

function StoreChip({ store }: Pick<OrderListRecord, 'store'>) {
  return (
    <Chip
      className={store === 'SERATUS' ? 'inventory-store-chip-seratus' : 'inventory-store-chip-pali'}
    >
      {store === 'SERATUS' ? 'Seratus' : 'Pali'}
    </Chip>
  );
}

function OrderDetail({
  order,
  canUpdateShipment,
  canCreateSiigoQuotation,
  onEditShipment,
  onRetryShipment,
  onCreateSiigoQuotation,
  isRetryingShipment,
  isCreatingSiigoQuotation,
}: {
  order: OrderDetailRecord;
  canUpdateShipment: boolean;
  canCreateSiigoQuotation: boolean;
  onEditShipment: () => void;
  onRetryShipment: () => void;
  onCreateSiigoQuotation: () => void;
  isRetryingShipment: boolean;
  isCreatingSiigoQuotation: boolean;
}) {
  const billingAddress = [
    order.billingAddress1,
    order.billingAddress2,
    order.billingCity,
    order.billingState,
    order.billingPostcode,
    order.billingCountry,
  ]
    .filter(Boolean)
    .join(', ');
  const shipmentAllowed =
    order.status === 'COMPLETED' ||
    (order.source === 'WOOCOMMERCE' && order.status !== 'CANCELLED');
  return (
    <div className="order-detail">
      <section className="order-detail-overview">
        <div>
          <span>Estado</span>
          <OrderStatusChip status={order.status} />
        </div>
        <div>
          <span>Origen</span>
          <strong>{order.source === 'CRM' ? 'CRM' : 'WooCommerce'}</strong>
        </div>
        <div>
          <span>Cliente</span>
          <strong>{order.customer.displayName}</strong>
          <small>{order.customer.documentNumber}</small>
        </div>
        <div>
          <span>Creado por</span>
          <strong>{order.createdBy.name}</strong>
          <small>{formattedDate(order.createdAt)}</small>
        </div>
      </section>
      <section className="order-detail-section">
        <h3>Facturación y entrega</h3>
        <p>
          <strong>
            {[order.billingFirstName, order.billingLastName].filter(Boolean).join(' ') ||
              order.billingCompany ||
              '--'}
          </strong>
        </p>
        <p>{billingAddress || 'Sin dirección registrada'}</p>
        <p>
          {order.billingEmail || '--'} · {order.billingPhone || '--'}
        </p>
      </section>
      <section className="order-detail-section">
        <h3>Pedidos por tienda</h3>
        <div className="order-detail-stores">
          {order.orders.map((storeOrder) => (
            <article key={storeOrder.id}>
              <header>
                <div className="order-detail-store-heading">
                  <Chip
                    className={
                      storeOrder.store === 'SERATUS'
                        ? 'inventory-store-chip-seratus'
                        : 'inventory-store-chip-pali'
                    }
                  >
                    {storeOrder.store === 'SERATUS' ? 'Seratus' : 'Pali'}
                  </Chip>
                  <Chip color={syncStatusMeta[storeOrder.syncStatus].color}>
                    {syncStatusMeta[storeOrder.syncStatus].label}
                  </Chip>
                </div>
                <strong>{formattedMoney(storeOrder.total, order.currency)}</strong>
              </header>
              {storeOrder.wooOrderId && <p>WooCommerce #{storeOrder.wooOrderId}</p>}
              {storeOrder.wooStatus && (
                <p>
                  Estado en WooCommerce: <strong>{storeOrder.wooStatus}</strong>
                </p>
              )}
              {storeOrder.lastSyncErrorMessage && (
                <p className="order-sync-error">{storeOrder.lastSyncErrorMessage}</p>
              )}
              {storeOrder.items.map((item) => (
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
                  <dd>{formattedMoney(storeOrder.subtotal, order.currency)}</dd>
                </div>
                <div>
                  <dt>Descuento</dt>
                  <dd>- {formattedMoney(storeOrder.discountTotal, order.currency)}</dd>
                </div>
                <div>
                  <dt>Envío</dt>
                  <dd>{formattedMoney(storeOrder.shippingTotal, order.currency)}</dd>
                </div>
              </dl>
            </article>
          ))}
        </div>
      </section>
      <section className="order-detail-section">
        <div className="order-section-heading">
          <h3>Cotización Siigo</h3>
          {canCreateSiigoQuotation &&
            order.status !== 'CANCELLED' &&
            !order.siigoQuotation?.externalId &&
            order.siigoQuotation?.status !== 'SYNCING' && (
              <Button size="sm" variant="secondary" onPress={onCreateSiigoQuotation}>
                <FileText width={15} />
                {order.siigoQuotation?.status === 'ERROR' ? 'Reintentar' : 'Crear cotización'}
              </Button>
            )}
        </div>
        {order.siigoQuotation ? (
          <div className="siigo-quotation-detail">
            <div>
              <strong>{order.siigoQuotation.name || 'Cotización pendiente'}</strong>
              <Chip
                color={
                  order.siigoQuotation.status === 'SYNCED'
                    ? 'success'
                    : order.siigoQuotation.status === 'ERROR'
                      ? 'danger'
                      : 'accent'
                }
              >
                {order.siigoQuotation.status === 'SYNCED'
                  ? 'Creada'
                  : order.siigoQuotation.status === 'ERROR'
                    ? 'Error'
                    : 'Creando'}
              </Chip>
            </div>
            {order.siigoQuotation.number && <p>Número {order.siigoQuotation.number}</p>}
            {order.siigoQuotation.syncedAt && (
              <p>Creada el {formattedDate(order.siigoQuotation.syncedAt)}</p>
            )}
            {order.siigoQuotation.errorMessage && (
              <p className="order-sync-error">{order.siigoQuotation.errorMessage}</p>
            )}
            {order.siigoQuotation.url && (
              <a href={order.siigoQuotation.url} target="_blank" rel="noreferrer">
                Ver cotización en Siigo
              </a>
            )}
          </div>
        ) : (
          <p>La operación todavía no tiene una cotización en Siigo.</p>
        )}
        {isCreatingSiigoQuotation && <p>Creando cotización…</p>}
      </section>
      <section className="order-detail-section">
        <div className="order-section-heading">
          <h3>Envío</h3>
          <div>
            {canUpdateShipment &&
              order.shipment?.storeSyncs.some(({ syncStatus }) => syncStatus === 'ERROR') && (
                <Button
                  size="sm"
                  variant="ghost"
                  onPress={onRetryShipment}
                  isPending={isRetryingShipment}
                >
                  <ArrowRotateRight width={15} />
                  Reintentar
                </Button>
              )}
            {canUpdateShipment && shipmentAllowed && (
              <Button size="sm" variant="secondary" onPress={onEditShipment}>
                <Car width={15} />
                {order.shipment ? 'Actualizar' : 'Asignar envío'}
              </Button>
            )}
          </div>
        </div>
        {order.shipment ? (
          <div className="shipment-detail">
            <dl>
              <div>
                <dt>Transportadora</dt>
                <dd>{order.shipment.carrier}</dd>
              </div>
              <div>
                <dt>Número de guía</dt>
                <dd>{order.shipment.trackingNumber}</dd>
              </div>
              <div>
                <dt>Estado</dt>
                <dd>{order.shipment.status}</dd>
              </div>
            </dl>
            {order.shipment.storeSyncs.length > 0 && (
              <div className="shipment-store-syncs">
                {order.shipment.storeSyncs.map((sync) => (
                  <div key={sync.id}>
                    <strong>{sync.store === 'SERATUS' ? 'Seratus' : 'Pali'}</strong>
                    <Chip color={syncStatusMeta[sync.syncStatus].color}>
                      {syncStatusMeta[sync.syncStatus].label}
                    </Chip>
                    {sync.lastSyncErrorMessage && <span>{sync.lastSyncErrorMessage}</span>}
                  </div>
                ))}
              </div>
            )}
            {order.shipment.events.length > 0 && (
              <div className="shipment-history">
                <strong>Historial</strong>
                {order.shipment.events.map((event) => (
                  <div key={event.id}>
                    <span>{event.status}</span>
                    <small>
                      {formattedDate(event.createdAt)}
                      {event.createdBy ? ` · ${event.createdBy.name}` : ''}
                    </small>
                    {event.note && <p>{event.note}</p>}
                  </div>
                ))}
              </div>
            )}
          </div>
        ) : (
          <p>La operación todavía no tiene información de envío.</p>
        )}
      </section>
      <section className="order-detail-total">
        <span>Total de la operación</span>
        <strong>{formattedMoney(order.total, order.currency)}</strong>
      </section>
    </div>
  );
}

export function OrdersPage() {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const canManage = user?.role === 'ADMIN' || user?.role === 'COMMERCIAL';
  const canUpdateShipment =
    user?.role === 'ADMIN' || user?.role === 'COMMERCIAL' || user?.role === 'LOGISTICS';
  const isAdmin = user?.role === 'ADMIN';
  const [searchDraft, setSearchDraft] = useState('');
  const [filters, setFilters] = useState<OrderListInput>(initialFilters);
  const [formOpen, setFormOpen] = useState(false);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<OrderListRecord | null>(null);
  const [completeTarget, setCompleteTarget] = useState<OrderListRecord | null>(null);
  const [shipmentOpen, setShipmentOpen] = useState(false);
  const [siigoQuotationOpen, setSiigoQuotationOpen] = useState(false);

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
      if (selectedId === order.id) setSelectedId(null);
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
      setShipmentOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
  const retryShipment = useMutation({
    mutationFn: (id: number) => ordersApi.retryShipmentSync(id),
    onSuccess: async (order) => {
      queryClient.setQueryData(['orders', 'detail', order.id], order);
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });
  const createSiigoQuotation = useMutation({
    mutationFn: ({
      id,
      input,
    }: {
      id: number;
      input: Parameters<typeof ordersApi.createSiigoQuotation>[1];
    }) => ordersApi.createSiigoQuotation(id, input),
    onSuccess: async (order) => {
      queryClient.setQueryData(['orders', 'detail', order.id], order);
      setSiigoQuotationOpen(false);
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

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
    if (!selectedId) return;
    try {
      await updateShipment.mutateAsync({ id: selectedId, input });
      toast.success('Información de envío guardada.');
    } catch (error) {
      toast.danger(messageFrom(error));
      throw error;
    }
  };
  const retryShipmentSynchronization = async () => {
    if (!selectedId || retryShipment.isPending) return;
    try {
      const order = await retryShipment.mutateAsync(selectedId);
      const failures = order.shipment?.storeSyncs.filter(
        ({ syncStatus }) => syncStatus === 'ERROR',
      ).length;
      if (failures) toast.warning('Una tienda todavía requiere atención.');
      else toast.success('Información de envío sincronizada.');
    } catch (error) {
      toast.danger(messageFrom(error));
    }
  };
  const saveSiigoQuotation = async (
    input: Parameters<typeof ordersApi.createSiigoQuotation>[1],
  ) => {
    if (!selectedId) return;
    try {
      const order = await createSiigoQuotation.mutateAsync({ id: selectedId, input });
      if (order.siigoQuotation?.status === 'SYNCED') {
        toast.success('Cotización creada en Siigo.');
      } else {
        toast.warning(order.siigoQuotation?.errorMessage || 'Siigo requiere atención.');
      }
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
                      <OrderStatusChip status={order.status} />
                      {order.wooStatus && (
                        <div>
                          <small className="text-muted">WooCommerce: {order.wooStatus}</small>
                        </div>
                      )}
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
                      <span className="order-date">{formattedDate(order.createdAt)}</span>
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
                                if (key === 'view') setSelectedId(order.operationId);
                                if (key === 'edit') openEdit(order.operationId);
                                if (key === 'complete') setCompleteTarget(order);
                                if (key === 'retry') void retryOrderSync(order);
                                if (key === 'delete') setDeleteTarget(order);
                              }}
                            >
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
                              {isAdmin && <Separator />}
                              {isAdmin && (
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

      <Modal isOpen={selectedId !== null} onOpenChange={(open) => !open && setSelectedId(null)}>
        <Modal.Backdrop>
          <Modal.Container size="lg" placement="center" scroll="inside">
            <Modal.Dialog className="order-detail-modal">
              <Modal.CloseTrigger aria-label="Cerrar detalle" />
              <Modal.Header>
                <div>
                  <Modal.Heading>
                    {selectedQuery.data?.operationCode ?? 'Detalle del pedido'}
                  </Modal.Heading>
                  <p>Información local de la operación y sus tiendas.</p>
                </div>
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
                {selectedQuery.data && (
                  <OrderDetail
                    order={selectedQuery.data}
                    canUpdateShipment={canUpdateShipment}
                    canCreateSiigoQuotation={canManage}
                    onEditShipment={() => {
                      updateShipment.reset();
                      setShipmentOpen(true);
                    }}
                    onRetryShipment={() => void retryShipmentSynchronization()}
                    onCreateSiigoQuotation={() => {
                      createSiigoQuotation.reset();
                      setSiigoQuotationOpen(true);
                    }}
                    isRetryingShipment={retryShipment.isPending}
                    isCreatingSiigoQuotation={createSiigoQuotation.isPending}
                  />
                )}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {shipmentOpen && selectedQuery.data && (
        <ShipmentModal
          isOpen
          order={selectedQuery.data}
          isSubmitting={updateShipment.isPending}
          serverError={updateShipment.isError ? messageFrom(updateShipment.error) : ''}
          onClose={() => setShipmentOpen(false)}
          onSubmit={saveShipment}
        />
      )}

      {siigoQuotationOpen && selectedQuery.data && (
        <SiigoQuotationModal
          isOpen
          order={selectedQuery.data}
          isSubmitting={createSiigoQuotation.isPending}
          serverError={createSiigoQuotation.isError ? messageFrom(createSiigoQuotation.error) : ''}
          onClose={() => setSiigoQuotationOpen(false)}
          onSubmit={saveSiigoQuotation}
        />
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
