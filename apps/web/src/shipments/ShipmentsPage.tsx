import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  DateField,
  DateRangePicker,
  EmptyState,
  ListBox,
  RangeCalendar,
  SearchField,
  Spinner,
  Table,
} from '@heroui/react';
import type { RangeValue } from '@react-types/shared';
import type { CalendarDate } from '@internationalized/date';
import { ArrowRotateRight, ArrowUpRightFromSquare, Car, Clock, Eye } from '@gravity-ui/icons';
import { resolveShipmentStatus, shipmentStatusCatalog } from '@sevale/shared';
import { hasPermission } from '@sevale/permissions';
import type { UpdateShipmentInput } from '@sevale/validation';
import { Chip } from '../components/Chip';
import { getPaginationItems, Pagination } from '../components/Pagination';
import { Select } from '../components/Select';
import { ordersApi } from '../orders/api';
import type { OrderSyncStatus } from '../orders/api';
import { formattedDate, formattedMoneyWithCode, StoreChip } from '../orders/presentation';
import { ShipmentModal } from '../orders/ShipmentModal';
import { ShipmentViewModal } from '../orders/ShipmentViewModal';
import { useCurrentUser } from '../users/useCurrentUser';
import { shipmentsApi, type ShipmentBoardFilters, type ShipmentBoardRow } from './api';
import { ShipmentHistoryModal } from './ShipmentHistoryModal';

type ActionTarget =
  | { kind: 'edit'; operationId: number }
  | { kind: 'view'; operationId: number }
  | { kind: 'history'; operationId: number };

type ShipmentDateRange = RangeValue<CalendarDate> | null;

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'No pudimos completar la solicitud.';
}

/**
 * Color del chip de sincronización por tienda. Solo `SYNCED` es verde: pintar en verde lo que
 * todavía está en cola daba por hecho un envío que la tienda aún no conoce.
 */
function syncChipColor(status: OrderSyncStatus): 'success' | 'warning' | 'danger' {
  if (status === 'SYNCED') return 'success';
  if (status === 'ERROR') return 'danger';
  return 'warning';
}

/** Qué está pasando con la sincronización de esa tienda, para el tooltip del chip. */
function syncDescription(sync: {
  syncStatus: OrderSyncStatus;
  errorMessage: string | null;
}): string {
  if (sync.syncStatus === 'ERROR') return sync.errorMessage || 'La tienda rechazó la guía.';
  if (sync.syncStatus === 'SYNCED') return 'Guía sincronizada con la tienda.';
  if (sync.syncStatus === 'SYNCING') return 'Sincronizando con la tienda…';
  return 'Pendiente de sincronizar.';
}

/**
 * Panel de Envíos: la cola de despacho. Cada fila es una **operación** completada y con cotización
 * creada en Siigo, no un pedido de tienda: la cotización y el envío son uno por operación, y una
 * operación con productos de las dos tiendas aparecería dos veces si se partiera del pedido.
 *
 * Aquí se asigna la guía y se lee la novedad más reciente. Escribir el envío sigue pasando por el
 * endpoint de Pedidos, que es donde vive la regla de qué operación puede llevarlo.
 */
export function ShipmentsPage() {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  // Asignar guía es de logística; quien no lo tenga solo consulta.
  const canAssign = Boolean(user && hasPermission(user.role, 'orders.shipping.update'));
  const [searchDraft, setSearchDraft] = useState('');
  const [dateRange, setDateRange] = useState<ShipmentDateRange>(null);
  const [filters, setFilters] = useState<ShipmentBoardFilters>({
    search: '',
    status: '',
    guide: 'all',
    dateFrom: null,
    dateTo: null,
    page: 1,
    pageSize: 20,
  });
  const [target, setTarget] = useState<ActionTarget | null>(null);

  const shipmentsQuery = useQuery({
    queryKey: ['shipments', filters],
    queryFn: () => shipmentsApi.list(filters),
  });
  const result = shipmentsQuery.data;

  // El detalle trae lo que el modal de envío necesita: la operación con sus pedidos y su envío.
  const detailQuery = useQuery({
    queryKey: ['orders', 'detail', target?.operationId],
    queryFn: () => ordersApi.detail(target!.operationId),
    // El historial carga su propia bitácora, así que no necesita el detalle completo del pedido.
    enabled: target !== null && target.kind !== 'history',
  });

  const saveShipment = useMutation({
    mutationFn: (input: UpdateShipmentInput) =>
      ordersApi.updateShipment(target!.operationId, input),
    onSuccess: async () => {
      setTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['shipments'] });
      await queryClient.invalidateQueries({ queryKey: ['orders'] });
    },
  });

  const retrySync = useMutation({
    mutationFn: (row: ShipmentBoardRow) => ordersApi.retryShipmentSync(row.operationId),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['shipments'] });
    },
  });

  const totalPages = result?.pagination.totalPages ?? 1;
  const page = filters.page;

  /** El calendario devuelve días; el listado compara contra el instante, así que se abre a la jornada. */
  const applyDateRange = (value: ShipmentDateRange) => {
    setDateRange(value);
    setFilters((current) => ({
      ...current,
      dateFrom: value ? new Date(`${value.start.toString()}T00:00:00`) : null,
      dateTo: value ? new Date(`${value.end.toString()}T23:59:59`) : null,
      page: 1,
    }));
  };

  return (
    <section className="shipments-layout">
      <header className="shipments-heading">
        <div>
          <h2>Envíos</h2>
          <Chip>{result?.pagination.total ?? 0}</Chip>
        </div>
        {((result?.pending ?? 0) > 0 || filters.guide === 'pending') && (
          <Button
            // El contador es también el atajo a la cola: al pulsarlo se filtra por lo que no tiene
            // guía, y al volver a pulsarlo se quita el filtro. Sin esto no habría forma de salir.
            variant={filters.guide === 'pending' ? 'primary' : 'outline'}
            onPress={() => {
              setFilters((current) => ({
                ...current,
                guide: current.guide === 'pending' ? 'all' : 'pending',
                page: 1,
              }));
            }}
          >
            {filters.guide === 'pending' ? 'Ver todos' : `${result?.pending ?? 0} sin guía`}
          </Button>
        )}
      </header>

      <div className="shipments-toolbar">
        <div className="shipments-filters">
          <Select
            aria-label="Filtrar por estado del envío"
            value={filters.status || 'all'}
            variant="secondary"
            onChange={(value) => {
              const selected = String(value);
              setFilters((current) => ({
                ...current,
                status: selected === 'all' ? '' : selected,
                page: 1,
              }));
            }}
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="all">Todos los estados</ListBox.Item>
                {shipmentStatusCatalog.map((entry) => (
                  <ListBox.Item key={entry.code} id={entry.code}>
                    {entry.label}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>

          <DateRangePicker
            className="shipments-date-range"
            aria-label="Filtrar por fecha de creación"
            value={dateRange}
            onChange={applyDateRange}
          >
            <DateField.Group variant="secondary">
              <DateField.Input slot="start">
                {(segment) => <DateField.Segment segment={segment} />}
              </DateField.Input>
              <DateRangePicker.RangeSeparator />
              <DateField.Input slot="end">
                {(segment) => <DateField.Segment segment={segment} />}
              </DateField.Input>
              <DateField.Suffix>
                <DateRangePicker.Trigger>
                  <DateRangePicker.TriggerIndicator />
                </DateRangePicker.Trigger>
              </DateField.Suffix>
            </DateField.Group>
            <DateRangePicker.Popover>
              <RangeCalendar aria-label="Rango de fechas de creación del envío">
                <RangeCalendar.Header>
                  <RangeCalendar.YearPickerTrigger>
                    <RangeCalendar.YearPickerTriggerHeading />
                    <RangeCalendar.YearPickerTriggerIndicator />
                  </RangeCalendar.YearPickerTrigger>
                  <RangeCalendar.NavButton slot="previous" />
                  <RangeCalendar.NavButton slot="next" />
                </RangeCalendar.Header>
                <RangeCalendar.Grid>
                  <RangeCalendar.GridHeader>
                    {(day) => <RangeCalendar.HeaderCell>{day}</RangeCalendar.HeaderCell>}
                  </RangeCalendar.GridHeader>
                  <RangeCalendar.GridBody>
                    {(date) => <RangeCalendar.Cell date={date} />}
                  </RangeCalendar.GridBody>
                </RangeCalendar.Grid>
                <RangeCalendar.YearPickerGrid>
                  <RangeCalendar.YearPickerGridBody>
                    {({ year }) => <RangeCalendar.YearPickerCell year={year} />}
                  </RangeCalendar.YearPickerGridBody>
                </RangeCalendar.YearPickerGrid>
              </RangeCalendar>
            </DateRangePicker.Popover>
          </DateRangePicker>
        </div>

        <SearchField
          className="shipments-search"
          value={searchDraft}
          onChange={(value) => {
            setSearchDraft(value);
            setFilters((current) => ({ ...current, search: value.trim(), page: 1 }));
          }}
          onClear={() => {
            setSearchDraft('');
            setFilters((current) => ({ ...current, search: '', page: 1 }));
          }}
          aria-label="Buscar envíos"
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Orden, cliente, guía, cotización…" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
      </div>

      {shipmentsQuery.isError ? (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Title>No pudimos cargar los envíos</Alert.Title>
            <Alert.Description>{messageFrom(shipmentsQuery.error)}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : (
        <Table className="inventory-products-table orders-table">
          <Table.ScrollContainer>
            <Table.Content aria-label="Envíos por despachar">
              <Table.Header>
                <Table.Column isRowHeader>Orden</Table.Column>
                <Table.Column>Cliente</Table.Column>
                <Table.Column>Tienda</Table.Column>
                <Table.Column>Cotización</Table.Column>
                <Table.Column>Guía</Table.Column>
                <Table.Column>Transportadora</Table.Column>
                <Table.Column>Estado</Table.Column>
                <Table.Column>Sincronización</Table.Column>
                <Table.Column>Última novedad</Table.Column>
                <Table.Column>Total</Table.Column>
                <Table.Column>Fecha</Table.Column>
                <Table.Column aria-label="Acciones">{''}</Table.Column>
              </Table.Header>
              <Table.Body
                renderEmptyState={() =>
                  shipmentsQuery.isPending ? (
                    <div className="orders-empty">
                      <Spinner />
                      <span>Cargando envíos…</span>
                    </div>
                  ) : (
                    <EmptyState className="orders-empty">
                      <Car width={28} height={28} />
                      <strong>No hay envíos por despachar</strong>
                      <span>
                        Aparecen las operaciones completadas que ya tienen cotización en Siigo.
                      </span>
                    </EmptyState>
                  )
                }
              >
                {(result?.data ?? []).map((row) => {
                  const status = resolveShipmentStatus(row.shipment?.status);
                  const failedSync = row.shipment?.syncs.find(
                    ({ syncStatus }) => syncStatus === 'ERROR',
                  );
                  return (
                    <Table.Row key={row.operationId} id={row.operationId}>
                      <Table.Cell>
                        <strong className="order-code">{row.operationCode}</strong>
                      </Table.Cell>
                      <Table.Cell>
                        <div className="order-customer-cell">
                          <strong>{row.customer.displayName}</strong>
                          <span>{row.customer.documentNumber || row.customer.email || '--'}</span>
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <div className="shipment-stores-cell">
                          {row.stores.map((store) => (
                            <StoreChip key={store} store={store} />
                          ))}
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        {row.quotation?.url ? (
                          <a
                            className="order-quotation-link"
                            href={row.quotation.url}
                            target="_blank"
                            rel="noreferrer"
                            title={`Abrir la cotización ${row.quotation.name} en Siigo`}
                          >
                            {row.quotation.name}
                            <ArrowUpRightFromSquare width={14} height={14} aria-hidden="true" />
                          </a>
                        ) : (
                          <span className="order-quotation-name">{row.quotation?.name ?? '—'}</span>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        {row.shipment?.trackingNumber ? (
                          <strong className="order-code">{row.shipment.trackingNumber}</strong>
                        ) : (
                          <Chip color="warning">Sin guía</Chip>
                        )}
                      </Table.Cell>
                      <Table.Cell>{row.shipment?.carrier || '—'}</Table.Cell>
                      <Table.Cell>
                        {row.shipment?.status ? (
                          <Chip color={status.color}>{status.label}</Chip>
                        ) : (
                          <span>—</span>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        {row.shipment ? (
                          <div className="shipment-stores-cell">
                            {row.shipment.syncs.map((sync) => (
                              // El motivo del fallo ya viene en el listado: sin mostrarlo, reintentar
                              // es a ciegas. Va en el `title` para no abrir la fila en alto.
                              <span key={sync.store} title={syncDescription(sync)}>
                                <Chip color={syncChipColor(sync.syncStatus)}>
                                  {sync.store === 'SERATUS' ? 'Seratus' : 'Pali'}
                                </Chip>
                              </span>
                            ))}
                          </div>
                        ) : (
                          <span>—</span>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        {row.shipment?.lastEvent?.note ? (
                          <span className="shipment-note" title={row.shipment.lastEvent.note}>
                            {row.shipment.lastEvent.note}
                          </span>
                        ) : (
                          <span>—</span>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        <strong className="order-total">
                          {formattedMoneyWithCode(row.total, row.currency)}
                        </strong>
                      </Table.Cell>
                      <Table.Cell>
                        {/* La fecha de la operación no cambia; `updatedAt` saltaría cada vez que
                            alguien asigna la guía y la columna dejaría de ser una referencia. */}
                        <span className="order-date">{formattedDate(row.createdAt)}</span>
                      </Table.Cell>
                      <Table.Cell>
                        <div className="orders-row-actions">
                          <Button
                            isIconOnly
                            size="sm"
                            variant="ghost"
                            aria-label={
                              canAssign
                                ? `Asignar envío a ${row.operationCode}`
                                : `Ver envío de ${row.operationCode}`
                            }
                            onPress={() =>
                              setTarget({
                                kind: canAssign ? 'edit' : 'view',
                                operationId: row.operationId,
                              })
                            }
                          >
                            {canAssign ? (
                              <Car width={17} height={17} />
                            ) : (
                              <Eye width={17} height={17} />
                            )}
                          </Button>
                          {/* Solo tiene guía lo que ya se despachó: antes no hay bitácora que leer. */}
                          {row.shipment && (
                            <Button
                              isIconOnly
                              size="sm"
                              variant="ghost"
                              aria-label={`Novedades del envío de ${row.operationCode}`}
                              onPress={() =>
                                setTarget({ kind: 'history', operationId: row.operationId })
                              }
                            >
                              <Clock width={17} height={17} />
                            </Button>
                          )}
                          {/* Solo tiene sentido reintentar lo que la tienda rechazó. */}
                          {failedSync && (
                            <Button
                              isIconOnly
                              size="sm"
                              variant="ghost"
                              aria-label={`Reintentar sincronización de ${row.operationCode}`}
                              onPress={() => retrySync.mutate(row)}
                            >
                              <ArrowRotateRight width={17} height={17} />
                            </Button>
                          )}
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
          {(result?.data.length ?? 0) > 0 && (
            <Table.Footer>
              <Pagination aria-label="Paginación de envíos">
                <Pagination.Summary>
                  <span className="customers-page-size-control">
                    Filas por página
                    <Select
                      className="customers-page-size"
                      value={String(filters.pageSize)}
                      aria-label="Filas por página"
                      onChange={(selected) => {
                        setFilters((current) => ({
                          ...current,
                          pageSize: Number(selected),
                          page: 1,
                        }));
                      }}
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
                      isDisabled={page <= 1 || shipmentsQuery.isFetching}
                      onPress={() =>
                        setFilters((current) => ({ ...current, page: current.page - 1 }))
                      }
                    >
                      <Pagination.PreviousIcon />
                      Anterior
                    </Pagination.Previous>
                  </Pagination.Item>
                  {getPaginationItems(page, totalPages).map((item, index) =>
                    item === 'ellipsis' ? (
                      <Pagination.Item key={`ellipsis-${index}`}>
                        <Pagination.Ellipsis />
                      </Pagination.Item>
                    ) : (
                      <Pagination.Item key={item}>
                        <Pagination.Link
                          isActive={item === page}
                          isDisabled={shipmentsQuery.isFetching}
                          onPress={() => setFilters((current) => ({ ...current, page: item }))}
                        >
                          {item}
                        </Pagination.Link>
                      </Pagination.Item>
                    ),
                  )}
                  <Pagination.Item>
                    <Pagination.Next
                      isDisabled={page >= totalPages || shipmentsQuery.isFetching}
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

      {target?.kind === 'edit' && (
        <ShipmentModal
          isOpen
          order={detailQuery.data}
          isSubmitting={saveShipment.isPending}
          serverError={saveShipment.isError ? messageFrom(saveShipment.error) : ''}
          onClose={() => setTarget(null)}
          onSubmit={async (input) => {
            await saveShipment.mutateAsync(input);
          }}
        />
      )}

      {target?.kind === 'view' && (
        <ShipmentViewModal isOpen order={detailQuery.data} onClose={() => setTarget(null)} />
      )}

      {target?.kind === 'history' && (
        <ShipmentHistoryModal operationId={target.operationId} onClose={() => setTarget(null)} />
      )}
    </section>
  );
}
