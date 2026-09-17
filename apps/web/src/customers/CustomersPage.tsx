import { useEffect, useRef, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Selection } from '@heroui/react';
import {
  Alert,
  AlertDialog,
  Avatar,
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
  EllipsisVertical,
  Eye,
  Pencil,
  PersonMagnifier,
  PersonPlus,
  TrashBin,
  Xmark,
} from '@gravity-ui/icons';
import { countryFlagPath, getCountries } from '@sevale/shared';
import { customerDocumentTypes, type CreateCustomerInput } from '@sevale/validation';
import { Chip } from '../components/Chip';
import { getPaginationItems, Pagination } from '../components/Pagination';
import { Select } from '../components/Select';
import { useCurrentUser } from '../users/useCurrentUser';
import { CustomerForm } from './CustomerForm';
import { customerAvatarClass, customerDisplayName, customerInitials } from './presentation';
import { CustomerAutocomplete } from './CustomerAutocomplete';
import { customersApi, type CustomerRecord } from './api';

type Filters = {
  search: string;
  country: string;
  page: number;
  pageSize: number;
  sort: 'displayName' | 'documentNumber' | 'email' | 'country' | 'createdAt';
  order: 'asc' | 'desc';
};

const initialFilters: Filters = {
  search: '',
  country: '',
  page: 1,
  pageSize: 20,
  sort: 'createdAt',
  order: 'desc',
};

const documentLabels = new Map(
  customerDocumentTypes.map(({ value, label }) => [value, label] as const),
);

const integrationMeta = {
  PENDING: { label: 'Pendiente', color: 'warning' as const },
  SYNCED: { label: 'Sincronizado', color: 'success' as const },
  OUT_OF_SYNC: { label: 'Desactualizado', color: 'danger' as const },
  ERROR: { label: 'Con error', color: 'danger' as const },
};

type CustomerProvider = CustomerRecord['integrations'][number]['provider'];
type CustomerOverallStatus = keyof typeof integrationMeta;

const providerLabels: Record<CustomerProvider, string> = {
  SIIGO: 'Siigo',
  SERATUS: 'Seratus',
  PALI: 'Pali',
};

function customerOverallStatus(customer: CustomerRecord): CustomerOverallStatus {
  if (customer.integrations.some((integration) => integration.status === 'ERROR')) {
    return 'ERROR';
  }
  if (
    customer.integrations.length === 3 &&
    customer.integrations.every((integration) => integration.status === 'SYNCED')
  ) {
    return 'SYNCED';
  }
  if (
    customer.integrations.some(
      (integration) => integration.status === 'PENDING' && integration.lastSyncedAt !== null,
    )
  ) {
    return 'OUT_OF_SYNC';
  }
  return 'PENDING';
}

function CustomerStatusChip({ customer }: { customer: CustomerRecord }) {
  const status = integrationMeta[customerOverallStatus(customer)];
  return <Chip color={status.color}>{status.label}</Chip>;
}

const emptyValue = '--';

function messageFrom(error: unknown) {
  return error instanceof Error ? error.message : 'No pudimos completar la solicitud.';
}

function CustomerPhone({ phone, country }: { phone: string | null; country: string | null }) {
  const [formatted, setFormatted] = useState(phone || emptyValue);

  useEffect(() => {
    let active = true;
    setFormatted(phone || emptyValue);
    if (!phone) return () => undefined;
    void import('intl-tel-input/utils')
      .then(({ default: phoneUtils }) => {
        if (!active) return;
        const international = phoneUtils.formatNumber(
          phone,
          country?.toLocaleLowerCase() ?? '',
          'INTERNATIONAL',
        );
        setFormatted(international || phone);
      })
      .catch(() => undefined);
    return () => {
      active = false;
    };
  }, [country, phone]);

  return <strong className="customer-phone-cell">{formatted}</strong>;
}

function dateTime(value: string | null) {
  if (!value) return emptyValue;
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function customerToastContent(
  title: string,
  description: string,
  tone: 'default' | 'success' | 'warning' | 'danger',
) {
  return (
    <span className="sync-toast-copy">
      <span className={`sync-toast-title sync-toast-title--${tone}`}>{title}</span>
      <span className="sync-toast-description">{description}</span>
    </span>
  );
}

function CustomerDetail({
  customer,
  canRetry,
  retryingProviders,
  onRetry,
}: {
  customer: CustomerRecord;
  canRetry: boolean;
  retryingProviders: ReadonlySet<CustomerProvider>;
  onRetry: (provider: CustomerProvider) => void;
}) {
  return (
    <div className="customer-detail">
      <section className="customer-detail-identity">
        <span className="customer-avatar">{customer.displayName.slice(0, 1).toUpperCase()}</span>
        <div>
          <strong>{customerDisplayName(customer)}</strong>
          <span>{customer.email || emptyValue}</span>
        </div>
      </section>
      <section className="customer-detail-section">
        <h3>Información personal</h3>
        <dl>
          <div>
            <dt>Documento</dt>
            <dd>
              {customer.documentType} · {customer.documentNumber}
              {customer.checkDigit ? `-${customer.checkDigit}` : ''}
            </dd>
          </div>
          <div>
            <dt>Tipo</dt>
            <dd>{customer.personType === 'PERSON' ? 'Persona natural' : 'Empresa'}</dd>
          </div>
          <div>
            <dt>Teléfono</dt>
            <dd>{customer.phone || emptyValue}</dd>
          </div>
          <div>
            <dt>Estado</dt>
            <dd>{customer.active ? 'Activo' : 'Inactivo'}</dd>
          </div>
        </dl>
      </section>
      <section className="customer-detail-section">
        <h3>Dirección</h3>
        <p>
          {customer.addressLine1 || emptyValue}
          {customer.addressLine2 ? `, ${customer.addressLine2}` : ''}
        </p>
        <p>
          {[customer.location.cityName, customer.location.regionName, customer.location.countryName]
            .filter(Boolean)
            .join(', ') || emptyValue}
          {customer.postalCode ? ` · ${customer.postalCode}` : ''}
        </p>
      </section>
      <section className="customer-detail-section">
        <h3>Integraciones</h3>
        <div className="customer-integrations">
          {customer.integrations.map((integration) => {
            const isRetrying = retryingProviders.has(integration.provider);
            return (
              <article key={integration.provider} className="customer-integration-card">
                <div className="customer-integration-main">
                  <div>
                    <strong>{providerLabels[integration.provider]}</strong>
                    <Chip color={integrationMeta[integration.status].color}>
                      {integrationMeta[integration.status].label}
                    </Chip>
                  </div>
                  {canRetry && integration.status !== 'SYNCED' && (
                    <Button
                      size="sm"
                      variant="secondary"
                      isIconOnly
                      isPending={isRetrying}
                      isDisabled={isRetrying}
                      aria-label={
                        integration.externalId
                          ? `Reintentar en ${providerLabels[integration.provider]}`
                          : `Crear en ${providerLabels[integration.provider]}`
                      }
                      onPress={() => onRetry(integration.provider)}
                    >
                      {integration.externalId ? (
                        <ArrowRotateRight width={15} height={15} />
                      ) : (
                        <PersonPlus width={15} height={15} />
                      )}
                    </Button>
                  )}
                </div>
                <p>
                  {integration.status === 'ERROR'
                    ? integration.lastErrorMessage || 'La integración no pudo completarse.'
                    : integration.status === 'SYNCED'
                      ? `Última sincronización: ${dateTime(integration.lastSyncedAt)}`
                      : integration.externalId
                        ? 'Esta integración está pendiente de sincronización.'
                        : `El cliente todavía no está creado en ${providerLabels[integration.provider]}.`}
                </p>
                {integration.status === 'ERROR' && integration.lastAttemptAt && (
                  <span>Último intento: {dateTime(integration.lastAttemptAt)}</span>
                )}
              </article>
            );
          })}
        </div>
      </section>
      <section className="customer-detail-section customer-orders-placeholder">
        <h3>Compras y pedidos</h3>
        <p>El resumen estará disponible al implementar el módulo de Pedidos.</p>
      </section>
    </div>
  );
}

export function CustomersPage() {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const isAdmin = user?.role === 'ADMIN';
  const [searchDraft, setSearchDraft] = useState('');
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRecord | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<CustomerRecord | null>(null);
  const retryingProvidersRef = useRef(new Set<CustomerProvider>());
  const [retryingProviders, setRetryingProviders] = useState<Set<CustomerProvider>>(new Set());

  const customersQuery = useQuery({
    queryKey: ['customers', filters],
    queryFn: () => customersApi.list(filters),
    placeholderData: keepPreviousData,
  });
  const detailQuery = useQuery({
    queryKey: ['customers', 'detail', selectedId],
    queryFn: () => customersApi.detail(selectedId as number),
    enabled: selectedId !== null,
  });
  const saveCustomer = useMutation({
    mutationFn: (input: CreateCustomerInput) =>
      editing ? customersApi.update(editing.id, input) : customersApi.create(input),
    onSuccess: async (customer) => {
      queryClient.setQueryData(['customers', 'detail', customer.id], customer);
      setFormOpen(false);
      setEditing(null);
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });
  const retryIntegration = useMutation({
    mutationFn: ({ id, provider }: { id: number; provider: CustomerProvider }) =>
      customersApi.sync(id, provider),
    onSuccess: async (customer) => {
      queryClient.setQueryData(['customers', 'detail', customer.id], customer);
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });
  const deleteCustomer = useMutation({
    mutationFn: (customer: CustomerRecord) => customersApi.delete(customer.id),
    onSuccess: async (customer) => {
      queryClient.removeQueries({ queryKey: ['customers', 'detail', customer.id] });
      setSelectedKeys((current) => {
        const next = new Set(current === 'all' ? [] : current);
        next.delete(customer.id);
        return next;
      });
      if (selectedId === customer.id) setSelectedId(null);
      setDeleteTarget(null);
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });

  const result = customersQuery.data;
  const selectedIdSet = selectedKeys === 'all' ? new Set<number>() : selectedKeys;
  const currentPageIds = new Set((result?.data ?? []).map((customer) => customer.id));
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
  const applySearch = (value: string) => {
    setFilters((current) => ({ ...current, search: value.trim(), page: 1 }));
  };
  const clearFilters = () => {
    setSearchDraft('');
    setFilters(initialFilters);
  };
  const openCreate = () => {
    setEditing(null);
    saveCustomer.reset();
    setFormOpen(true);
  };
  const openEdit = (customer: CustomerRecord) => {
    setEditing(customer);
    saveCustomer.reset();
    setFormOpen(true);
  };
  const submitCustomer = async (input: CreateCustomerInput) => {
    const isEditing = editing !== null;
    const loadingId = toast(
      customerToastContent(
        isEditing ? 'Actualizando cliente' : 'Creando cliente',
        isEditing
          ? `Se están guardando los cambios de “${input.displayName}” únicamente en el CRM.`
          : `Se está guardando “${input.displayName}” únicamente en el CRM.`,
        'default',
      ),
      { isLoading: true, timeout: 0 },
    );
    try {
      await saveCustomer.mutateAsync(input);
      toast.close(loadingId);
      if (!isEditing) {
        toast.success(
          customerToastContent(
            'Cliente guardado localmente',
            'No se crearon ni modificaron clientes en Siigo, Seratus o Pali.',
            'success',
          ),
        );
        return;
      }

      toast.success(
        customerToastContent(
          'Cambios guardados localmente',
          'No se modificó el cliente en Siigo, Seratus ni Pali. Puedes sincronizar cada integración manualmente.',
          'success',
        ),
      );
    } catch (error) {
      toast.close(loadingId);
      toast.danger(
        customerToastContent(
          isEditing ? 'No pudimos actualizar el cliente' : 'No pudimos crear el cliente',
          messageFrom(error),
          'danger',
        ),
      );
      throw error;
    }
  };
  const retryProvider = async (provider: CustomerProvider) => {
    if (!detailQuery.data || retryingProvidersRef.current.has(provider)) return;
    const customer = detailQuery.data;
    const providerLabel = providerLabels[provider];
    retryingProvidersRef.current.add(provider);
    setRetryingProviders(new Set(retryingProvidersRef.current));
    const loadingId = toast(
      customerToastContent(
        'Sincronizando cliente',
        `Se está sincronizando “${customer.displayName}” en ${providerLabel}.`,
        'default',
      ),
      { isLoading: true, timeout: 0 },
    );
    try {
      const updated = await retryIntegration.mutateAsync({ id: customer.id, provider });
      toast.close(loadingId);
      const integration = updated.integrations.find((item) => item.provider === provider);
      if (integration?.status === 'SYNCED') {
        toast.success(
          customerToastContent(
            'Integración sincronizada',
            `${updated.displayName} se sincronizó correctamente en ${providerLabel}.`,
            'success',
          ),
        );
      } else {
        toast.warning(
          customerToastContent(
            'La integración sigue pendiente',
            integration?.lastErrorMessage || `No pudimos sincronizar con ${providerLabel}.`,
            'warning',
          ),
        );
      }
    } catch (error) {
      toast.close(loadingId);
      toast.danger(
        customerToastContent('No pudimos reintentar la integración', messageFrom(error), 'danger'),
      );
    } finally {
      retryingProvidersRef.current.delete(provider);
      setRetryingProviders(new Set(retryingProvidersRef.current));
    }
  };
  const removeCustomer = async () => {
    if (!deleteTarget || deleteCustomer.isPending) return;
    const target = deleteTarget;
    const loadingId = toast(
      customerToastContent(
        'Eliminando cliente',
        `Se está eliminando “${target.displayName}” únicamente del CRM.`,
        'default',
      ),
      { isLoading: true, timeout: 0 },
    );
    try {
      await deleteCustomer.mutateAsync(target);
      toast.close(loadingId);
      toast.success(
        customerToastContent(
          'Cliente eliminado del CRM',
          'No se eliminó ni modificó ningún cliente en Siigo, Seratus o Pali.',
          'success',
        ),
      );
    } catch (error) {
      toast.close(loadingId);
      toast.danger(
        customerToastContent('No pudimos eliminar el cliente', messageFrom(error), 'danger'),
      );
    }
  };
  const hasFilters =
    Boolean(filters.search || filters.country) ||
    filters.sort !== initialFilters.sort ||
    filters.order !== initialFilters.order;

  return (
    <section className="customers-layout">
      <header className="customers-heading">
        <div>
          <h2>Clientes</h2>
          <Chip>{result?.pagination.total ?? 0}</Chip>
        </div>
        {isAdmin && (
          <Button variant="primary" onPress={openCreate}>
            <PersonPlus width={17} height={17} />
            Crear cliente
          </Button>
        )}
      </header>

      <div className="customers-toolbar">
        <div className="customers-filters">
          <CustomerAutocomplete
            ariaLabel="Filtrar por país"
            placeholder="Todos los países"
            value={filters.country || 'ALL'}
            options={[
              { id: 'ALL', name: 'Todos los países' },
              ...getCountries().map((country) => ({
                id: country.code,
                name: country.name,
              })),
            ]}
            onChange={(selected) =>
              setFilters((current) => ({
                ...current,
                country: selected === 'ALL' ? '' : String(selected),
                page: 1,
              }))
            }
          />
          <Select
            aria-label="Ordenar clientes"
            value={`${filters.sort}:${filters.order}`}
            variant="secondary"
            onChange={(selected) => {
              const [sort, order] = String(selected).split(':') as [
                Filters['sort'],
                Filters['order'],
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
                <ListBox.Item id="displayName:asc">Nombre A–Z</ListBox.Item>
                <ListBox.Item id="displayName:desc">Nombre Z–A</ListBox.Item>
                <ListBox.Item id="documentNumber:asc">Documento ascendente</ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
          {hasFilters && (
            <Button size="sm" variant="danger-soft" onPress={clearFilters}>
              <Xmark width={15} height={15} />
              Limpiar
            </Button>
          )}
        </div>
        <div className="customers-search">
          <SearchField
            value={searchDraft}
            onChange={setSearchDraft}
            onSubmit={applySearch}
            onClear={() => {
              setSearchDraft('');
              applySearch('');
            }}
            aria-label="Buscar clientes"
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Buscar nombre, documento, correo…" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
        </div>
      </div>

      {customersQuery.isError ? (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Title>No pudimos cargar los clientes</Alert.Title>
            <Alert.Description>{messageFrom(customersQuery.error)}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : (
        <Table className="inventory-products-table customers-table">
          <Table.ScrollContainer>
            <Table.Content
              aria-label="Clientes del CRM"
              selectionMode={isAdmin ? 'multiple' : 'none'}
              selectedKeys={isAdmin ? currentPageSelection : new Set()}
              onSelectionChange={isAdmin ? updatePageSelection : undefined}
            >
              <Table.Header>
                {isAdmin && (
                  <Table.Column id="selection" className="inventory-selection-column">
                    <Checkbox
                      slot="selection"
                      aria-label="Seleccionar todos los clientes de esta página"
                    >
                      <Checkbox.Content>
                        <Checkbox.Control>
                          <Checkbox.Indicator />
                        </Checkbox.Control>
                      </Checkbox.Content>
                    </Checkbox>
                  </Table.Column>
                )}
                <Table.Column isRowHeader>Cliente</Table.Column>
                <Table.Column>Documento</Table.Column>
                <Table.Column>Teléfono</Table.Column>
                <Table.Column>Ciudad</Table.Column>
                <Table.Column>País</Table.Column>
                <Table.Column>Estado</Table.Column>
                <Table.Column className="inventory-actions-column">Acciones</Table.Column>
              </Table.Header>
              <Table.Body
                renderEmptyState={() =>
                  customersQuery.isPending ? (
                    <div className="customers-empty">
                      <Spinner />
                      <span>Cargando clientes…</span>
                    </div>
                  ) : (
                    <EmptyState className="customers-empty">
                      <PersonMagnifier width={28} height={28} />
                      <strong>No encontramos clientes</strong>
                      <span>Prueba con otra búsqueda o cambia el país.</span>
                    </EmptyState>
                  )
                }
              >
                {(result?.data ?? []).map((customer) => (
                  <Table.Row key={customer.id} id={customer.id}>
                    {isAdmin && (
                      <Table.Cell className="inventory-selection-cell">
                        <Checkbox
                          slot="selection"
                          aria-label={`Seleccionar ${customerDisplayName(customer)}`}
                          variant="secondary"
                        >
                          <Checkbox.Content>
                            <Checkbox.Control>
                              <Checkbox.Indicator />
                            </Checkbox.Control>
                          </Checkbox.Content>
                        </Checkbox>
                      </Table.Cell>
                    )}
                    <Table.Cell
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <div className="customer-name-cell">
                        <Avatar size="sm" className={customerAvatarClass(customer.id)}>
                          <Avatar.Fallback>{customerInitials(customer)}</Avatar.Fallback>
                        </Avatar>
                        <div>
                          <strong>{customerDisplayName(customer)}</strong>
                          {customer.email && <span>{customer.email}</span>}
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <div className="customer-copy">
                        <strong>{customer.documentNumber}</strong>
                        <span>
                          {documentLabels.get(customer.documentType) || customer.documentType}
                        </span>
                      </div>
                    </Table.Cell>
                    <Table.Cell
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <CustomerPhone phone={customer.phone} country={customer.country} />
                    </Table.Cell>
                    <Table.Cell
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <strong className="customer-city-cell">
                        {customer.location.cityName || emptyValue}
                      </strong>
                    </Table.Cell>
                    <Table.Cell
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <div className="customer-country-cell">
                        <div>
                          <strong>
                            {customer.country && (
                              <img src={countryFlagPath(customer.country)} alt="" />
                            )}
                            {customer.location.countryName || emptyValue}
                          </strong>
                          {customer.location.regionName && (
                            <span>{customer.location.regionName}</span>
                          )}
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <CustomerStatusChip customer={customer} />
                    </Table.Cell>
                    <Table.Cell
                      onClick={(event) => event.stopPropagation()}
                      onPointerDown={(event) => event.stopPropagation()}
                    >
                      <div className="inventory-row-actions">
                        <Dropdown>
                          <Button
                            className="inventory-actions-trigger"
                            isIconOnly
                            size="sm"
                            variant="ghost"
                            aria-label={`Acciones para ${customerDisplayName(customer)}`}
                          >
                            <EllipsisVertical className="text-muted" width={17} height={17} />
                          </Button>
                          <Dropdown.Popover
                            className="inventory-actions-popover"
                            placement="bottom end"
                          >
                            <Dropdown.Menu
                              aria-label={`Acciones para ${customerDisplayName(customer)}`}
                              onAction={(key) => {
                                if (String(key) === 'view') setSelectedId(customer.id);
                                if (String(key) === 'edit' && isAdmin) openEdit(customer);
                                if (String(key) === 'delete' && isAdmin) {
                                  setDeleteTarget(customer);
                                }
                              }}
                            >
                              <Dropdown.Section>
                                <Dropdown.Item id="view" textValue="Ver cliente">
                                  <Eye className="size-4 shrink-0 text-muted" aria-hidden="true" />
                                  <Label>Ver cliente</Label>
                                </Dropdown.Item>
                                {isAdmin && (
                                  <Dropdown.Item id="edit" textValue="Editar cliente">
                                    <Pencil
                                      className="size-4 shrink-0 text-muted"
                                      aria-hidden="true"
                                    />
                                    <Label>Editar</Label>
                                  </Dropdown.Item>
                                )}
                              </Dropdown.Section>
                              {isAdmin && <Separator />}
                              {isAdmin && (
                                <Dropdown.Section>
                                  <Dropdown.Item
                                    id="delete"
                                    textValue="Eliminar cliente"
                                    variant="danger"
                                  >
                                    <TrashBin
                                      className="size-4 shrink-0 text-danger"
                                      aria-hidden="true"
                                    />
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
              <Pagination aria-label="Paginación de clientes">
                <Pagination.Summary>
                  <span className="customers-page-size-control">
                    Filas por página
                    <Select
                      className="customers-page-size"
                      value={String(filters.pageSize)}
                      aria-label="Filas por página"
                      onChange={(selected) =>
                        setFilters((current) => ({
                          ...current,
                          pageSize: Number(selected),
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
                      isDisabled={!result || filters.page <= 1 || customersQuery.isFetching}
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
                            isDisabled={customersQuery.isFetching}
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
                        customersQuery.isFetching
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

      {isAdmin && (
        <CustomerForm
          key={`${editing?.id ?? 'new'}-${formOpen}`}
          isOpen={formOpen}
          customer={editing}
          isSubmitting={saveCustomer.isPending}
          serverError={saveCustomer.isError ? messageFrom(saveCustomer.error) : ''}
          onClose={() => {
            setFormOpen(false);
            setEditing(null);
          }}
          onOpenExisting={(customerId) => {
            setFormOpen(false);
            setEditing(null);
            setSelectedId(customerId);
          }}
          onSubmit={submitCustomer}
        />
      )}

      <Modal isOpen={selectedId !== null} onOpenChange={(open) => !open && setSelectedId(null)}>
        <Modal.Backdrop>
          <Modal.Container size="md" placement="center" scroll="inside">
            <Modal.Dialog className="customer-detail-modal">
              <Modal.CloseTrigger aria-label="Cerrar detalle" />
              <Modal.Header>
                <div>
                  <Modal.Heading>Detalle del cliente</Modal.Heading>
                  <p>Información local e integraciones</p>
                </div>
              </Modal.Header>
              <Modal.Body>
                {detailQuery.isPending ? (
                  <div className="customers-empty">
                    <Spinner />
                    <span>Cargando cliente…</span>
                  </div>
                ) : detailQuery.isError ? (
                  <Alert status="danger">
                    <Alert.Content>
                      <Alert.Description>{messageFrom(detailQuery.error)}</Alert.Description>
                    </Alert.Content>
                  </Alert>
                ) : detailQuery.data ? (
                  <CustomerDetail
                    customer={detailQuery.data}
                    canRetry={isAdmin}
                    retryingProviders={retryingProviders}
                    onRetry={(provider) => void retryProvider(provider)}
                  />
                ) : null}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      {isAdmin && (
        <AlertDialog
          isOpen={deleteTarget !== null}
          onOpenChange={(open) => {
            if (!open && !deleteCustomer.isPending) setDeleteTarget(null);
          }}
        >
          <AlertDialog.Backdrop>
            <AlertDialog.Container size="sm">
              <AlertDialog.Dialog>
                <AlertDialog.Header>
                  <AlertDialog.Icon status="danger">
                    <TrashBin width={20} height={20} />
                  </AlertDialog.Icon>
                  <AlertDialog.Heading>Eliminar cliente del CRM</AlertDialog.Heading>
                </AlertDialog.Header>
                <AlertDialog.Body>
                  <p>
                    Se eliminará <strong>{deleteTarget?.displayName}</strong>, sus integraciones y
                    sus notificaciones locales. No se eliminará ni modificará el cliente en Siigo,
                    Seratus o Pali.
                  </p>
                </AlertDialog.Body>
                <AlertDialog.Footer>
                  <Button
                    variant="secondary"
                    isDisabled={deleteCustomer.isPending}
                    onPress={() => setDeleteTarget(null)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    variant="danger"
                    isPending={deleteCustomer.isPending}
                    onPress={() => void removeCustomer()}
                  >
                    Eliminar cliente
                  </Button>
                </AlertDialog.Footer>
              </AlertDialog.Dialog>
            </AlertDialog.Container>
          </AlertDialog.Backdrop>
        </AlertDialog>
      )}
    </section>
  );
}
