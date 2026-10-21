import {
  useEffect,
  useMemo,
  useState,
  type MouseEvent as ReactMouseEvent,
  type PointerEvent as ReactPointerEvent,
} from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertDialog,
  Alert,
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
  type Selection,
} from '@heroui/react';
import {
  EllipsisVertical,
  Eye,
  Funnel,
  Pencil,
  PersonMagnifier,
  Plus,
  Tag as TagIcon,
  TrashBin,
  Xmark,
} from '@gravity-ui/icons';
import { hasPermission } from '@sevale/permissions';
import { customerCountryFlagPath } from '@sevale/shared';
import type { CreateCustomerInput } from '@sevale/validation';
import { Chip } from '../components/Chip';
import { getPaginationItems, Pagination } from '../components/Pagination';
import { Select } from '../components/Select';
import { useFormattedPhone } from '../components/useFormattedPhone';
import { CustomerAutocomplete } from '../customers/CustomerAutocomplete';
import { CustomerForm, type CustomerFormPrefill } from '../customers/CustomerForm';
import { customerAvatarClass, customerInitials } from '../customers/presentation';
import { useCurrentUser } from '../users/useCurrentUser';
import {
  fetchActiveAgreements,
  prospectsApi,
  type ProspectListInput,
  type ProspectRecord,
  type ProspectStatusFilter,
} from './api';
import { ProspectDetail } from './ProspectDetail';
import { ProspectForm, type ProspectFormValue } from './ProspectForm';
import { TagChip, TagColorDot } from './TagChip';
import { TagsDialog } from './TagsDialog';
import {
  dateOnly,
  messageFrom,
  prospectSourceMeta,
  prospectStatusFilterOptions,
  prospectStatusMeta,
} from './presentation';

type Filters = {
  search: string;
  status: ProspectStatusFilter;
  source: '' | keyof typeof prospectSourceMeta;
  assignedUserId: string;
  unassigned: boolean;
  agreementId: string;
  tagId: string;
  page: number;
  pageSize: number;
  sort: ProspectListInput['sort'];
  order: ProspectListInput['order'];
};

const initialFilters: Filters = {
  search: '',
  // `all` excluye los convertidos: son historial, no trabajo diario.
  status: 'all',
  source: '',
  assignedUserId: '',
  unassigned: false,
  agreementId: '',
  tagId: '',
  page: 1,
  pageSize: 20,
  sort: 'updatedAt',
  order: 'desc',
};

/** Los valores del formulario llegan como texto; aquí se convierten al contrato de la API. */
function toApiInput(value: ProspectFormValue, tagIds: number[]) {
  return {
    personType: value.personType || null,
    firstName: value.firstName,
    lastName: value.lastName,
    company: value.company,
    documentType: value.documentType,
    documentNumber: value.documentNumber,
    checkDigit: value.checkDigit,
    email: value.email,
    phone: value.phone,
    country: value.country,
    region: value.region,
    cityCode: value.cityCode,
    cityName: value.cityName,
    postalCode: value.postalCode,
    addressLine1: value.addressLine1,
    addressLine2: value.addressLine2,
    agreementId: value.agreementId ? Number(value.agreementId) : null,
    source: value.source,
    status: value.status,
    assignedUserId: value.assignedUserId || null,
    tagIds,
  };
}

/** El teléfono se guarda pegado (`+573044251788`) y se muestra con la agrupación de su país. */
function ProspectPhone({ phone, country }: { phone: string | null; country: string | null }) {
  const formatted = useFormattedPhone(phone, country);
  return <strong className="customer-phone-cell">{formatted || '--'}</strong>;
}

/**
 * La fila se marca solo con el check: estas celdas cortan el evento para que un clic en cualquier
 * columna no seleccione el prospecto. Es el mismo recurso que usan las otras tablas del CRM.
 */
const ignoreRowPress = {
  onClick: (event: ReactMouseEvent<HTMLElement>) => event.stopPropagation(),
  onPointerDown: (event: ReactPointerEvent<HTMLElement>) => event.stopPropagation(),
};

export function ProspectsPage() {
  const { user } = useCurrentUser();
  const role = user?.role;
  const canCreate = Boolean(role && hasPermission(role, 'prospects.create'));
  const canUpdate = Boolean(role && hasPermission(role, 'prospects.update'));
  const canDelete = Boolean(role && hasPermission(role, 'prospects.delete'));
  const canConvert = Boolean(role && hasPermission(role, 'prospects.convert'));
  const canManageTags = Boolean(role && hasPermission(role, 'tags.manage'));

  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [searchDraft, setSearchDraft] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<ProspectRecord | null>(null);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [convertTarget, setConvertTarget] = useState<ProspectRecord | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProspectRecord | null>(null);
  const [tagsOpen, setTagsOpen] = useState(false);
  // Los filtros viven siempre en el panel: así pueden crecer sin rehacer la barra.
  const [filtersOpen, setFiltersOpen] = useState(false);
  // Selección de filas para las acciones masivas que vendrán después. Se guarda por página, igual
  // que en Pedidos, para que al cambiar de página no queden ids que ya no se ven.
  const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set());

  const listQuery = useQuery({
    queryKey: ['prospects', filters],
    queryFn: () =>
      prospectsApi.list({
        ...filters,
        source: filters.source || undefined,
        assignedUserId: filters.assignedUserId || undefined,
        agreementId: filters.agreementId ? Number(filters.agreementId) : undefined,
        tagId: filters.tagId ? Number(filters.tagId) : undefined,
      }),
  });

  // Los selectores de filtro comparten catálogo con el formulario y se cachean una sola vez.
  const tagsQuery = useQuery({ queryKey: ['tags'], queryFn: () => prospectsApi.tags() });
  const assigneesQuery = useQuery({
    queryKey: ['prospect-assignees'],
    queryFn: () => prospectsApi.assignees(),
  });
  const agreementsQuery = useQuery({
    queryKey: ['agreements', 'active-options'],
    queryFn: fetchActiveAgreements,
  });

  const detailQuery = useQuery({
    queryKey: ['prospect', detailId],
    queryFn: () => prospectsApi.detail(detailId!),
    enabled: detailId !== null,
  });

  const refreshList = () => queryClient.invalidateQueries({ queryKey: ['prospects'] });
  // La ficha vive en su propia clave: sin esto, reabrirla tras editar o convertir mostraría el
  // estado anterior. `['prospect']` no alcanza a `['prospects']` porque la raíz es distinta.
  const refreshDetail = () => queryClient.invalidateQueries({ queryKey: ['prospect'] });

  const saveProspect = useMutation({
    mutationFn: ({ value, tagIds }: { value: ProspectFormValue; tagIds: number[] }) => {
      const input = toApiInput(value, tagIds);
      return editing ? prospectsApi.update(editing.id, input) : prospectsApi.create(input);
    },
    onSuccess: () => {
      void refreshList();
      void refreshDetail();
      setFormOpen(false);
      setEditing(null);
      toast.success(editing ? 'Prospecto actualizado.' : 'Prospecto creado.');
    },
  });

  const convertProspect = useMutation({
    mutationFn: (input: CreateCustomerInput) => prospectsApi.convert(convertTarget!.id, input),
    onSuccess: (result) => {
      void refreshList();
      void refreshDetail();
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      setConvertTarget(null);
      setDetailId(null);
      toast.success(`Convertido en cliente: ${result.customer.displayName}.`);
    },
  });

  const linkProspect = useMutation({
    mutationFn: ({ id, customerId }: { id: number; customerId: number }) =>
      prospectsApi.convertLink(id, customerId),
    onSuccess: () => {
      void refreshList();
      void refreshDetail();
      void queryClient.invalidateQueries({ queryKey: ['customers'] });
      setConvertTarget(null);
      setDetailId(null);
      toast.success('Prospecto vinculado al cliente existente.');
    },
  });

  const deleteProspect = useMutation({
    mutationFn: (id: number) => prospectsApi.remove(id),
    onSuccess: () => {
      void refreshList();
      void refreshDetail();
      setDeleteTarget(null);
      toast.success('Prospecto eliminado.');
    },
  });

  const applySearch = (value: string) => {
    setFilters((current) => ({ ...current, search: value, page: 1 }));
  };

  const totalPages = listQuery.data?.pagination.totalPages ?? 1;
  const rows = useMemo(() => listQuery.data?.data ?? [], [listQuery.data]);
  const selectedIdSet = selectedKeys === 'all' ? new Set<number>() : selectedKeys;
  const currentPageIds = new Set(rows.map((prospect) => prospect.id));
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

  useEffect(() => {
    if (filters.page > totalPages) {
      setFilters((current) => ({ ...current, page: totalPages }));
    }
  }, [filters.page, totalPages]);

  /**
   * Filtros aplicados con su etiqueta legible y la forma de quitarlos. Se muestran como chips bajo
   * la barra en cualquier ancho: con el panel colapsado son la única pista de por qué la tabla trae
   * pocos prospectos, y así nunca queda un filtro activo invisible.
   */
  const activeFilters = useMemo(() => {
    const chips: Array<{ key: string; label: string; clear: () => void }> = [];
    const resetPage = (changes: Partial<Filters>) =>
      setFilters((current) => ({ ...current, ...changes, page: 1 }));

    if (filters.search) {
      chips.push({
        key: 'search',
        label: `Búsqueda: ${filters.search}`,
        clear: () => {
          setSearchDraft('');
          resetPage({ search: '' });
        },
      });
    }
    if (filters.status !== initialFilters.status) {
      const label =
        prospectStatusFilterOptions.find((option) => option.id === filters.status)?.label ??
        filters.status;
      chips.push({
        key: 'status',
        label: `Estado: ${label}`,
        clear: () => resetPage({ status: initialFilters.status }),
      });
    }
    if (filters.source) {
      chips.push({
        key: 'source',
        label: `Origen: ${prospectSourceMeta[filters.source]}`,
        clear: () => resetPage({ source: '' }),
      });
    }
    if (filters.unassigned) {
      chips.push({
        key: 'assignee',
        label: 'Comercial: Sin asignar',
        clear: () => resetPage({ unassigned: false }),
      });
    } else if (filters.assignedUserId) {
      const name = assigneesQuery.data?.find((item) => item.id === filters.assignedUserId)?.name;
      chips.push({
        key: 'assignee',
        label: `Comercial: ${name ?? 'Seleccionado'}`,
        clear: () => resetPage({ assignedUserId: '' }),
      });
    }
    if (filters.agreementId) {
      const company = agreementsQuery.data?.find(
        (item) => String(item.id) === filters.agreementId,
      )?.companyName;
      chips.push({
        key: 'agreement',
        label: `Convenio: ${company ?? 'Seleccionado'}`,
        clear: () => resetPage({ agreementId: '' }),
      });
    }
    if (filters.tagId) {
      const tag = tagsQuery.data?.find((item) => String(item.id) === filters.tagId)?.name;
      chips.push({
        key: 'tag',
        label: `Etiqueta: ${tag ?? 'Seleccionada'}`,
        clear: () => resetPage({ tagId: '' }),
      });
    }
    return chips;
  }, [agreementsQuery.data, assigneesQuery.data, filters, tagsQuery.data]);

  const clearAllFilters = () => {
    setSearchDraft('');
    setFilters(initialFilters);
  };

  /**
   * Los cinco filtros se dibujan una sola vez y se usan en dos sitios: la barra (pantallas anchas) y
   * el panel lateral (pantallas angostas). Cuál se ve lo decide el CSS, así que al cambiar el tamaño
   * de la ventana no hay que volver a montar nada.
   */
  const filterControls = (
    <>
      <Select
        aria-label="Filtrar por estado"
        variant="secondary"
        selectedKey={filters.status}
        onSelectionChange={(key) =>
          setFilters((current) => ({
            ...current,
            status: String(key) as ProspectStatusFilter,
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
            {prospectStatusFilterOptions.map((option) => (
              <ListBox.Item key={option.id} id={option.id} textValue={option.label}>
                {option.label}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>

      <Select
        aria-label="Filtrar por origen"
        variant="secondary"
        selectedKey={filters.source || 'all'}
        onSelectionChange={(key) =>
          setFilters((current) => ({
            ...current,
            source: String(key) === 'all' ? '' : (String(key) as keyof typeof prospectSourceMeta),
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
            <ListBox.Item id="all" textValue="Todos los orígenes">
              Todos los orígenes
            </ListBox.Item>
            {Object.entries(prospectSourceMeta).map(([key, label]) => (
              <ListBox.Item key={key} id={key} textValue={label}>
                {label}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>

      <Select
        aria-label="Filtrar por comercial"
        variant="secondary"
        selectedKey={filters.unassigned ? 'unassigned' : filters.assignedUserId || 'all'}
        onSelectionChange={(key) => {
          const selected = String(key);
          setFilters((current) => ({
            ...current,
            page: 1,
            unassigned: selected === 'unassigned',
            assignedUserId: selected === 'all' || selected === 'unassigned' ? '' : selected,
          }));
        }}
      >
        <Select.Trigger>
          <Select.Value />
          <Select.Indicator />
        </Select.Trigger>
        <Select.Popover>
          <ListBox>
            <ListBox.Item id="all" textValue="Todos los comerciales">
              Todos los comerciales
            </ListBox.Item>
            <ListBox.Item id="unassigned" textValue="Sin asignar">
              Sin asignar
            </ListBox.Item>
            {(assigneesQuery.data ?? []).map((assignee) => (
              <ListBox.Item key={assignee.id} id={assignee.id} textValue={assignee.name}>
                {assignee.name}
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>

      <CustomerAutocomplete
        ariaLabel="Filtrar por convenio"
        placeholder="Todos los convenios"
        value={filters.agreementId}
        options={(agreementsQuery.data ?? []).map((agreement) => ({
          id: String(agreement.id),
          name: agreement.companyName,
        }))}
        onChange={(agreementId) => setFilters((current) => ({ ...current, agreementId, page: 1 }))}
      />

      <Select
        aria-label="Filtrar por etiqueta"
        variant="secondary"
        selectedKey={filters.tagId || 'all'}
        onSelectionChange={(key) =>
          setFilters((current) => ({
            ...current,
            tagId: String(key) === 'all' ? '' : String(key),
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
            <ListBox.Item id="all" textValue="Todas las etiquetas">
              Todas las etiquetas
            </ListBox.Item>
            {(tagsQuery.data ?? []).map((tag) => (
              <ListBox.Item key={tag.id} id={String(tag.id)} textValue={tag.name}>
                <span className="prospect-tag-option">
                  <TagColorDot color={tag.color} />
                  {tag.name}
                </span>
              </ListBox.Item>
            ))}
          </ListBox>
        </Select.Popover>
      </Select>
    </>
  );

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (prospect: ProspectRecord) => {
    setEditing(prospect);
    setFormOpen(true);
  };

  const rowActions = (prospect: ProspectRecord) => {
    // El convertido es historial inmutable: el backend rechaza editar, convertir y borrar, así que
    // el menú solo ofrece la consulta en lugar de acciones que fallarían.
    const editable = prospect.status !== 'CONVERTED';

    return (
      <Dropdown>
        <Button
          className="inventory-actions-trigger"
          isIconOnly
          size="sm"
          variant="ghost"
          aria-label={`Acciones para ${prospect.displayName}`}
        >
          <EllipsisVertical className="text-muted" width={17} height={17} />
        </Button>
        <Dropdown.Popover className="inventory-actions-popover" placement="bottom end">
          <Dropdown.Menu
            aria-label={`Acciones para ${prospect.displayName}`}
            onAction={(key) => {
              if (String(key) === 'view') setDetailId(prospect.id);
              if (String(key) === 'edit') openEdit(prospect);
              if (String(key) === 'convert') setConvertTarget(prospect);
              if (String(key) === 'delete') setDeleteTarget(prospect);
            }}
          >
            <Dropdown.Section>
              <Dropdown.Item id="view" textValue="Detalles del prospecto">
                <Eye className="size-4 shrink-0 text-muted" aria-hidden="true" />
                <Label>Detalles</Label>
              </Dropdown.Item>
              {canUpdate && editable && (
                <Dropdown.Item id="edit" textValue="Editar prospecto">
                  <Pencil className="size-4 shrink-0 text-muted" aria-hidden="true" />
                  <Label>Editar</Label>
                </Dropdown.Item>
              )}
              {canConvert && editable && (
                <Dropdown.Item id="convert" textValue="Convertir en cliente">
                  <PersonMagnifier className="size-4 shrink-0 text-muted" aria-hidden="true" />
                  <Label>Convertir</Label>
                </Dropdown.Item>
              )}
            </Dropdown.Section>
            {canDelete && editable && <Separator />}
            {canDelete && editable && (
              <Dropdown.Section>
                <Dropdown.Item id="delete" textValue="Eliminar prospecto" variant="danger">
                  <TrashBin className="size-4 shrink-0 text-danger" aria-hidden="true" />
                  <Label>Eliminar</Label>
                </Dropdown.Item>
              </Dropdown.Section>
            )}
          </Dropdown.Menu>
        </Dropdown.Popover>
      </Dropdown>
    );
  };

  return (
    <section className="customers-layout agreements-layout prospects-layout">
      <header className="customers-heading">
        <div>
          <h2>Prospectos</h2>
          <Chip>{listQuery.data?.pagination.total ?? 0}</Chip>
        </div>
        <div className="prospects-heading-actions">
          {canManageTags && (
            <Button variant="secondary" onPress={() => setTagsOpen(true)}>
              <TagIcon width={17} height={17} />
              Etiquetas
            </Button>
          )}
          {canCreate && (
            <Button variant="primary" onPress={openCreate}>
              <Plus width={17} height={17} />
              Crear prospecto
            </Button>
          )}
        </div>
      </header>

      <div className="customers-toolbar prospects-toolbar">
        <div className="customers-filters prospects-filters">
          <Button
            variant="secondary"
            aria-label={
              activeFilters.length ? `Filtros, ${activeFilters.length} aplicados` : 'Filtros'
            }
            onPress={() => setFiltersOpen(true)}
          >
            <Funnel width={17} height={17} />
            Filtros
            {activeFilters.length > 0 && <Chip color="accent">{activeFilters.length}</Chip>}
          </Button>
          {activeFilters.length > 0 && (
            <Button size="sm" variant="danger-soft" onPress={clearAllFilters}>
              <Xmark width={15} height={15} />
              Limpiar
            </Button>
          )}
        </div>
        <div className="customers-search">
          <SearchField
            value={searchDraft}
            onChange={setSearchDraft}
            onSubmit={() => applySearch(searchDraft)}
            onClear={() => {
              setSearchDraft('');
              applySearch('');
            }}
            aria-label="Buscar prospectos"
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Buscar nombre, empresa, documento…" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
        </div>
      </div>

      {/* Los filtros viven siempre en el panel, así que pueden crecer sin tocar la barra. Los chips
          solo muestran qué está aplicado; quitarlos se hace desde el propio chip o con "Limpiar
          filtro" en la barra. */}
      {activeFilters.length > 0 && (
        <div className="prospects-active-filters">
          {activeFilters.map((filter) => (
            <button
              key={filter.key}
              type="button"
              className="prospects-active-filter"
              aria-label={`Quitar el filtro ${filter.label}`}
              onClick={filter.clear}
            >
              {filter.label}
              <Xmark width={12} height={12} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}

      {listQuery.isError ? (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Title>No pudimos cargar los prospectos</Alert.Title>
            <Alert.Description>{messageFrom(listQuery.error)}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : (
        <Table className="inventory-products-table customers-table prospects-table agreements-table">
          <Table.ScrollContainer>
            <Table.Content
              aria-label="Prospectos del CRM"
              selectionMode="multiple"
              selectedKeys={currentPageSelection}
              onSelectionChange={updatePageSelection}
            >
              <Table.Header>
                <Table.Column id="selection" className="inventory-selection-column">
                  <Checkbox
                    slot="selection"
                    aria-label="Seleccionar todos los prospectos de esta página"
                  >
                    <Checkbox.Content>
                      <Checkbox.Control>
                        <Checkbox.Indicator />
                      </Checkbox.Control>
                    </Checkbox.Content>
                  </Checkbox>
                </Table.Column>
                <Table.Column isRowHeader>Prospecto</Table.Column>
                <Table.Column>Teléfono</Table.Column>
                <Table.Column>Correo</Table.Column>
                <Table.Column>País</Table.Column>
                <Table.Column>Convenio</Table.Column>
                <Table.Column>Etiquetas</Table.Column>
                <Table.Column>Estado</Table.Column>
                <Table.Column>Comercial</Table.Column>
                <Table.Column>Origen</Table.Column>
                <Table.Column>Actualizado</Table.Column>
                {/* La cabecera queda sin texto: el icono de acciones se explica solo y así la
                    columna fija ocupa lo mínimo. El nombre accesible va en el aria-label. */}
                <Table.Column
                  className="inventory-actions-column prospects-actions-column"
                  aria-label="Acciones"
                />
              </Table.Header>
              <Table.Body
                renderEmptyState={() =>
                  listQuery.isPending ? (
                    <div className="customers-empty">
                      <Spinner />
                      <span>Cargando prospectos…</span>
                    </div>
                  ) : (
                    <EmptyState className="customers-empty">
                      <PersonMagnifier width={28} height={28} />
                      <strong>No encontramos prospectos</strong>
                      <span>Prueba con otra búsqueda o cambia los filtros.</span>
                    </EmptyState>
                  )
                }
              >
                {rows.map((prospect) => {
                  const status = prospectStatusMeta[prospect.status];
                  return (
                    <Table.Row key={prospect.id} id={prospect.id}>
                      <Table.Cell className="inventory-selection-cell">
                        <Checkbox
                          slot="selection"
                          aria-label={`Seleccionar prospecto ${prospect.displayName}`}
                          variant="secondary"
                        >
                          <Checkbox.Content>
                            <Checkbox.Control>
                              <Checkbox.Indicator />
                            </Checkbox.Control>
                          </Checkbox.Content>
                        </Checkbox>
                      </Table.Cell>
                      <Table.Cell {...ignoreRowPress}>
                        <div className="customer-name-cell">
                          <Avatar size="sm" className={customerAvatarClass(prospect.id)}>
                            <Avatar.Fallback>{customerInitials(prospect)}</Avatar.Fallback>
                          </Avatar>
                          <div className="prospect-name-text">
                            <strong title={prospect.displayName}>{prospect.displayName}</strong>
                            {prospect.company && prospect.company !== prospect.displayName && (
                              <span title={prospect.company}>{prospect.company}</span>
                            )}
                          </div>
                        </div>
                      </Table.Cell>
                      <Table.Cell {...ignoreRowPress}>
                        <ProspectPhone phone={prospect.phone} country={prospect.country} />
                      </Table.Cell>
                      <Table.Cell {...ignoreRowPress}>{prospect.email ?? '--'}</Table.Cell>
                      <Table.Cell {...ignoreRowPress}>
                        <span className="customer-country-cell">
                          <strong>
                            {prospect.country && (
                              <img src={customerCountryFlagPath(prospect.country)} alt="" />
                            )}
                            {prospect.location.countryName || '--'}
                          </strong>
                        </span>
                      </Table.Cell>
                      <Table.Cell {...ignoreRowPress}>
                        {prospect.agreement?.companyName ?? '--'}
                      </Table.Cell>
                      <Table.Cell {...ignoreRowPress}>
                        {prospect.tags.length === 0 ? (
                          '--'
                        ) : (
                          <div className="prospect-tag-cell">
                            {prospect.tags.map((tag) => (
                              <TagChip key={tag.id} tag={tag} />
                            ))}
                          </div>
                        )}
                      </Table.Cell>
                      <Table.Cell {...ignoreRowPress}>
                        <Chip color={status.color}>{status.label}</Chip>
                      </Table.Cell>
                      <Table.Cell {...ignoreRowPress}>
                        {prospect.assignedUser?.name ?? '--'}
                      </Table.Cell>
                      <Table.Cell {...ignoreRowPress}>
                        {prospectSourceMeta[prospect.source]}
                      </Table.Cell>
                      <Table.Cell {...ignoreRowPress}>{dateOnly(prospect.updatedAt)}</Table.Cell>
                      <Table.Cell {...ignoreRowPress} className="prospects-actions-cell">
                        <div className="inventory-row-actions">{rowActions(prospect)}</div>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
          {rows.length > 0 && (
            <Table.Footer>
              <Pagination aria-label="Paginación de prospectos">
                <Pagination.Summary>
                  <span className="customers-page-size-control">
                    Filas por página
                    <Select
                      className="customers-page-size"
                      aria-label="Filas por página"
                      variant="secondary"
                      selectedKey={String(filters.pageSize)}
                      onSelectionChange={(key) =>
                        setFilters((current) => ({
                          ...current,
                          pageSize: Number(key),
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
                            <ListBox.Item key={size} id={String(size)} textValue={String(size)}>
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
                      isDisabled={filters.page <= 1 || listQuery.isFetching}
                      onPress={() =>
                        setFilters((current) => ({ ...current, page: current.page - 1 }))
                      }
                    >
                      <Pagination.PreviousIcon />
                      Anterior
                    </Pagination.Previous>
                  </Pagination.Item>
                  {getPaginationItems(filters.page, totalPages).map((item, index) =>
                    item === 'ellipsis' ? (
                      <Pagination.Item key={`ellipsis-${index}`}>
                        <Pagination.Ellipsis />
                      </Pagination.Item>
                    ) : (
                      <Pagination.Item key={item}>
                        <Pagination.Link
                          isActive={item === filters.page}
                          isDisabled={listQuery.isFetching}
                          onPress={() => setFilters((current) => ({ ...current, page: item }))}
                        >
                          {item}
                        </Pagination.Link>
                      </Pagination.Item>
                    ),
                  )}
                  <Pagination.Item>
                    <Pagination.Next
                      isDisabled={filters.page >= totalPages || listQuery.isFetching}
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

      <ProspectForm
        key={`${editing?.id ?? 'new'}-${formOpen}`}
        isOpen={formOpen}
        prospect={editing}
        isSubmitting={saveProspect.isPending}
        defaultAssignedUserId={user?.id}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSubmit={(value, tagIds) => saveProspect.mutateAsync({ value, tagIds }).then(() => {})}
      />

      <Drawer
        isOpen={filtersOpen}
        onOpenChange={(open) => {
          if (!open) setFiltersOpen(false);
        }}
      >
        <Drawer.Backdrop>
          <Drawer.Content placement="right">
            <Drawer.Dialog className="customer-detail-drawer prospect-filters-drawer">
              <Drawer.CloseTrigger aria-label="Cerrar filtros" />
              <Drawer.Header>
                <div>
                  <Drawer.Heading>Filtros</Drawer.Heading>
                  <p>Acota la lista de prospectos sin salir del panel.</p>
                </div>
              </Drawer.Header>
              <Drawer.Body>
                <div className="prospect-filters-panel">{filterControls}</div>
              </Drawer.Body>
              <Drawer.Footer>
                <Button
                  variant="ghost"
                  isDisabled={activeFilters.length === 0}
                  onPress={clearAllFilters}
                >
                  Limpiar todo
                </Button>
                <Button variant="primary" onPress={() => setFiltersOpen(false)}>
                  Ver resultados
                </Button>
              </Drawer.Footer>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>

      <Drawer
        isOpen={detailId !== null}
        onOpenChange={(open) => {
          if (!open) setDetailId(null);
        }}
      >
        <Drawer.Backdrop>
          <Drawer.Content placement="right">
            <Drawer.Dialog className="customer-detail-drawer prospect-detail-drawer">
              <Drawer.CloseTrigger aria-label="Cerrar detalle" />
              <Drawer.Header>
                <div>
                  <Drawer.Heading>Detalle del prospecto</Drawer.Heading>
                  <p>Información comercial antes de pasar a Clientes</p>
                </div>
              </Drawer.Header>
              <Drawer.Body>
                <ProspectDetail
                  prospect={detailQuery.data ?? null}
                  isLoading={detailQuery.isPending}
                  error={detailQuery.error}
                  canConvert={canConvert}
                  isConverting={linkProspect.isPending}
                  onConvert={() => {
                    // El formulario de Clientes se abre precargado: no hay conversión mágica.
                    if (detailQuery.data) setConvertTarget(detailQuery.data);
                  }}
                  onOpenCustomer={(customerId) => {
                    // El cliente ya no pertenece a este panel: se gestiona en Clientes, y el enlace
                    // abre su ficha directamente.
                    setDetailId(null);
                    void navigate(`/customers?customer=${customerId}`);
                  }}
                />
              </Drawer.Body>
            </Drawer.Dialog>
          </Drawer.Content>
        </Drawer.Backdrop>
      </Drawer>

      {convertTarget && (
        <CustomerForm
          key={`convert-${convertTarget.id}`}
          isOpen
          mode="convert"
          prefill={{
            personType: convertTarget.personType ?? 'PERSON',
            firstName: convertTarget.firstName,
            lastName: convertTarget.lastName,
            displayName: convertTarget.displayName,
            company: convertTarget.company,
            documentType: (convertTarget.documentType ?? '') as CustomerFormPrefill['documentType'],
            documentNumber: convertTarget.documentNumber ?? '',
            checkDigit: convertTarget.checkDigit,
            email: convertTarget.email,
            phone: convertTarget.phone,
            country: convertTarget.country,
            region: convertTarget.region,
            cityCode: convertTarget.cityCode,
            cityName: convertTarget.cityName,
            postalCode: convertTarget.postalCode,
            addressLine1: convertTarget.addressLine1,
            addressLine2: convertTarget.addressLine2,
            vatResponsible: false,
            fiscalResponsibilities: ['R-99-PN'],
          }}
          isSubmitting={convertProspect.isPending}
          serverError={convertProspect.isError ? messageFrom(convertProspect.error) : ''}
          onClose={() => setConvertTarget(null)}
          onOpenExisting={(customerId) => linkProspect.mutate({ id: convertTarget.id, customerId })}
          onSubmit={(input) => convertProspect.mutateAsync(input).then(() => {})}
        />
      )}

      <TagsDialog isOpen={tagsOpen} onClose={() => setTagsOpen(false)} />

      {canDelete && (
        <AlertDialog
          isOpen={deleteTarget !== null}
          onOpenChange={(open) => {
            if (!open && !deleteProspect.isPending) setDeleteTarget(null);
          }}
        >
          <AlertDialog.Backdrop>
            <AlertDialog.Container size="sm">
              <AlertDialog.Dialog>
                <AlertDialog.Header>
                  <AlertDialog.Icon status="danger">
                    <TrashBin width={20} height={20} />
                  </AlertDialog.Icon>
                  <AlertDialog.Heading>Eliminar prospecto</AlertDialog.Heading>
                </AlertDialog.Header>
                <AlertDialog.Body>
                  <p>
                    Se eliminará <strong>{deleteTarget?.displayName}</strong> y sus etiquetas
                    asociadas. No se toca ningún cliente, convenio ni usuario.
                  </p>
                </AlertDialog.Body>
                <AlertDialog.Footer>
                  <Button
                    variant="secondary"
                    isDisabled={deleteProspect.isPending}
                    onPress={() => setDeleteTarget(null)}
                  >
                    Cancelar
                  </Button>
                  <Button
                    variant="danger"
                    isPending={deleteProspect.isPending}
                    onPress={() => deleteTarget && deleteProspect.mutate(deleteTarget.id)}
                  >
                    Eliminar prospecto
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
