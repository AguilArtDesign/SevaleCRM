import { useEffect, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Card,
  Input,
  Label,
  Radio,
  RadioGroup,
  Spinner,
  Switch,
  Table,
  TextField,
  Typography,
} from '@heroui/react';
import { Magnifier, Pencil, PersonPlus, Persons, Xmark } from '@gravity-ui/icons';
import { createUserSchema, updateUserSchema } from '@sevale/validation';
import { Chip } from '../components/Chip';
import { getPaginationItems, Pagination } from '../components/Pagination';
import { usersApi, type UserRecord, type UserRole } from './api';
import { useCurrentUser } from './useCurrentUser';

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
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<UserRole>('COMMERCIAL');
  const [active, setActive] = useState(true);

  const loadUsers = async () => {
    setIsLoading(true);
    setError('');
    try {
      const result = await usersApi.list(search, page);
      setUsers(result.data);
      setTotal(result.pagination.total);
      setTotalPages(result.pagination.totalPages);
      if (page > result.pagination.totalPages) setPage(result.pagination.totalPages);
    } catch (loadError) {
      setError(messageFrom(loadError));
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    void loadUsers();
  }, [search, page]);

  const closeForm = () => {
    setFormMode(null);
    setEditingId(null);
    setName('');
    setEmail('');
    setRole('COMMERCIAL');
    setActive(true);
  };

  const openCreate = () => {
    setError('');
    setNotice('');
    closeForm();
    setFormMode('create');
  };

  const openEdit = (selected: UserRecord) => {
    setError('');
    setNotice('');
    setFormMode('edit');
    setEditingId(selected.id);
    setName(selected.name);
    setEmail(selected.email);
    setRole(selected.role);
    setActive(selected.active);
  };

  const handleSearch = (event: FormEvent) => {
    event.preventDefault();
    setPage(1);
    setSearch(searchDraft.trim());
  };

  const handleSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');

    const payload = { name, email, role, active };
    const validation =
      formMode === 'create'
        ? createUserSchema.safeParse(payload)
        : updateUserSchema.safeParse({ name, role, active });
    if (!validation.success) {
      setError(validation.error.issues[0]?.message || 'Revisa los datos ingresados.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (formMode === 'create') {
        await usersApi.create(payload);
        setNotice('Usuario creado. Ya puede iniciar sesión con un código enviado por correo.');
      } else if (editingId) {
        await usersApi.update(
          editingId,
          editingId === currentUser?.id ? { name } : { name, role, active },
        );
        setNotice('Los cambios del usuario se guardaron correctamente.');
      }
      closeForm();
      await loadUsers();
    } catch (submitError) {
      setError(messageFrom(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <section className={`users-layout${formMode ? ' users-layout-with-form' : ''}`}>
      <Card className="users-card">
        <Card.Content className="users-card-content">
          <div className="users-toolbar">
            <form className="users-search" onSubmit={handleSearch} role="search">
              <TextField fullWidth name="search">
                <Label>Buscar usuarios</Label>
                <Input
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="Nombre o correo"
                />
              </TextField>
              <Button type="submit" variant="secondary" aria-label="Buscar">
                <Magnifier width={18} height={18} />
                Buscar
              </Button>
            </form>
            <Button variant="primary" onPress={openCreate}>
              <PersonPlus width={18} height={18} />
              Nuevo usuario
            </Button>
          </div>

          {error && !formMode && (
            <Alert status="danger">
              <Alert.Content>
                <Alert.Description>{error}</Alert.Description>
              </Alert.Content>
            </Alert>
          )}
          {notice && (
            <Alert status="success">
              <Alert.Content>
                <Alert.Description>{notice}</Alert.Description>
              </Alert.Content>
            </Alert>
          )}

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
            <Table variant="secondary">
              <Table.ScrollContainer>
                <Table.Content aria-label="Usuarios del CRM">
                  <Table.Header>
                    <Table.Column isRowHeader>Usuario</Table.Column>
                    <Table.Column>Rol</Table.Column>
                    <Table.Column>Estado</Table.Column>
                    <Table.Column>Último acceso</Table.Column>
                    <Table.Column>Acciones</Table.Column>
                  </Table.Header>
                  <Table.Body>
                    {users.map((listedUser) => (
                      <Table.Row key={listedUser.id} id={listedUser.id}>
                        <Table.Cell>
                          <div className="user-identity">
                            <strong>{listedUser.name}</strong>
                            <span>{listedUser.email}</span>
                          </div>
                        </Table.Cell>
                        <Table.Cell>{roleLabels[listedUser.role]}</Table.Cell>
                        <Table.Cell>
                          <Chip color={listedUser.active ? 'success' : 'default'}>
                            {listedUser.active ? 'Activo' : 'Inactivo'}
                          </Chip>
                        </Table.Cell>
                        <Table.Cell>{formatDate(listedUser.lastLoginAt)}</Table.Cell>
                        <Table.Cell>
                          <Button
                            size="sm"
                            variant="ghost"
                            onPress={() => openEdit(listedUser)}
                            aria-label={`Editar a ${listedUser.name}`}
                          >
                            <Pencil width={16} height={16} />
                            Editar
                          </Button>
                        </Table.Cell>
                      </Table.Row>
                    ))}
                  </Table.Body>
                </Table.Content>
              </Table.ScrollContainer>
            </Table>
          )}

          <Pagination aria-label="Paginación de usuarios">
            <Pagination.Summary>
              {total} {total === 1 ? 'usuario' : 'usuarios'}
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
        </Card.Content>
      </Card>

      {formMode && (
        <Card className="user-form-card">
          <Card.Content className="user-form-content">
            <div className="user-form-heading">
              <div>
                <Typography.Heading level={2}>
                  {formMode === 'create' ? 'Crear usuario' : 'Editar usuario'}
                </Typography.Heading>
                <Typography.Paragraph color="muted" size="sm">
                  {formMode === 'create'
                    ? 'Define el acceso inicial de la nueva cuenta.'
                    : 'Actualiza el rol o el estado de la cuenta.'}
                </Typography.Paragraph>
              </div>
              <Button variant="ghost" isIconOnly onPress={closeForm} aria-label="Cerrar formulario">
                <Xmark width={18} height={18} />
              </Button>
            </div>

            {error && (
              <Alert status="danger">
                <Alert.Content>
                  <Alert.Description>{error}</Alert.Description>
                </Alert.Content>
              </Alert>
            )}

            <form className="user-form" onSubmit={(event) => void handleSubmit(event)} noValidate>
              <TextField fullWidth name="name" isRequired>
                <Label>Nombre completo</Label>
                <Input value={name} onChange={(event) => setName(event.target.value)} />
              </TextField>
              <TextField
                fullWidth
                name="email"
                type="email"
                isRequired
                isDisabled={formMode === 'edit'}
              >
                <Label>Correo electrónico</Label>
                <Input value={email} onChange={(event) => setEmail(event.target.value)} />
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
                  <Switch.Control>
                    <Switch.Thumb />
                  </Switch.Control>
                </Switch>
              </div>

              {editingId === currentUser?.id && (
                <Typography.Paragraph color="muted" size="sm">
                  Por seguridad no puedes cambiar tu propio rol ni desactivar tu cuenta.
                </Typography.Paragraph>
              )}

              <div className="user-form-actions">
                <Button variant="ghost" onPress={closeForm} isDisabled={isSubmitting}>
                  Cancelar
                </Button>
                <Button type="submit" variant="primary" isPending={isSubmitting}>
                  {formMode === 'create' ? 'Crear usuario' : 'Guardar cambios'}
                </Button>
              </div>
            </form>
          </Card.Content>
        </Card>
      )}
    </section>
  );
}
