import { useCallback, useEffect, useMemo, useState, type FormEvent } from 'react';
import {
  Alert,
  Button,
  Label,
  ListBox,
  Modal,
  SearchField,
  Spinner,
  Switch,
  Table,
  TextField,
  Typography,
} from '@heroui/react';
import { Pencil, Plus, Tag, Xmark } from '@gravity-ui/icons';
import { hasPermission } from '@sevale/permissions';
import { couponTypes } from '@sevale/shared';
import { createCouponSchema } from '@sevale/validation';
import { Chip } from '../components/Chip';
import { Input } from '../components/Input';
import { getPaginationItems, Pagination } from '../components/Pagination';
import { Select } from '../components/Select';
import { useCurrentUser } from '../users/useCurrentUser';
import { couponsApi, type CouponRecord } from './api';

type ActiveFilter = 'all' | 'active' | 'inactive';
type FormMode = 'create' | 'edit' | null;

const activeOptions = [
  { value: 'all', label: 'Todos los estados' },
  { value: 'active', label: 'Activos' },
  { value: 'inactive', label: 'Inactivos' },
] as const;

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'No pudimos completar la solicitud.';
}

function typeTitle(type: string): string {
  return couponTypes.find((option) => option.type === type)?.title ?? type;
}

export function CouponsPage() {
  const { user } = useCurrentUser();
  const role = user?.role;
  const canCreate = Boolean(role && hasPermission(role, 'coupons.create'));
  const canUpdate = Boolean(role && hasPermission(role, 'coupons.update'));
  const canDeactivate = Boolean(role && hasPermission(role, 'coupons.delete'));
  const [coupons, setCoupons] = useState<CouponRecord[]>([]);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [activeFilter, setActiveFilter] = useState<ActiveFilter>('all');
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [coupon, setCoupon] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('percent');
  const [amount, setAmount] = useState('');
  const [active, setActive] = useState(true);

  const activeQuery = useMemo(
    () => (activeFilter === 'all' ? undefined : activeFilter === 'active'),
    [activeFilter],
  );

  const loadCoupons = useCallback(async () => {
    setIsLoading(true);
    setError('');
    try {
      const result = await couponsApi.list({ search, active: activeQuery, page });
      setCoupons(result.data);
      setTotal(result.pagination.total);
      setTotalPages(result.pagination.totalPages);
      if (page > result.pagination.totalPages) setPage(result.pagination.totalPages);
    } catch (loadError) {
      setError(messageFrom(loadError));
    } finally {
      setIsLoading(false);
    }
  }, [activeQuery, page, search]);

  useEffect(() => {
    void loadCoupons();
  }, [loadCoupons]);

  const closeForm = () => {
    setFormMode(null);
    setEditingId(null);
    setCoupon('');
    setDescription('');
    setType('percent');
    setAmount('');
    setActive(true);
  };

  const openCreate = () => {
    setError('');
    setNotice('');
    closeForm();
    setFormMode('create');
  };

  const openEdit = (selected: CouponRecord) => {
    setError('');
    setNotice('');
    setFormMode('edit');
    setEditingId(selected.id);
    setCoupon(selected.coupon);
    setDescription(selected.description ?? '');
    setType(selected.type);
    setAmount(String(selected.amount));
    setActive(selected.active);
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    setNotice('');
    const payload = { coupon, description, type, amount, active };
    const parsed = createCouponSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || 'Revisa los datos del cupón.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (formMode === 'create') {
        await couponsApi.create(parsed.data);
        setNotice('Cupón creado correctamente.');
      } else if (editingId) {
        await couponsApi.update(editingId, parsed.data);
        setNotice('Cupón actualizado correctamente.');
      }
      closeForm();
      await loadCoupons();
    } catch (submitError) {
      setError(messageFrom(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  const changeActive = async (selected: CouponRecord) => {
    setBusyId(selected.id);
    setError('');
    setNotice('');
    try {
      if (selected.active) {
        await couponsApi.deactivate(selected.id);
        setNotice(`El cupón “${selected.coupon}” fue desactivado.`);
      } else {
        await couponsApi.update(selected.id, { active: true });
        setNotice(`El cupón “${selected.coupon}” fue activado.`);
      }
      await loadCoupons();
    } catch (changeError) {
      setError(messageFrom(changeError));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="coupons-layout">
      <div className="page-heading-row">
        <div>
          <Typography.Heading level={2}>Cupones</Typography.Heading>
          <Typography.Paragraph color="muted" size="sm">
            Administra los descuentos permitidos para nuevas operaciones.
          </Typography.Paragraph>
        </div>
        {canCreate && (
          <Button variant="primary" onPress={openCreate}>
            <Plus width={18} height={18} />
            Crear cupón
          </Button>
        )}
      </div>

      <div className="coupons-toolbar">
        <SearchField
          aria-label="Buscar cupones"
          value={searchDraft}
          onChange={setSearchDraft}
          onSubmit={(value) => {
            setPage(1);
            setSearch(value.trim());
          }}
          onClear={() => {
            setSearchDraft('');
            setSearch('');
            setPage(1);
          }}
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Cupón o descripción" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>

        <Select
          aria-label="Filtrar cupones por estado"
          value={activeFilter}
          onChange={(value) => {
            setActiveFilter(String(value) as ActiveFilter);
            setPage(1);
          }}
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              {activeOptions.map((option) => (
                <ListBox.Item key={option.value} id={option.value} textValue={option.label}>
                  {option.label}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
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

      <div className="coupons-table-shell">
        {isLoading ? (
          <div className="coupons-state" aria-live="polite">
            <Spinner />
            <span>Cargando cupones…</span>
          </div>
        ) : coupons.length === 0 ? (
          <div className="coupons-state">
            <Tag width={30} height={30} />
            <strong>No encontramos cupones</strong>
            <span>Crea el primero o cambia los filtros.</span>
          </div>
        ) : (
          <Table variant="secondary">
            <Table.ScrollContainer>
              <Table.Content aria-label="Cupones del CRM">
                <Table.Header>
                  <Table.Column isRowHeader>Cupón</Table.Column>
                  <Table.Column>Descripción</Table.Column>
                  <Table.Column>Tipo</Table.Column>
                  <Table.Column>Valor</Table.Column>
                  <Table.Column>Estado</Table.Column>
                  <Table.Column>Acciones</Table.Column>
                </Table.Header>
                <Table.Body>
                  {coupons.map((listedCoupon) => (
                    <Table.Row key={listedCoupon.id} id={listedCoupon.id}>
                      <Table.Cell>
                        <strong>{listedCoupon.coupon}</strong>
                      </Table.Cell>
                      <Table.Cell>{listedCoupon.description || 'Sin descripción'}</Table.Cell>
                      <Table.Cell>{typeTitle(listedCoupon.type)}</Table.Cell>
                      <Table.Cell>{listedCoupon.amount}%</Table.Cell>
                      <Table.Cell>
                        <Chip color={listedCoupon.active ? 'success' : 'default'}>
                          {listedCoupon.active ? 'Activo' : 'Inactivo'}
                        </Chip>
                      </Table.Cell>
                      <Table.Cell>
                        <div className="coupon-actions">
                          {canUpdate && (
                            <Button
                              size="sm"
                              variant="ghost"
                              onPress={() => openEdit(listedCoupon)}
                            >
                              <Pencil width={16} height={16} />
                              Editar
                            </Button>
                          )}
                          {(listedCoupon.active ? canDeactivate : canUpdate) && (
                            <Button
                              size="sm"
                              variant="ghost"
                              isPending={busyId === listedCoupon.id}
                              onPress={() => void changeActive(listedCoupon)}
                            >
                              {listedCoupon.active ? 'Desactivar' : 'Activar'}
                            </Button>
                          )}
                        </div>
                      </Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        )}

        <Pagination aria-label="Paginación de cupones">
          <Pagination.Summary>
            {total} {total === 1 ? 'cupón' : 'cupones'}
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
      </div>

      <Modal isOpen={Boolean(formMode)} onOpenChange={(open) => !open && closeForm()}>
        <Modal.Backdrop>
          <Modal.Container size="sm" placement="center" scroll="inside">
            <Modal.Dialog className="coupon-form-modal">
              <Modal.CloseTrigger aria-label="Cerrar formulario">
                <Xmark />
              </Modal.CloseTrigger>
              <Modal.Header>
                <div>
                  <Modal.Heading>
                    {formMode === 'create' ? 'Crear cupón' : 'Editar cupón'}
                  </Modal.Heading>
                  <p>Define el descuento autorizado para los pedidos.</p>
                </div>
              </Modal.Header>
              <form onSubmit={(event) => void submit(event)} noValidate>
                <Modal.Body className="coupon-form-body">
                  {error && (
                    <Alert status="danger">
                      <Alert.Content>
                        <Alert.Description>{error}</Alert.Description>
                      </Alert.Content>
                    </Alert>
                  )}
                  <TextField fullWidth isRequired name="coupon">
                    <Label>Cupón</Label>
                    <Input
                      variant="secondary"
                      value={coupon}
                      onChange={(event) => setCoupon(event.target.value)}
                      placeholder="byyohander"
                    />
                  </TextField>
                  <TextField fullWidth name="description">
                    <Label>Descripción</Label>
                    <Input
                      variant="secondary"
                      value={description}
                      onChange={(event) => setDescription(event.target.value)}
                      placeholder="Descripción opcional"
                    />
                  </TextField>
                  <div>
                    <Label>Tipo</Label>
                    <Select
                      aria-label="Tipo de cupón"
                      variant="secondary"
                      value={type}
                      onChange={(value) => setType(String(value))}
                    >
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {couponTypes
                            .filter((option) => option.active)
                            .map((option) => (
                              <ListBox.Item
                                key={option.type}
                                id={option.type}
                                textValue={option.title}
                              >
                                {option.title}
                                <ListBox.ItemIndicator />
                              </ListBox.Item>
                            ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>
                  <TextField fullWidth isRequired name="amount" type="number">
                    <Label>Valor porcentual</Label>
                    <Input
                      variant="secondary"
                      min="0.01"
                      max="100"
                      step="0.01"
                      value={amount}
                      onChange={(event) => setAmount(event.target.value)}
                      placeholder="20"
                    />
                  </TextField>
                  <div className="coupon-active-control">
                    <div>
                      <strong>Cupón activo</strong>
                      <span>Solo los cupones activos aparecen en nuevos pedidos.</span>
                    </div>
                    <Switch aria-label="Cupón activo" isSelected={active} onChange={setActive}>
                      <Switch.Control>
                        <Switch.Thumb />
                      </Switch.Control>
                    </Switch>
                  </div>
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="ghost" onPress={closeForm} isDisabled={isSubmitting}>
                    Cancelar
                  </Button>
                  <Button type="submit" variant="primary" isPending={isSubmitting}>
                    {formMode === 'create' ? 'Crear cupón' : 'Guardar cambios'}
                  </Button>
                </Modal.Footer>
              </form>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>
    </section>
  );
}
