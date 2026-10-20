import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  AlertDialog,
  Alert,
  Button,
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
  EllipsisVertical,
  Eye,
  Pencil,
  PersonMagnifier,
  Plus,
  Tag as TagIcon,
  TrashBin,
  Xmark,
} from '@gravity-ui/icons';
import { hasPermission } from '@sevale/permissions';
import type { CreateCustomerInput } from '@sevale/validation';
import { Chip } from '../components/Chip';
import { getPaginationItems, Pagination } from '../components/Pagination';
import { Select } from '../components/Select';
import { CustomerAutocomplete } from '../customers/CustomerAutocomplete';
import { CustomerForm, type CustomerFormPrefill } from '../customers/CustomerForm';
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
import { TagsDialog } from './TagsDialog';
import {
  dateOnly,
  messageFrom,
  prospectContactLines,
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
    notes: value.notes,
    tagIds,
  };
}

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

  useEffect(() => {
    if (filters.page > totalPages) {
      setFilters((current) => ({ ...current, page: totalPages }));
    }
  }, [filters.page, totalPages]);

  const hasFilters =
    Boolean(
      filters.search ||
      filters.source ||
      filters.assignedUserId ||
      filters.unassigned ||
      filters.agreementId ||
      filters.tagId,
    ) || filters.status !== initialFilters.status;

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (prospect: ProspectRecord) => {
    setEditing(prospect);
    setFormOpen(true);
  };

  const rowActions = (prospect: ProspectRecord) => (
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
            <Dropdown.Item id="view" textValue="Ver prospecto">
              <Eye className="size-4 shrink-0 text-muted" aria-hidden="true" />
              <Label>Ver prospecto</Label>
            </Dropdown.Item>
            {canUpdate && (
              <Dropdown.Item id="edit" textValue="Editar prospecto">
                <Pencil className="size-4 shrink-0 text-muted" aria-hidden="true" />
                <Label>Editar</Label>
              </Dropdown.Item>
            )}
            {canConvert && (
              <Dropdown.Item id="convert" textValue="Convertir en cliente">
                <PersonMagnifier className="size-4 shrink-0 text-muted" aria-hidden="true" />
                <Label>Convertir en cliente</Label>
              </Dropdown.Item>
            )}
          </Dropdown.Section>
          {canDelete && <Separator />}
          {canDelete && (
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
        <div className="customers-filters">
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
                source:
                  String(key) === 'all' ? '' : (String(key) as keyof typeof prospectSourceMeta),
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
            onChange={(agreementId) =>
              setFilters((current) => ({ ...current, agreementId, page: 1 }))
            }
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
                    {tag.name}
                  </ListBox.Item>
                ))}
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
            <Table.Content aria-label="Prospectos del CRM">
              <Table.Header>
                <Table.Column isRowHeader>Prospecto</Table.Column>
                <Table.Column>Contacto</Table.Column>
                <Table.Column>Convenio</Table.Column>
                <Table.Column>Etiquetas</Table.Column>
                <Table.Column>Estado</Table.Column>
                <Table.Column>Comercial</Table.Column>
                <Table.Column>Origen</Table.Column>
                <Table.Column>Actualizado</Table.Column>
                <Table.Column className="inventory-actions-column">Acciones</Table.Column>
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
                  const contact = prospectContactLines(prospect);
                  const status = prospectStatusMeta[prospect.status];
                  return (
                    <Table.Row key={prospect.id} id={prospect.id}>
                      <Table.Cell>
                        <button
                          type="button"
                          className="agreement-name-cell"
                          onClick={() => setDetailId(prospect.id)}
                        >
                          <strong>{prospect.displayName}</strong>
                          {prospect.company && prospect.company !== prospect.displayName && (
                            <span>{prospect.company}</span>
                          )}
                        </button>
                      </Table.Cell>
                      <Table.Cell>
                        {contact.length === 0 ? (
                          '--'
                        ) : (
                          <div className="agreement-contact-cell">
                            {contact.map((line) => (
                              <span key={line}>{line}</span>
                            ))}
                          </div>
                        )}
                      </Table.Cell>
                      <Table.Cell>{prospect.agreement?.companyName ?? '--'}</Table.Cell>
                      <Table.Cell>
                        {prospect.tags.length === 0 ? (
                          '--'
                        ) : (
                          <div className="prospect-tag-cell">
                            {prospect.tags.map((tag) => (
                              <Chip key={tag.id} color="default">
                                {tag.name}
                              </Chip>
                            ))}
                          </div>
                        )}
                      </Table.Cell>
                      <Table.Cell>
                        <Chip color={status.color}>{status.label}</Chip>
                      </Table.Cell>
                      <Table.Cell>{prospect.assignedUser?.name ?? '--'}</Table.Cell>
                      <Table.Cell>{prospectSourceMeta[prospect.source]}</Table.Cell>
                      <Table.Cell>{dateOnly(prospect.updatedAt)}</Table.Cell>
                      <Table.Cell>
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
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSubmit={(value, tagIds) => saveProspect.mutateAsync({ value, tagIds }).then(() => {})}
      />

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
