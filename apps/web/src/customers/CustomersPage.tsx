import { Fragment, useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import type { Selection } from '@heroui/react';
import {
  Alert,
  AlertDialog,
  Avatar,
  Button,
  Checkbox,
  Drawer,
  Dropdown,
  EmptyState,
  Label,
  ListBox,
  SearchField,
  Separator,
  Spinner,
  Table,
  toast,
} from '@heroui/react';
import {
  ArrowDownToLine,
  ArrowRotateRight,
  EllipsisVertical,
  Eye,
  PaperPlane,
  Pencil,
  PersonMagnifier,
  PersonPlus,
  TrashBin,
  Xmark,
} from '@gravity-ui/icons';
import {
  customerCountryFlagPath,
  getCustomerCountries,
  getCustomerSiigoCities,
  getCustomerSiigoStates,
  isCustomerSiigoLocationMappingCurrent,
  readCustomerSiigoLocationMapping,
  resolveCustomerSiigoCountryByWooCode,
} from '@sevale/shared';
import {
  customerDocumentTypes,
  type CreateCustomerInput,
  type CustomerSiigoLocationInput,
  type CustomerSyncStatusFilter,
} from '@sevale/validation';
import { Chip } from '../components/Chip';
import { getPaginationItems, Pagination } from '../components/Pagination';
import { Select } from '../components/Select';
import { useFormattedPhone } from '../components/useFormattedPhone';
import { useCurrentUser } from '../users/useCurrentUser';
import { CustomerForm } from './CustomerForm';
import { CustomerOrderPanel } from './CustomerOrderPanel';
import { CustomerOrders } from './CustomerOrders';
import { customerAvatarClass, customerDisplayName, customerInitials } from './presentation';
import { CustomerAutocomplete } from './CustomerAutocomplete';
import { customersApi, type CustomerRecord } from './api';
import type { CustomerOrderRecord } from '../orders/api';

type Filters = {
  search: string;
  country: string;
  /** Estado de sincronización con las integraciones, tal como lo resume la tabla. */
  status: CustomerSyncStatusFilter;
  page: number;
  pageSize: number;
};

const initialFilters: Filters = {
  search: '',
  country: '',
  status: 'all',
  page: 1,
  pageSize: 20,
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

function CustomerPhone({
  phone,
  country,
  showFlag = false,
}: {
  phone: string | null;
  country: string | null;
  showFlag?: boolean;
}) {
  const formatted = useFormattedPhone(phone, country) || emptyValue;

  if (!showFlag) return <strong className="customer-phone-cell">{formatted}</strong>;

  return (
    <span className="customer-detail-phone">
      {phone && country && <img src={customerCountryFlagPath(country)} alt="" />}
      <strong className="customer-phone-cell">{formatted}</strong>
    </span>
  );
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
  canViewIntegrationErrors,
  retryingProviders,
  onRetry,
  siigoResolution,
  onSiigoStateChange,
  onSiigoCityChange,
  onConfirmSiigoLocation,
  onSelectOrder,
}: {
  customer: CustomerRecord;
  canRetry: boolean;
  canViewIntegrationErrors: boolean;
  retryingProviders: ReadonlySet<CustomerProvider>;
  onRetry: (provider: CustomerProvider) => void;
  siigoResolution: {
    stateCode: string;
    cityCode: string;
    states: Array<{ id: string; name: string }>;
    cities: Array<{ id: string; name: string }>;
    error: string;
  } | null;
  onSiigoStateChange: (stateCode: string) => void;
  onSiigoCityChange: (cityCode: string) => void;
  onConfirmSiigoLocation: () => void;
  onSelectOrder: (order: CustomerOrderRecord) => void;
}) {
  return (
    <div className="customer-detail">
      <section className="customer-detail-identity">
        <Avatar size="md" className={`customer-detail-avatar ${customerAvatarClass(customer.id)}`}>
          <Avatar.Fallback>{customerInitials(customer)}</Avatar.Fallback>
        </Avatar>
        <div>
          <strong>{customerDisplayName(customer)}</strong>
          <span>{customer.email || emptyValue}</span>
        </div>
      </section>
      <section className="customer-detail-section">
        <h3>Información personal</h3>
        <dl>
          <div>
            <dt>{documentLabels.get(customer.documentType) ?? customer.documentType}</dt>
            <dd>
              {customer.documentNumber}
              {customer.personType === 'COMPANY' && customer.checkDigit
                ? `-${customer.checkDigit}`
                : ''}
            </dd>
          </div>
          <div>
            <dt>Tipo</dt>
            <dd>{customer.personType === 'PERSON' ? 'Persona' : 'Empresa'}</dd>
          </div>
          <div>
            <dt>Teléfono</dt>
            <dd>
              <CustomerPhone phone={customer.phone} country={customer.country} showFlag />
            </dd>
          </div>
          <div>
            <dt>Estado</dt>
            <dd>
              <Chip color={customer.active ? 'success' : 'danger'}>
                {customer.active ? 'Activo' : 'Inactivo'}
              </Chip>
            </dd>
          </div>
          <div className="customer-detail-address">
            <dt>Dirección</dt>
            <dd>
              {[
                customer.addressLine1,
                customer.addressLine2,
                customer.location.cityName,
                customer.location.regionName,
                customer.postalCode,
                customer.location.countryName,
              ]
                .filter(Boolean)
                .join(', ') || emptyValue}
            </dd>
          </div>
        </dl>
      </section>
      <section className="customer-detail-section">
        <h3>Integraciones</h3>
        <div className="customer-integrations">
          {customer.integrations.map((integration) => {
            const isRetrying = retryingProviders.has(integration.provider);
            const activity =
              integration.status === 'SYNCED' && integration.lastSyncedAt
                ? `Última sincronización: ${dateTime(integration.lastSyncedAt)}`
                : integration.lastAttemptAt
                  ? `Último intento: ${dateTime(integration.lastAttemptAt)}`
                  : integration.lastSyncedAt
                    ? `Última sincronización: ${dateTime(integration.lastSyncedAt)}`
                    : 'Sin actividad de sincronización.';
            return (
              <Fragment key={integration.provider}>
                <article className="customer-integration-card">
                  <div className="customer-integration-main">
                    <div>
                      <strong>{providerLabels[integration.provider]}</strong>
                      <Chip color={integrationMeta[integration.status].color}>
                        {integration.status === 'ERROR'
                          ? 'Error'
                          : integrationMeta[integration.status].label}
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
                  <span className="customer-integration-date">{activity}</span>
                  {canViewIntegrationErrors &&
                    integration.status === 'ERROR' &&
                    integration.lastErrorMessage && (
                      <span className="customer-integration-error" role="alert">
                        {integration.lastErrorMessage}
                      </span>
                    )}
                </article>
                {integration.provider === 'SIIGO' && siigoResolution && (
                  <article className="customer-siigo-location-card">
                    <CustomerAutocomplete
                      ariaLabel="Región o provincia Siigo"
                      label="Región / Provincia"
                      placeholder="Seleccionar"
                      value={siigoResolution.stateCode}
                      options={siigoResolution.states}
                      onChange={onSiigoStateChange}
                    />
                    <CustomerAutocomplete
                      key={`siigo-city:${siigoResolution.stateCode}`}
                      ariaLabel="Ciudad Siigo"
                      label="Ciudad"
                      placeholder="Seleccionar"
                      value={siigoResolution.cityCode}
                      options={siigoResolution.cities}
                      isDisabled={!siigoResolution.stateCode}
                      onChange={onSiigoCityChange}
                    />
                    <Button
                      variant="primary"
                      isIconOnly
                      isPending={isRetrying}
                      isDisabled={isRetrying}
                      aria-label={
                        integration.externalId ? 'Sincronizar con Siigo' : 'Crear en Siigo'
                      }
                      onPress={onConfirmSiigoLocation}
                    >
                      <PaperPlane width={16} height={16} />
                    </Button>
                    {siigoResolution.error && (
                      <span className="customer-siigo-location-error" role="alert">
                        {siigoResolution.error}
                      </span>
                    )}
                  </article>
                )}
              </Fragment>
            );
          })}
        </div>
      </section>
      <CustomerOrders customerId={customer.id} onSelectOrder={onSelectOrder} />
    </div>
  );
}

export function CustomersPage() {
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const isAdmin = user?.role === 'ADMIN';
  const canManageCustomers = isAdmin || user?.role === 'COMMERCIAL';
  const [searchDraft, setSearchDraft] = useState('');
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<CustomerRecord | null>(null);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [selectedOrder, setSelectedOrder] = useState<CustomerOrderRecord | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set());
  const [deleteTarget, setDeleteTarget] = useState<CustomerRecord | null>(null);
  const retryingProvidersRef = useRef(new Set<CustomerProvider>());
  const [retryingProviders, setRetryingProviders] = useState<Set<CustomerProvider>>(new Set());
  const [siigoResolutionTarget, setSiigoResolutionTarget] = useState<CustomerRecord | null>(null);
  const [siigoStateCode, setSiigoStateCode] = useState('');
  const [siigoCityCode, setSiigoCityCode] = useState('');
  const [siigoResolutionError, setSiigoResolutionError] = useState('');
  const [searchParams, setSearchParams] = useSearchParams();

  // Un enlace externo (`/customers?customer=194`) abre la ficha: lo usa la ficha del prospecto
  // convertido para llevar al cliente concreto sin obligar a buscarlo.
  const customerParam = searchParams.get('customer');
  useEffect(() => {
    if (!customerParam) return;
    const requested = Number(customerParam);
    if (!Number.isInteger(requested) || requested <= 0) return;
    setSelectedId(requested);
    setSearchParams(
      (current) => {
        current.delete('customer');
        return current;
      },
      { replace: true },
    );
  }, [customerParam, setSearchParams]);

  const customersQuery = useQuery({
    queryKey: ['customers', filters],
    // Sin selector de orden: la tabla se mantiene por «más recientes», que es el orden útil del
    // día a día. El backend sigue aceptando `sort`, solo que el panel no lo cambia.
    queryFn: () => customersApi.list({ ...filters, sort: 'createdAt', order: 'desc' }),
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
    mutationFn: ({
      id,
      provider,
      siigoLocation,
    }: {
      id: number;
      provider: CustomerProvider;
      siigoLocation?: CustomerSiigoLocationInput;
    }) => customersApi.sync(id, provider, siigoLocation),
    onSuccess: async (customer) => {
      queryClient.setQueryData(['customers', 'detail', customer.id], customer);
      await queryClient.invalidateQueries({ queryKey: ['customers'] });
    },
  });
  const exportSelectedCustomers = useMutation({
    mutationFn: customersApi.exportCustomers,
    onSuccess: ({ blob, filename }, ids) => {
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = filename;
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(url), 0);
      toast.success(
        `${ids.length} ${ids.length === 1 ? 'cliente exportado' : 'clientes exportados'} en formato Excel.`,
      );
    },
    onError: (error) => {
      toast.danger('No pudimos exportar los clientes', { description: messageFrom(error) });
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
  const selectedIds = [...selectedIdSet].map(Number).filter(Number.isInteger);
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
  const synchronizeProvider = async (
    customer: CustomerRecord,
    provider: CustomerProvider,
    siigoLocation?: CustomerSiigoLocationInput,
  ): Promise<boolean> => {
    if (retryingProvidersRef.current.has(provider)) return false;
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
      const updated = await retryIntegration.mutateAsync({
        id: customer.id,
        provider,
        siigoLocation,
      });
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
        return true;
      } else {
        toast.warning(
          customerToastContent(
            'La integración sigue pendiente',
            integration?.lastErrorMessage || `No pudimos sincronizar con ${providerLabel}.`,
            'warning',
          ),
        );
        return false;
      }
    } catch (error) {
      toast.close(loadingId);
      toast.danger(
        customerToastContent('No pudimos reintentar la integración', messageFrom(error), 'danger'),
      );
      return false;
    } finally {
      retryingProvidersRef.current.delete(provider);
      setRetryingProviders(new Set(retryingProvidersRef.current));
    }
  };
  const retryProvider = (provider: CustomerProvider) => {
    const customer = detailQuery.data;
    if (!customer || retryingProvidersRef.current.has(provider)) return;
    if (provider === 'SIIGO' && customer.country !== 'CO') {
      const integration = customer.integrations.find((item) => item.provider === 'SIIGO');
      const storedMapping = readCustomerSiigoLocationMapping(integration?.externalData);
      // Con un error registrado la ubicación guardada ya falló, así que no se reenvía a ciegas: se
      // reabre el selector con lo último enviado para que el administrador pueda elegir otra ciudad
      // en lugar de repetir la misma selección y volver a chocar con el catálogo de Siigo.
      if (
        integration?.status !== 'ERROR' &&
        storedMapping &&
        customer.country &&
        isCustomerSiigoLocationMappingCurrent(storedMapping, {
          country: customer.country,
          region: customer.region,
          city: customer.cityName,
        })
      ) {
        void synchronizeProvider(customer, provider);
        return;
      }
      const siigoCountry = customer.country
        ? resolveCustomerSiigoCountryByWooCode(customer.country)
        : null;
      if (!siigoCountry) {
        toast.danger(
          customerToastContent(
            'Ubicación no disponible en Siigo',
            'El país del cliente no tiene una correspondencia válida en el catálogo de Siigo.',
            'danger',
          ),
        );
        return;
      }
      setSiigoResolutionTarget(customer);
      setSiigoStateCode(storedMapping?.target.stateCode ?? '');
      setSiigoCityCode(storedMapping?.target.cityCode ?? '');
      setSiigoResolutionError('');
      return;
    }
    void synchronizeProvider(customer, provider);
  };
  const siigoCountry = siigoResolutionTarget?.country
    ? resolveCustomerSiigoCountryByWooCode(siigoResolutionTarget.country)
    : null;
  const siigoStates = siigoCountry ? getCustomerSiigoStates(siigoCountry.code) : [];
  const siigoCities =
    siigoCountry && siigoStateCode ? getCustomerSiigoCities(siigoCountry.code, siigoStateCode) : [];
  const confirmSiigoLocation = async () => {
    if (!siigoResolutionTarget || !siigoCountry) return;
    if (!siigoStateCode || !siigoCityCode) {
      setSiigoResolutionError('Selecciona la región y la ciudad de Siigo.');
      return;
    }
    setSiigoResolutionError('');
    const synchronized = await synchronizeProvider(siigoResolutionTarget, 'SIIGO', {
      stateCode: siigoStateCode,
      cityCode: siigoCityCode,
    });
    if (synchronized) setSiigoResolutionTarget(null);
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
    Boolean(filters.search || filters.country) || filters.status !== initialFilters.status;

  return (
    <section className="customers-layout">
      <header className="customers-heading">
        <div>
          <h2>Clientes</h2>
          <Chip>{result?.pagination.total ?? 0}</Chip>
        </div>
        {canManageCustomers && (
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
              ...getCustomerCountries().map((country) => ({
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
            aria-label="Filtrar por estado de sincronización"
            value={filters.status}
            variant="secondary"
            onChange={(selected) =>
              setFilters((current) => ({
                ...current,
                status: String(selected) as CustomerSyncStatusFilter,
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
                <ListBox.Item id="all" textValue="Todos los estados">
                  Todos los estados
                </ListBox.Item>
                <ListBox.Item id="SYNCED" textValue={integrationMeta.SYNCED.label}>
                  {integrationMeta.SYNCED.label}
                </ListBox.Item>
                <ListBox.Item id="PENDING" textValue={integrationMeta.PENDING.label}>
                  {integrationMeta.PENDING.label}
                </ListBox.Item>
                <ListBox.Item id="OUT_OF_SYNC" textValue={integrationMeta.OUT_OF_SYNC.label}>
                  {integrationMeta.OUT_OF_SYNC.label}
                </ListBox.Item>
                <ListBox.Item id="ERROR" textValue={integrationMeta.ERROR.label}>
                  {integrationMeta.ERROR.label}
                </ListBox.Item>
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

      {isAdmin && selectedIds.length > 0 && (
        <div className="customers-bulk-actions" role="toolbar" aria-label="Acciones en lote">
          <span className="customers-bulk-count">{selectedIds.length}</span>
          <Button
            size="sm"
            variant="ghost"
            isPending={exportSelectedCustomers.isPending}
            isDisabled={exportSelectedCustomers.isPending}
            onPress={() => exportSelectedCustomers.mutate(selectedIds)}
          >
            <ArrowDownToLine width={16} height={16} />
            Exportar
          </Button>
          <Button
            isIconOnly
            size="sm"
            variant="ghost"
            aria-label="Limpiar selección"
            onPress={() => setSelectedKeys(new Set())}
          >
            <Xmark width={16} height={16} />
          </Button>
        </div>
      )}

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
                      <span>Prueba con otra búsqueda o cambia los filtros.</span>
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
                              <img src={customerCountryFlagPath(customer.country)} alt="" />
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
                                if (String(key) === 'edit' && canManageCustomers)
                                  openEdit(customer);
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
                                {canManageCustomers && (
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

      {canManageCustomers && (
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

      <Drawer
        isOpen={selectedId !== null}
        onOpenChange={(open) => {
          if (!open) {
            setSelectedId(null);
            setSelectedOrder(null);
            setSiigoResolutionTarget(null);
          }
        }}
      >
        <Drawer.Backdrop variant={selectedOrder ? 'transparent' : 'opaque'}>
          <Drawer.Content placement="right">
            <Drawer.Dialog
              className={`customer-detail-drawer${selectedOrder ? ' customer-detail-drawer--pushed' : ''}`}
            >
              <Drawer.CloseTrigger aria-label="Cerrar detalle" />
              <Drawer.Header>
                <div>
                  <Drawer.Heading>Detalle del cliente</Drawer.Heading>
                  <p>Información local e integraciones</p>
                </div>
              </Drawer.Header>
              <Drawer.Body>
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
                    canRetry={canManageCustomers}
                    canViewIntegrationErrors={isAdmin}
                    retryingProviders={retryingProviders}
                    onRetry={(provider) => void retryProvider(provider)}
                    siigoResolution={
                      siigoResolutionTarget?.id === detailQuery.data.id
                        ? {
                            stateCode: siigoStateCode,
                            cityCode: siigoCityCode,
                            states: siigoStates.map((state) => ({
                              id: state.code,
                              name: state.name,
                            })),
                            cities: siigoCities.map((city) => ({
                              id: city.code,
                              name: city.name,
                            })),
                            error: siigoResolutionError,
                          }
                        : null
                    }
                    onSiigoStateChange={(stateCode) => {
                      setSiigoStateCode(stateCode);
                      setSiigoCityCode('');
                      setSiigoResolutionError('');
                    }}
                    onSiigoCityChange={(cityCode) => {
                      setSiigoCityCode(cityCode);
                      setSiigoResolutionError('');
                    }}
                    onConfirmSiigoLocation={() => void confirmSiigoLocation()}
                    onSelectOrder={setSelectedOrder}
                  />
                ) : null}
              </Drawer.Body>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>

      <CustomerOrderPanel order={selectedOrder} onClose={() => setSelectedOrder(null)} />

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
