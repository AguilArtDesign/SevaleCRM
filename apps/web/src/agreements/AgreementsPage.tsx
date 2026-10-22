import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  EmptyState,
  ListBox,
  SearchField,
  Spinner,
  Table,
  toast,
} from '@heroui/react';
import { Briefcase, Eye, Pencil, Plus, Xmark } from '@gravity-ui/icons';
import { hasPermission } from '@sevale/permissions';
import { getCustomerColombiaStates } from '@sevale/shared';
import type { CreateAgreementInput } from '@sevale/validation';
import { Chip } from '../components/Chip';
import { getPaginationItems, Pagination } from '../components/Pagination';
import { Select } from '../components/Select';
import { CustomerAutocomplete } from '../customers/CustomerAutocomplete';
import { useCurrentUser } from '../users/useCurrentUser';
import { agreementsApi, type AgreementActiveFilter, type AgreementRecord } from './api';
import { AgreementForm } from './AgreementForm';
import { AgreementLogo } from './AgreementLogo';
import { AgreementStatusChip, dateOnly, messageFrom } from './presentation';

type Filters = {
  search: string;
  active: AgreementActiveFilter;
  region: string;
  page: number;
  pageSize: number;
  sort: 'companyName' | 'createdAt';
  order: 'asc' | 'desc';
};

const initialFilters: Filters = {
  search: '',
  active: 'all',
  region: '',
  page: 1,
  pageSize: 20,
  sort: 'createdAt',
  order: 'desc',
};

const colombiaStates = getCustomerColombiaStates().map((state) => ({
  id: state.code,
  name: state.name,
}));

export function AgreementsPage() {
  const { user } = useCurrentUser();
  const navigate = useNavigate();
  const role = user?.role;
  const canCreate = Boolean(role && hasPermission(role, 'agreements.create'));
  const canUpdate = Boolean(role && hasPermission(role, 'agreements.update'));

  const queryClient = useQueryClient();
  const [filters, setFilters] = useState<Filters>(initialFilters);
  const [searchDraft, setSearchDraft] = useState('');
  const [formOpen, setFormOpen] = useState(false);
  const [editing, setEditing] = useState<AgreementRecord | null>(null);

  const listQuery = useQuery({
    queryKey: ['agreements', filters],
    queryFn: () => agreementsApi.list({ ...filters, sort: filters.sort }),
  });

  const saveAgreement = useMutation({
    mutationFn: async (input: CreateAgreementInput) =>
      editing ? agreementsApi.update(editing.id, input) : agreementsApi.create(input),
    onSuccess: (saved) => {
      void queryClient.invalidateQueries({ queryKey: ['agreements'] });
      setFormOpen(false);
      setEditing(null);
      toast.success(editing ? 'Convenio actualizado.' : 'Convenio creado.');
      // Al crear, ir a la ficha del convenio recién creado ahorra un paso.
      if (!editing) void navigate(`/agreements/${saved.id}`);
    },
  });

  const applySearch = (value: string) => {
    setFilters((current) => ({ ...current, search: value, page: 1 }));
  };

  const hasFilters =
    Boolean(filters.search || filters.region) ||
    filters.active !== initialFilters.active ||
    filters.sort !== initialFilters.sort ||
    filters.order !== initialFilters.order;

  const totalPages = listQuery.data?.pagination.totalPages ?? 1;

  useEffect(() => {
    // Si el filtro deja la página fuera de rango, se vuelve a la última disponible.
    if (filters.page > totalPages) {
      setFilters((current) => ({ ...current, page: totalPages }));
    }
  }, [filters.page, totalPages]);

  const rows = useMemo(() => listQuery.data?.data ?? [], [listQuery.data]);

  const openCreate = () => {
    setEditing(null);
    setFormOpen(true);
  };

  const openEdit = (agreement: AgreementRecord) => {
    setEditing(agreement);
    setFormOpen(true);
  };

  const openDetail = (agreement: AgreementRecord) => {
    void navigate(`/agreements/${agreement.id}`);
  };

  const submitForm = async (value: {
    companyName: string;
    nit: string;
    region: string;
    cityCode: string;
    postalCode: string;
    addressLine1: string;
    addressLine2: string;
    contactName: string;
    contactPosition: string;
    contactEmail: string;
    contactPhone: string;
    logoUrl: string;
    description: string;
    active: boolean;
  }) => {
    await saveAgreement.mutateAsync({
      companyName: value.companyName,
      nit: value.nit,
      region: value.region,
      cityCode: value.cityCode,
      postalCode: value.postalCode,
      addressLine1: value.addressLine1,
      addressLine2: value.addressLine2,
      contactName: value.contactName,
      contactPosition: value.contactPosition,
      contactEmail: value.contactEmail,
      contactPhone: value.contactPhone,
      logoUrl: value.logoUrl,
      description: value.description,
      active: value.active,
    } satisfies CreateAgreementInput);
  };

  return (
    <section className="customers-layout agreements-layout">
      <header className="customers-heading">
        <div>
          <h2>Convenios</h2>
          <Chip>{listQuery.data?.pagination.total ?? 0}</Chip>
        </div>
        {canCreate && (
          <Button variant="primary" onPress={openCreate}>
            <Plus width={17} height={17} />
            Crear convenio
          </Button>
        )}
      </header>

      <div className="customers-toolbar agreements-toolbar">
        <div className="customers-filters">
          <Select
            aria-label="Filtrar por estado"
            variant="secondary"
            selectedKey={filters.active}
            onSelectionChange={(key) =>
              setFilters((current) => ({
                ...current,
                active: String(key) as AgreementActiveFilter,
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
                <ListBox.Item id="active" textValue="Activos">
                  Activos
                </ListBox.Item>
                <ListBox.Item id="inactive" textValue="Inactivos">
                  Inactivos
                </ListBox.Item>
              </ListBox>
            </Select.Popover>
          </Select>
          <CustomerAutocomplete
            ariaLabel="Filtrar por departamento"
            placeholder="Todos los departamentos"
            value={filters.region}
            options={colombiaStates}
            onChange={(region) => setFilters((current) => ({ ...current, region, page: 1 }))}
          />
          <Select
            aria-label="Ordenar convenios"
            variant="secondary"
            selectedKey={`${filters.sort}:${filters.order}`}
            onSelectionChange={(selected) => {
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
                <ListBox.Item id="createdAt:desc" textValue="Más recientes">
                  Más recientes
                </ListBox.Item>
                <ListBox.Item id="companyName:asc" textValue="Empresa A–Z">
                  Empresa A–Z
                </ListBox.Item>
                <ListBox.Item id="companyName:desc" textValue="Empresa Z–A">
                  Empresa Z–A
                </ListBox.Item>
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
            aria-label="Buscar convenios"
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Buscar empresa, NIT o contacto…" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
        </div>
      </div>

      {listQuery.isError ? (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Title>No pudimos cargar los convenios</Alert.Title>
            <Alert.Description>{messageFrom(listQuery.error)}</Alert.Description>
          </Alert.Content>
        </Alert>
      ) : (
        <Table className="inventory-products-table customers-table agreements-table">
          <Table.ScrollContainer>
            <Table.Content aria-label="Convenios del CRM">
              <Table.Header>
                <Table.Column isRowHeader>Empresa</Table.Column>
                <Table.Column>NIT</Table.Column>
                <Table.Column>Contacto</Table.Column>
                <Table.Column>Ciudad</Table.Column>
                <Table.Column>Tareas pendientes</Table.Column>
                <Table.Column>Estado</Table.Column>
                <Table.Column>Fecha de creación</Table.Column>
                <Table.Column className="inventory-actions-column">Acciones</Table.Column>
              </Table.Header>
              <Table.Body
                renderEmptyState={() =>
                  listQuery.isPending ? (
                    <div className="customers-empty">
                      <Spinner />
                      <span>Cargando convenios…</span>
                    </div>
                  ) : (
                    <EmptyState className="customers-empty">
                      <Briefcase width={28} height={28} />
                      <strong>No encontramos convenios</strong>
                      <span>Prueba con otra búsqueda o cambia el filtro de estado.</span>
                    </EmptyState>
                  )
                }
              >
                {rows.map((agreement) => (
                  <Table.Row key={agreement.id} id={agreement.id}>
                    <Table.Cell>
                      <div className="agreement-company-cell">
                        <AgreementLogo src={agreement.logoUrl} name={agreement.companyName} />
                        <button
                          type="button"
                          className="agreement-name-cell"
                          onClick={() => openDetail(agreement)}
                        >
                          <strong>{agreement.companyName}</strong>
                        </button>
                      </div>
                    </Table.Cell>
                    <Table.Cell>{agreement.nit ?? '--'}</Table.Cell>
                    <Table.Cell>
                      {agreement.contactName ? (
                        <div className="agreement-contact-cell">
                          <strong>{agreement.contactName}</strong>
                          {agreement.contactPosition && <span>{agreement.contactPosition}</span>}
                        </div>
                      ) : (
                        '--'
                      )}
                    </Table.Cell>
                    <Table.Cell>{agreement.cityName ?? '--'}</Table.Cell>
                    <Table.Cell>
                      {agreement.pendingTasks > 0 ? (
                        <Chip color="warning">{agreement.pendingTasks}</Chip>
                      ) : (
                        <span className="text-muted">0</span>
                      )}
                    </Table.Cell>
                    <Table.Cell>
                      <AgreementStatusChip active={agreement.active} />
                    </Table.Cell>
                    <Table.Cell>{dateOnly(agreement.createdAt)}</Table.Cell>
                    <Table.Cell>
                      <div className="inventory-row-actions">
                        <Button
                          size="sm"
                          variant="ghost"
                          isIconOnly
                          aria-label={`Ver ${agreement.companyName}`}
                          onPress={() => openDetail(agreement)}
                        >
                          <Eye width={15} height={15} />
                        </Button>
                        {canUpdate && (
                          <Button
                            size="sm"
                            variant="ghost"
                            isIconOnly
                            aria-label={`Editar ${agreement.companyName}`}
                            onPress={() => openEdit(agreement)}
                          >
                            <Pencil width={15} height={15} />
                          </Button>
                        )}
                      </div>
                    </Table.Cell>
                  </Table.Row>
                ))}
              </Table.Body>
            </Table.Content>
          </Table.ScrollContainer>
          {rows.length > 0 && (
            <Table.Footer>
              <Pagination aria-label="Paginación de convenios">
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

      <AgreementForm
        isOpen={formOpen}
        agreement={editing}
        isSubmitting={saveAgreement.isPending}
        onClose={() => {
          setFormOpen(false);
          setEditing(null);
        }}
        onSubmit={submitForm}
      />
    </section>
  );
}
