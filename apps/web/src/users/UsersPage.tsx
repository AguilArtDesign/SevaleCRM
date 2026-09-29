import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  AlertDialog,
  Avatar,
  Button,
  Description,
  Dropdown,
  Label,
  ListBox,
  Modal,
  Radio,
  RadioGroup,
  SearchField,
  Separator,
  Spinner,
  Switch,
  Table,
  TextField,
  Typography,
  toast,
} from '@heroui/react';
import { EllipsisVertical, Pencil, PersonPlus, Persons, TrashBin, Xmark } from '@gravity-ui/icons';
import { createUserSchema, updateUserSchema } from '@sevale/validation';
import { Chip } from '../components/Chip';
import { Input } from '../components/Input';
import { getPaginationItems, Pagination } from '../components/Pagination';
import { Select } from '../components/Select';
import { usersApi, type UserRecord, type UserRole } from './api';
import { userAvatarGradient, userAvatarSeed, userInitials } from './presentation';
import { useCurrentUser } from './useCurrentUser';

const pageSizeOptions = [10, 20, 50, 100];

const emptyValue = '--';

const roleFilterOptions: { value: UserRole | ''; label: string }[] = [
  { value: '', label: 'Todos los roles' },
  { value: 'ADMIN', label: 'Administrador' },
  { value: 'COMMERCIAL', label: 'Comercial' },
  { value: 'LOGISTICS', label: 'Logística' },
];

const roleOptions: { value: UserRole; label: string; description: string }[] = [
  {
    value: 'ADMIN',
    label: 'Administrador',
    description: 'Acceso completo y administración de usuarios.',
  },
  {
    value: 'COMMERCIAL',
    label: 'Comercial',
    description: 'Consulta el inventario para la operación comercial.',
  },
  {
    value: 'LOGISTICS',
    label: 'Logística',
    description: 'Consulta el inventario para la operación logística.',
  },
];

const roleLabels: Record<UserRole, string> = {
  ADMIN: 'Administrador',
  COMMERCIAL: 'Comercial',
  LOGISTICS: 'Logística',
};

type FormMode = 'create' | 'edit' | null;

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'No pudimos completar la solicitud.';
}

function formatDate(value: string | null): string {
  if (!value) return 'Sin acceso registrado';
  return new Intl.DateTimeFormat('es-CO', {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

export function UsersPage() {
  const { user: currentUser } = useCurrentUser();
  const [users, setUsers] = useState<UserRecord[]>([]);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState<UserRole | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [formError, setFormError] = useState('');
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [role, setRole] = useState<UserRole>('COMMERCIAL');
  const [active, setActive] = useState(true);
  const [deleteTarget, setDeleteTarget] = useState<UserRecord | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadUsers = async () => {
    setIsLoading(true);
    try {
      const result = await usersApi.list({
        search,
        role: roleFilter,
        page,
        pageSize,
      });
      setUsers(result.data);
      setTotal(result.pagination.total);
      setTotalPages(result.pagination.totalPages);
      if (page > result.pagination.totalPages) setPage(result.pagination.totalPages);
    } catch (loadError) {
      toast.danger('No pudimos cargar los usuarios.', { description: messageFrom(loadError) });
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, [search, roleFilter, page, pageSize]);

  const closeForm = () => {
    setFormMode(null);
    setEditingId(null);
    setFormError('');
    setName('');
    setEmail('');
    setSellerId('');
    setRole('COMMERCIAL');
    setActive(true);
  };

  const openCreate = () => {
    closeForm();
    setFormMode('create');
  };

  const openEdit = (selected: UserRecord) => {
    setFormMode('edit');
    setEditingId(selected.id);
    setName(selected.name);
    setEmail(selected.email);
    setSellerId(selected.sellerId === null ? '' : String(selected.sellerId));
    setRole(selected.role);
    setActive(selected.active);
  };

  const applySearch = (value: string) => {
    setSearch(value.trim());
    setPage(1);
  };

  const clearFilters = () => {
    setSearchDraft('');
    setSearch('');
    setRoleFilter('');
    setPage(1);
  };

  const hasFilters = Boolean(search || roleFilter);

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setFormError('');

    const values = { name, email, sellerId, role, active };
    const createResult = formMode === 'create' ? createUserSchema.safeParse(values) : null;
    const updateResult = formMode === 'edit' ? updateUserSchema.safeParse(values) : null;
    const validationError = createResult?.error ?? updateResult?.error;
    if (validationError) {
      setFormError(validationError.issues[0]?.message || 'Revisa los datos ingresados.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (createResult?.success) {
        await usersApi.create(createResult.data);
        toast.success('Usuario creado. Ya puede iniciar sesión con un código enviado por correo.');
      } else if (updateResult?.success && editingId) {
        const {
          name: nextName,
          sellerId: nextSellerId,
          role: nextRole,
          active: nextActive,
        } = updateResult.data;
        await usersApi.update(
          editingId,
          editingId === currentUser?.id
            ? { name: nextName, sellerId: nextSellerId }
            : { name: nextName, sellerId: nextSellerId, role: nextRole, active: nextActive },
        );
        toast.success('Los cambios del usuario se guardaron correctamente.');
      }
      closeForm();
      await loadUsers();
    } catch (submitError) {
      setFormError(messageFrom(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  const removeUser = async () => {
    if (!deleteTarget || isDeleting) return;
    const target = deleteTarget;
    setIsDeleting(true);
    try {
      await usersApi.remove(target.id);
      setDeleteTarget(null);
      toast.success(`El usuario “${target.name}” fue eliminado definitivamente.`);
      await loadUsers();
    } catch (deleteError) {
      toast.danger(`No pudimos eliminar el usuario “${target.name}”.`, {
        description: messageFrom(deleteError),
      });
    } finally {
      setIsDeleting(false);
    }
  };

  return (
    <section className="users-layout">
      <header className="users-heading">
        <div>
          <h2>Usuarios</h2>
          <Chip>{total}</Chip>
        </div>
        <Button variant="primary" onPress={openCreate}>
          <PersonPlus width={18} height={18} />
          Nuevo usuario
        </Button>
      </header>

      <div className="users-toolbar">
        <div className="users-filters">
          <Select
            aria-label="Filtrar por rol"
            value={roleFilter}
            variant="secondary"
            onChange={(selected) => {
              setRoleFilter(String(selected) as UserRole | '');
              setPage(1);
            }}
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                {roleFilterOptions.map((option) => (
                  <ListBox.Item key={option.value || 'ALL'} id={option.value}>
                    {option.label}
                  </ListBox.Item>
                ))}
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
        <div className="users-search">
          <SearchField
            aria-label="Buscar usuarios"
            value={searchDraft}
            onChange={setSearchDraft}
            onSubmit={applySearch}
            onClear={() => {
              setSearchDraft('');
              applySearch('');
            }}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Buscar nombre o correo…" />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
        </div>
      </div>

      {isLoading ? (
        <div className="users-state" aria-live="polite">
          <Spinner />
          <span>Cargando usuarios…</span>
        </div>
      ) : users.length === 0 ? (
        <div className="users-state">
          <Persons width={30} height={30} />
          <strong>No encontramos usuarios</strong>
          <span>Prueba con otro nombre o correo.</span>
        </div>
      ) : (
        <Table className="inventory-products-table users-table">
          <Table.ScrollContainer>
            <Table.Content aria-label="Usuarios del CRM">
              <Table.Header>
                <Table.Column isRowHeader>Usuario</Table.Column>
                <Table.Column>Seller ID</Table.Column>
                <Table.Column>Rol</Table.Column>
                <Table.Column>Estado</Table.Column>
                <Table.Column>Último acceso</Table.Column>
                <Table.Column className="inventory-actions-column">Acciones</Table.Column>
              </Table.Header>
              <Table.Body>
                {users.map((listedUser) => (
                  <Table.Row key={listedUser.id} id={listedUser.id}>
                    <Table.Cell>
                      <div className="user-identity">
                        <Avatar size="sm" aria-hidden="true">
                          <Avatar.Fallback
                            className="user-avatar-fallback"
                            style={userAvatarGradient(userAvatarSeed(listedUser))}
                          >
                            {userInitials(listedUser.name)}
                          </Avatar.Fallback>
                        </Avatar>
                        <div>
                          <strong>{listedUser.name}</strong>
                          <span>{listedUser.email}</span>
                        </div>
                      </div>
                    </Table.Cell>
                    <Table.Cell>{listedUser.sellerId ?? emptyValue}</Table.Cell>
                    <Table.Cell>{roleLabels[listedUser.role]}</Table.Cell>
                    <Table.Cell>
                      <Chip color={listedUser.active ? 'success' : 'default'}>
                        {listedUser.active ? 'Activo' : 'Inactivo'}
                      </Chip>
                    </Table.Cell>
                    <Table.Cell>{formatDate(listedUser.lastLoginAt)}</Table.Cell>
                    <Table.Cell>
                      <div className="inventory-row-actions">
                        <Dropdown>
                          <Button
                            className="inventory-actions-trigger"
                            isIconOnly
                            size="sm"
                            variant="ghost"
                            aria-label={`Acciones para ${listedUser.name}`}
                          >
                            <EllipsisVertical className="text-muted" width={17} height={17} />
                          </Button>
                          <Dropdown.Popover
                            className="inventory-actions-popover"
                            placement="bottom end"
                          >
                            <Dropdown.Menu
                              aria-label={`Acciones para ${listedUser.name}`}
                              onAction={(key) => {
                                if (String(key) === 'edit') openEdit(listedUser);
                                if (String(key) === 'delete') setDeleteTarget(listedUser);
                              }}
                            >
                              <Dropdown.Section>
                                <Dropdown.Item id="edit" textValue="Editar usuario">
                                  <Pencil
                                    className="size-4 shrink-0 text-muted"
                                    aria-hidden="true"
                                  />
                                  <Label>Editar</Label>
                                </Dropdown.Item>
                              </Dropdown.Section>
                              {listedUser.id !== currentUser?.id && (
                                <>
                                  <Separator />
                                  <Dropdown.Section>
                                    <Dropdown.Item
                                      id="delete"
                                      textValue="Eliminar usuario"
                                      variant="danger"
                                    >
                                      <TrashBin
                                        className="size-4 shrink-0 text-danger"
                                        aria-hidden="true"
                                      />
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
          <Table.Footer>
            <Pagination aria-label="Paginación de usuarios">
              <Pagination.Summary>
                <span className="users-page-size-control">
                  Filas por página
                  <Select
                    className="users-page-size"
                    value={String(pageSize)}
                    aria-label="Filas por página"
                    onChange={(selected) => {
                      setPageSize(Number(selected));
                      setPage(1);
                    }}
                  >
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {pageSizeOptions.map((size) => (
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
                    isDisabled={page <= 1 || isLoading}
                    onPress={() => setPage((value) => Math.max(1, value - 1))}
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
                        isDisabled={isLoading}
                        onPress={() => setPage(item)}
                      >
                        {item}
                      </Pagination.Link>
                    </Pagination.Item>
                  ),
                )}
                <Pagination.Item>
                  <Pagination.Next
                    isDisabled={page >= totalPages || isLoading}
                    onPress={() => setPage((value) => Math.min(totalPages, value + 1))}
                  >
                    Siguiente
                    <Pagination.NextIcon />
                  </Pagination.Next>
                </Pagination.Item>
              </Pagination.Content>
            </Pagination>
          </Table.Footer>
        </Table>
      )}

      <Modal
        isOpen={formMode !== null}
        onOpenChange={(open) => {
          if (!open && !isSubmitting) closeForm();
        }}
      >
        <Modal.Backdrop>
          <Modal.Container size="sm" placement="center" scroll="inside">
            <Modal.Dialog className="user-form-modal">
              <Modal.CloseTrigger aria-label="Cerrar formulario">
                <Xmark />
              </Modal.CloseTrigger>
              <Modal.Header>
                <div>
                  <Modal.Heading>
                    {formMode === 'create' ? 'Crear usuario' : 'Editar usuario'}
                  </Modal.Heading>
                  <p>
                    {formMode === 'create'
                      ? 'Define el acceso inicial de la nueva cuenta.'
                      : 'Actualiza el seller id, el rol o el estado de la cuenta.'}
                  </p>
                </div>
              </Modal.Header>
              <form onSubmit={(event) => void handleSubmit(event)} noValidate>
                <Modal.Body className="user-form-body">
                  {formError && (
                    <Alert status="danger">
                      <Alert.Content>
                        <Alert.Description>{formError}</Alert.Description>
                      </Alert.Content>
                    </Alert>
                  )}

                  <TextField fullWidth name="name" isRequired>
                    <Label>Nombre completo</Label>
                    <Input
                      variant="secondary"
                      value={name}
                      onChange={(event) => setName(event.target.value)}
                    />
                  </TextField>
                  <TextField
                    fullWidth
                    name="email"
                    type="email"
                    isRequired
                    isDisabled={formMode === 'edit'}
                  >
                    <Label>Correo electrónico</Label>
                    <Input
                      variant="secondary"
                      value={email}
                      onChange={(event) => setEmail(event.target.value)}
                    />
                  </TextField>

                  <TextField fullWidth name="sellerId" inputMode="numeric" isRequired>
                    <Label>Seller ID de Siigo</Label>
                    <Input
                      variant="secondary"
                      placeholder="Ej. 1538"
                      value={sellerId}
                      onChange={(event) => setSellerId(event.target.value.replace(/[^0-9]/g, ''))}
                    />
                    <Description>
                      Identificador del vendedor en Siigo. No puede repetirse entre usuarios.
                    </Description>
                  </TextField>

                  <RadioGroup
                    value={role}
                    onChange={(value) => setRole(value as UserRole)}
                    className="role-group"
                    isDisabled={editingId === currentUser?.id}
                  >
                    <Label>Rol y permisos</Label>
                    {roleOptions.map((option) => (
                      <Radio key={option.value} value={option.value}>
                        <Radio.Content>
                          <Radio.Control>
                            <Radio.Indicator />
                          </Radio.Control>
                          <span className="role-copy">
                            <strong>{option.label}</strong>
                            <small>{option.description}</small>
                          </span>
                        </Radio.Content>
                      </Radio>
                    ))}
                  </RadioGroup>

                  <div className="user-status-control">
                    <div>
                      <strong>Usuario activo</strong>
                      <span>Las cuentas inactivas no pueden iniciar sesión.</span>
                    </div>
                    <Switch
                      aria-label="Usuario activo"
                      isSelected={active}
                      onChange={setActive}
                      isDisabled={editingId === currentUser?.id}
                    >
                      <Switch.Content>
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                      </Switch.Content>
                    </Switch>
                  </div>

                  {editingId === currentUser?.id && (
                    <Typography.Paragraph color="muted" size="sm">
                      Por seguridad no puedes cambiar tu propio rol ni desactivar tu cuenta.
                    </Typography.Paragraph>
                  )}
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="ghost" onPress={closeForm} isDisabled={isSubmitting}>
                    Cancelar
                  </Button>
                  <Button type="submit" variant="primary" isPending={isSubmitting}>
                    {formMode === 'create' ? 'Crear usuario' : 'Guardar cambios'}
                  </Button>
                </Modal.Footer>
              </form>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <AlertDialog
        isOpen={deleteTarget !== null}
        onOpenChange={(open) => !open && !isDeleting && setDeleteTarget(null)}
      >
        <AlertDialog.Backdrop>
          <AlertDialog.Container size="sm">
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger">
                  <TrashBin />
                </AlertDialog.Icon>
                <AlertDialog.Heading>Eliminar usuario</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                Se eliminará definitivamente <strong>{deleteTarget?.name}</strong>, sus sesiones,
                métodos de acceso y registros asociados. Esta acción no se puede deshacer.
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button
                  variant="ghost"
                  onPress={() => setDeleteTarget(null)}
                  isDisabled={isDeleting}
                >
                  Cancelar
                </Button>
                <Button variant="danger" onPress={() => void removeUser()} isPending={isDeleting}>
                  Eliminar definitivamente
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </section>
  );
}
