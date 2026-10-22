import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Dropdown,
  EmptyState,
  Label,
  ListBox,
  SearchField,
  Spinner,
  Table,
  toast,
} from '@heroui/react';
import { Briefcase, EllipsisVertical, Eye, Pencil, Plus, Xmark } from '@gravity-ui/icons';
import { hasPermission } from '@sevale/permissions';
import { customerCountryFlagPath } from '@sevale/shared';
import type { CreateAgreementInput } from '@sevale/validation';
import { Chip } from '../components/Chip';
import { getPaginationItems, Pagination } from '../components/Pagination';
import { Select } from '../components/Select';
import { useCurrentUser } from '../users/useCurrentUser';
import { agreementsApi, type AgreementActiveFilter, type AgreementRecord } from './api';
import { AgreementForm } from './AgreementForm';
import { AgreementLogo } from './AgreementLogo';
import { AgreementStatusChip, messageFrom, validityLabel } from './presentation';

type Filters = {
  search: string;
  active: AgreementActiveFilter;
  page: number;
  pageSize: number;
};

const initialFilters: Filters = {
  search: '',
  active: 'all',
  page: 1,
  pageSize: 20,
};

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
    queryFn: () => agreementsApi.list(filters),
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

  const hasFilters = Boolean(filters.search) || filters.active !== initialFilters.active;

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
    country: string;
    region: string;
    cityCode: string;
    cityName: string;
    postalCode: string;
    addressLine1: string;
    addressLine2: string;
    contactName: string;
    contactPosition: string;
    contactEmail: string;
    contactPhone: string;
    validUntil: string;
    logoUrl: string;
    description: string;
    active: boolean;
  }) => {
    await saveAgreement.mutateAsync({
      companyName: value.companyName,
      nit: value.nit,
      country: value.country,
      region: value.region,
      cityCode: value.cityCode,
      cityName: value.cityName,
      postalCode: value.postalCode,
      addressLine1: value.addressLine1,
      addressLine2: value.addressLine2,
      contactName: value.contactName,
      contactPosition: value.contactPosition,
      contactEmail: value.contactEmail,
      contactPhone: value.contactPhone,
      validUntil: value.validUntil,
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
                <Table.Column>País</Table.Column>
                <Table.Column>Tareas</Table.Column>
                <Table.Column>Estado</Table.Column>
                <Table.Column>Vigencia</Table.Column>
                {/* Sin encabezado: el botón de acciones ya se explica solo y su etiqueta accesible
                    va en cada fila. */}
                <Table.Column className="agreement-actions-column" />
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
                {rows.map((agreement) => {
                  const validity = validityLabel(agreement.validUntil);
                  return (
                    <Table.Row key={agreement.id} id={agreement.id}>
                      <Table.Cell>
                        <div className="agreement-company-cell">
                          <AgreementLogo src={agreement.logoUrl} name={agreement.companyName} />
                          <strong className="agreement-name-cell">{agreement.companyName}</strong>
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
                        <strong className="agreement-country-cell">
                          <img src={customerCountryFlagPath(agreement.country)} alt="" />
                          {agreement.countryName ?? agreement.country}
                        </strong>
                      </Table.Cell>
                      <Table.Cell>
                        <div className="agreement-task-counters">
                          {/* Cada contador aparece solo si hay tareas en ese estado: un 0 no aporta y
                            una celda vacía ya comunica que el convenio no tiene tareas. */}
                          {agreement.pendingTasks > 0 && (
                            <Chip color="warning">{agreement.pendingTasks}</Chip>
                          )}
                          {agreement.completedTasks > 0 && (
                            <Chip color="success">{agreement.completedTasks}</Chip>
                          )}
                          {agreement.cancelledTasks > 0 && (
                            <Chip color="danger">{agreement.cancelledTasks}</Chip>
                          )}
                        </div>
                      </Table.Cell>
                      <Table.Cell>
                        <AgreementStatusChip active={agreement.active} />
                      </Table.Cell>
                      <Table.Cell>
                        <span
                          className={
                            validity.expired
                              ? 'agreement-validity agreement-validity--expired'
                              : 'agreement-validity'
                          }
                          title={agreement.validUntil ?? undefined}
                        >
                          {validity.label}
                        </span>
                      </Table.Cell>
                      <Table.Cell className="agreement-actions-cell">
                        <Dropdown>
                          <Button
                            className="inventory-actions-trigger"
                            isIconOnly
                            size="sm"
                            variant="ghost"
                            aria-label={`Acciones para ${agreement.companyName}`}
                          >
                            <EllipsisVertical className="text-muted" width={17} height={17} />
                          </Button>
                          <Dropdown.Popover
                            className="inventory-actions-popover"
                            placement="bottom end"
                          >
                            <Dropdown.Menu
                              aria-label={`Acciones para ${agreement.companyName}`}
                              onAction={(key) => {
                                if (String(key) === 'view') openDetail(agreement);
                                if (String(key) === 'edit') openEdit(agreement);
                              }}
                            >
                              <Dropdown.Section>
                                <Dropdown.Item id="view" textValue="Detalles">
                                  <Eye className="size-4 shrink-0 text-muted" aria-hidden="true" />
                                  <Label>Detalles</Label>
                                </Dropdown.Item>
                                {canUpdate && (
                                  <Dropdown.Item id="edit" textValue="Editar convenio">
                                    <Pencil
                                      className="size-4 shrink-0 text-muted"
                                      aria-hidden="true"
                                    />
                                    <Label>Editar</Label>
                                  </Dropdown.Item>
                                )}
                              </Dropdown.Section>
                            </Dropdown.Menu>
                          </Dropdown.Popover>
                        </Dropdown>
                      </Table.Cell>
                    </Table.Row>
                  );
                })}
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
