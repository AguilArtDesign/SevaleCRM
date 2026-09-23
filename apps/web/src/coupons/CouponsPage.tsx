import { useCallback, useEffect, useState, type FormEvent } from 'react';
import type { Selection } from '@heroui/react';
import {
  Alert,
  AlertDialog,
  Button,
  Calendar,
  Checkbox,
  DateField,
  DatePicker,
  Dropdown,
  Label,
  ListBox,
  Modal,
  SearchField,
  Separator,
  Spinner,
  Switch,
  Table,
  TextField,
  Typography,
  toast,
} from '@heroui/react';
import { parseDate, type CalendarDate } from '@internationalized/date';
import {
  EllipsisVertical,
  ArrowRotateRight,
  CircleInfo,
  Pencil,
  Plus,
  Tag,
  TrashBin,
  Xmark,
} from '@gravity-ui/icons';
import { hasPermission } from '@sevale/permissions';
import { couponTypes } from '@sevale/shared';
import { createCouponSchema } from '@sevale/validation';
import { Chip } from '../components/Chip';
import { Input } from '../components/Input';
import { getPaginationItems, Pagination } from '../components/Pagination';
import { Select } from '../components/Select';
import { useCurrentUser } from '../users/useCurrentUser';
import {
  couponsApi,
  CouponRequestError,
  type CouponRecord,
  type CouponSyncOutcome,
  type CouponSyncStatus,
} from './api';

type FormMode = 'create' | 'edit' | null;

const storeLabels: Record<CouponSyncOutcome['store'], string> = {
  SERATUS: 'Seratus',
  PALI: 'Pali',
};

const syncActions: Record<CouponSyncOutcome['action'], string> = {
  CREATED: 'creado en WooCommerce',
  UPDATED: 'actualizado en WooCommerce',
  DELETED: 'eliminado en WooCommerce',
  MISSING: 'ya no existía en WooCommerce',
  SKIPPED: 'no existía previamente',
  FAILED: 'error',
};

// Estado de sincronización que se muestra en la tabla.
const syncStates: Record<
  CouponSyncStatus,
  { label: string; color: 'default' | 'success' | 'warning' | 'danger' }
> = {
  PENDING: { label: 'Pendiente', color: 'default' },
  SYNCED: { label: 'Sincronizado', color: 'success' },
  PARTIAL: { label: 'Parcial', color: 'warning' },
  ERROR: { label: 'Error', color: 'danger' },
};

function messageFrom(error: unknown): string {
  return error instanceof Error ? error.message : 'No pudimos completar la solicitud.';
}

// El mismo formato de fecha que usan Inventario y Usuarios.
function dateTime(value: string | null): string {
  if (!value) return 'Sin registro';
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function typeTitle(type: string): string {
  return couponTypes.find((option) => option.type === type)?.title ?? type;
}

// El panel maneja la caducidad como 'YYYY-MM-DD' y HeroUI necesita un CalendarDate.
function expiryValue(value: string): CalendarDate | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  try {
    return parseDate(value);
  } catch {
    return null;
  }
}

// Resumen por tienda: cada una se sincroniza de forma independiente y el usuario debe saber cuál falló.
function syncSummary(outcomes: CouponSyncOutcome[]): string {
  return outcomes
    .map((outcome) => {
      const label = storeLabels[outcome.store];
      if (outcome.action === 'FAILED') {
        return `${label}: error (${outcome.errorMessage ?? 'sin detalle'})`;
      }
      return `${label}: ${syncActions[outcome.action]}`;
    })
    .join(' · ');
}

function failedStores(outcomes: CouponSyncOutcome[]): CouponSyncOutcome[] {
  return outcomes.filter((outcome) => outcome.action === 'FAILED');
}

const couponStores: CouponSyncOutcome['store'][] = ['SERATUS', 'PALI'];

// Una fila del diagnóstico: la tienda, qué ocurrió y el detalle técnico que solo ve un administrador.
type CouponDiagnosticEntry = {
  store: CouponSyncOutcome['store'];
  label: string;
  color: 'default' | 'success' | 'danger';
  externalId: number | null;
  errorCode: string | null;
  errorMessage: string | null;
};

type CouponDiagnostics = {
  coupon: string;
  lastSyncAt: string | null;
  entries: CouponDiagnosticEntry[];
};

function outcomeEntries(outcomes: CouponSyncOutcome[]): CouponDiagnosticEntry[] {
  return outcomes.map((outcome) => ({
    store: outcome.store,
    label: syncActions[outcome.action],
    color: outcome.action === 'FAILED' ? 'danger' : 'success',
    externalId: outcome.externalId,
    errorCode: outcome.errorCode,
    errorMessage: outcome.errorMessage,
  }));
}

// El cupón solo conserva el diagnóstico de las tiendas que fallaron en el último intento.
function storedEntries(coupon: CouponRecord): CouponDiagnosticEntry[] {
  return couponStores
    .map((store) => {
      const isSeratus = store === 'SERATUS';
      return {
        store,
        label: 'Error en el último intento',
        color: 'danger' as const,
        externalId: isSeratus ? coupon.seratusCouponId : coupon.paliCouponId,
        errorCode: isSeratus ? coupon.seratusLastErrorCode : coupon.paliLastErrorCode,
        errorMessage: isSeratus ? coupon.seratusLastErrorMessage : coupon.paliLastErrorMessage,
      };
    })
    .filter((entry) => entry.errorCode !== null || entry.errorMessage !== null);
}

function hasStoredDiagnostics(coupon: CouponRecord): boolean {
  return Boolean(
    coupon.seratusLastErrorCode ||
    coupon.seratusLastErrorMessage ||
    coupon.paliLastErrorCode ||
    coupon.paliLastErrorMessage,
  );
}

export function CouponsPage() {
  const { user } = useCurrentUser();
  const role = user?.role;
  // El detalle técnico de las integraciones se reserva al administrador, igual que en Clientes.
  const isAdmin = role === 'ADMIN';
  const canCreate = Boolean(role && hasPermission(role, 'coupons.create'));
  const canUpdate = Boolean(role && hasPermission(role, 'coupons.update'));
  const canDelete = Boolean(role && hasPermission(role, 'coupons.delete'));
  const canSync = Boolean(role && hasPermission(role, 'coupons.sync'));
  const [coupons, setCoupons] = useState<CouponRecord[]>([]);
  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [total, setTotal] = useState(0);
  const [totalPages, setTotalPages] = useState(1);
  const [isLoading, setIsLoading] = useState(true);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [busyId, setBusyId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [formMode, setFormMode] = useState<FormMode>(null);
  const [editingId, setEditingId] = useState<number | null>(null);
  const [coupon, setCoupon] = useState('');
  const [description, setDescription] = useState('');
  const [type, setType] = useState('percent');
  const [amount, setAmount] = useState('');
  const [dateExpires, setDateExpires] = useState('');
  const [individualUse, setIndividualUse] = useState(false);
  const [excludeSaleItems, setExcludeSaleItems] = useState(false);
  const [usageLimit, setUsageLimit] = useState('');
  const [usageLimitPerUser, setUsageLimitPerUser] = useState('');
  const [deleteTarget, setDeleteTarget] = useState<CouponRecord | null>(null);
  const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set());
  const [diagnostics, setDiagnostics] = useState<CouponDiagnostics | null>(null);

  const loadCoupons = useCallback(async () => {
    setIsLoading(true);
    try {
      const result = await couponsApi.list({ search, page, pageSize });
      setCoupons(result.data);
      setTotal(result.pagination.total);
      setTotalPages(result.pagination.totalPages);
      if (page > result.pagination.totalPages) setPage(result.pagination.totalPages);
    } catch (loadError) {
      // El panel informa los fallos con toasts: el aviso de página se reserva al formulario.
      toast.danger('No pudimos cargar los cupones.', { description: messageFrom(loadError) });
    } finally {
      setIsLoading(false);
    }
  }, [page, pageSize, search]);

  useEffect(() => {
    void loadCoupons();
  }, [loadCoupons]);

  // La selección se guarda por identificador y se acota a la página actual, igual que en las
  // tablas de Inventario y Clientes. Las acciones en lote se añadirán más adelante.
  const selectedIdSet = selectedKeys === 'all' ? new Set<number>() : selectedKeys;
  const currentPageIds = new Set(coupons.map((coupon) => coupon.id));
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

  const closeForm = () => {
    setFormMode(null);
    setEditingId(null);
    setCoupon('');
    setDescription('');
    setType('percent');
    setAmount('');
    setDateExpires('');
    setIndividualUse(false);
    setExcludeSaleItems(false);
    setUsageLimit('');
    setUsageLimitPerUser('');
  };

  const openCreate = () => {
    setError('');
    closeForm();
    setFormMode('create');
  };

  const openEdit = (selected: CouponRecord) => {
    setError('');
    setFormMode('edit');
    setEditingId(selected.id);
    setCoupon(selected.coupon);
    setDescription(selected.description ?? '');
    setType(selected.type);
    setAmount(String(selected.amount));
    setDateExpires(selected.dateExpires ? selected.dateExpires.slice(0, 10) : '');
    setIndividualUse(selected.individualUse);
    setExcludeSaleItems(selected.excludeSaleItems);
    setUsageLimit(selected.usageLimit === null ? '' : String(selected.usageLimit));
    setUsageLimitPerUser(
      selected.usageLimitPerUser === null ? '' : String(selected.usageLimitPerUser),
    );
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setError('');
    const payload = {
      coupon,
      description,
      type,
      amount,
      dateExpires: dateExpires || null,
      individualUse,
      excludeSaleItems,
      usageLimit: usageLimit || null,
      usageLimitPerUser: usageLimitPerUser || null,
    };
    const parsed = createCouponSchema.safeParse(payload);
    if (!parsed.success) {
      setError(parsed.error.issues[0]?.message || 'Revisa los datos del cupón.');
      return;
    }

    setIsSubmitting(true);
    try {
      const verb = formMode === 'create' ? 'creado' : 'actualizado';
      if (formMode === 'create') await couponsApi.create(parsed.data);
      else if (editingId) await couponsApi.update(editingId, parsed.data);
      toast.success(
        `Cupón ${verb} en el CRM. Usa Sincronizar en las acciones para enviarlo a Seratus y Pali.`,
      );
      closeForm();
      await loadCoupons();
    } catch (submitError) {
      setError(messageFrom(submitError));
    } finally {
      setIsSubmitting(false);
    }
  };

  const removeCoupon = async () => {
    if (!deleteTarget || busyId !== null) return;
    const target = deleteTarget;
    setBusyId(target.id);
    try {
      const result = await couponsApi.remove(target.id);
      setSelectedKeys((current) => {
        const next = new Set(current === 'all' ? [] : current);
        next.delete(target.id);
        return next;
      });
      setDeleteTarget(null);
      toast.success(`El cupón “${target.coupon}” fue eliminado. ${syncSummary(result.sync)}`);
      await loadCoupons();
    } catch (deleteError) {
      // Una eliminación incompleta explica su causa: el resumen por tienda para todos y el detalle
      // técnico en un diagnóstico que solo puede abrir un administrador.
      const outcomes = deleteError instanceof CouponRequestError ? deleteError.outcomes : null;
      toast.danger(`No pudimos eliminar el cupón “${target.coupon}”.`, {
        description: outcomes ? syncSummary(outcomes) : messageFrom(deleteError),
      });
      if (isAdmin && outcomes) {
        setDiagnostics({
          coupon: target.coupon,
          lastSyncAt: target.lastSyncAt,
          entries: outcomeEntries(outcomes),
        });
      }
    } finally {
      setBusyId(null);
    }
  };

  const synchronizeCoupon = async (selected: CouponRecord) => {
    if (busyId !== null) return;
    setBusyId(selected.id);
    try {
      const result = await couponsApi.synchronize(selected.id);
      const failures = failedStores(result.sync);
      if (failures.length > 0) {
        toast.warning(`El cupón “${selected.coupon}” no se sincronizó por completo.`, {
          description: syncSummary(failures),
        });
        if (isAdmin) {
          setDiagnostics({
            coupon: selected.coupon,
            lastSyncAt: result.lastSyncAt,
            entries: outcomeEntries(result.sync),
          });
        }
      } else {
        toast.success(
          `El cupón “${selected.coupon}” quedó sincronizado. ${syncSummary(result.sync)}`,
        );
      }
      await loadCoupons();
    } catch (syncError) {
      toast.danger(`No pudimos sincronizar el cupón “${selected.coupon}”.`, {
        description: messageFrom(syncError),
      });
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="coupons-layout">
      <div className="page-heading-row">
        <div className="coupons-heading">
          <Typography.Heading level={2}>Cupones</Typography.Heading>
          <Chip>{total}</Chip>
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
      </div>

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
          <Table>
            <Table.ScrollContainer>
              <Table.Content
                aria-label="Cupones del CRM"
                selectionMode={canDelete ? 'multiple' : 'none'}
                selectedKeys={canDelete ? currentPageSelection : new Set()}
                onSelectionChange={canDelete ? updatePageSelection : undefined}
              >
                <Table.Header>
                  {canDelete && (
                    <Table.Column id="selection" className="inventory-selection-column">
                      <Checkbox
                        slot="selection"
                        aria-label="Seleccionar todos los cupones de esta página"
                      >
                        <Checkbox.Content>
                          <Checkbox.Control>
                            <Checkbox.Indicator />
                          </Checkbox.Control>
                        </Checkbox.Content>
                      </Checkbox>
                    </Table.Column>
                  )}
                  <Table.Column isRowHeader>Cupón</Table.Column>
                  <Table.Column>Descripción</Table.Column>
                  <Table.Column>Tipo</Table.Column>
                  <Table.Column>Valor</Table.Column>
                  <Table.Column>Sincronización</Table.Column>
                  <Table.Column className="inventory-actions-column">Acciones</Table.Column>
                </Table.Header>
                <Table.Body>
                  {coupons.map((listedCoupon) => (
                    <Table.Row key={listedCoupon.id} id={listedCoupon.id}>
                      {canDelete && (
                        <Table.Cell className="inventory-selection-cell">
                          <Checkbox
                            slot="selection"
                            aria-label={`Seleccionar ${listedCoupon.coupon}`}
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
                        <strong>{listedCoupon.coupon}</strong>
                      </Table.Cell>
                      <Table.Cell
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        {listedCoupon.description || 'Sin descripción'}
                      </Table.Cell>
                      <Table.Cell
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        {typeTitle(listedCoupon.type)}
                      </Table.Cell>
                      <Table.Cell
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        {listedCoupon.amount}%
                      </Table.Cell>
                      <Table.Cell
                        onClick={(event) => event.stopPropagation()}
                        onPointerDown={(event) => event.stopPropagation()}
                      >
                        <Chip color={syncStates[listedCoupon.syncStatus].color}>
                          {syncStates[listedCoupon.syncStatus].label}
                        </Chip>
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
                              aria-label={`Acciones para el cupón ${listedCoupon.coupon}`}
                            >
                              <EllipsisVertical className="text-muted" width={17} height={17} />
                            </Button>
                            <Dropdown.Popover
                              className="inventory-actions-popover"
                              placement="bottom end"
                            >
                              <Dropdown.Menu
                                aria-label={`Acciones para el cupón ${listedCoupon.coupon}`}
                                onAction={(key) => {
                                  if (String(key) === 'sync' && canSync) {
                                    void synchronizeCoupon(listedCoupon);
                                  }
                                  if (String(key) === 'edit' && canUpdate) openEdit(listedCoupon);
                                  if (String(key) === 'diagnostics' && isAdmin) {
                                    setDiagnostics({
                                      coupon: listedCoupon.coupon,
                                      lastSyncAt: listedCoupon.lastSyncAt,
                                      entries: storedEntries(listedCoupon),
                                    });
                                  }
                                  if (String(key) === 'delete' && canDelete) {
                                    setDeleteTarget(listedCoupon);
                                  }
                                }}
                              >
                                {(canSync ||
                                  canUpdate ||
                                  (isAdmin && hasStoredDiagnostics(listedCoupon))) && (
                                  <Dropdown.Section>
                                    {canSync && (
                                      <Dropdown.Item id="sync" textValue="Sincronizar cupón">
                                        <ArrowRotateRight
                                          className="size-4 shrink-0 text-muted"
                                          aria-hidden="true"
                                        />
                                        <Label>Sincronizar</Label>
                                      </Dropdown.Item>
                                    )}
                                    {canUpdate && (
                                      <Dropdown.Item id="edit" textValue="Editar cupón">
                                        <Pencil
                                          className="size-4 shrink-0 text-muted"
                                          aria-hidden="true"
                                        />
                                        <Label>Editar</Label>
                                      </Dropdown.Item>
                                    )}
                                    {isAdmin && hasStoredDiagnostics(listedCoupon) && (
                                      <Dropdown.Item
                                        id="diagnostics"
                                        textValue="Ver diagnóstico de la sincronización"
                                      >
                                        <CircleInfo
                                          className="size-4 shrink-0 text-muted"
                                          aria-hidden="true"
                                        />
                                        <Label>Ver diagnóstico</Label>
                                      </Dropdown.Item>
                                    )}
                                  </Dropdown.Section>
                                )}
                                {(canSync || canUpdate) && canDelete && <Separator />}
                                {canDelete && (
                                  <Dropdown.Section>
                                    <Dropdown.Item
                                      id="delete"
                                      textValue="Eliminar cupón"
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
          </Table>
        )}

        <Pagination aria-label="Paginación de cupones">
          <Pagination.Summary>
            <span className="customers-page-size-control">
              Filas por página
              <Select
                className="customers-page-size"
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
                  <DatePicker
                    name="dateExpires"
                    value={expiryValue(dateExpires)}
                    onChange={(value) => setDateExpires(value ? value.toString() : '')}
                  >
                    <Label>Fecha de caducidad</Label>
                    <DateField.Group fullWidth variant="secondary">
                      <DateField.Input>
                        {(segment) => <DateField.Segment segment={segment} />}
                      </DateField.Input>
                      <DateField.Suffix>
                        <DatePicker.Trigger>
                          <DatePicker.TriggerIndicator />
                        </DatePicker.Trigger>
                      </DateField.Suffix>
                    </DateField.Group>
                    <DatePicker.Popover>
                      <Calendar aria-label="Fecha de caducidad del cupón">
                        <Calendar.Header>
                          <Calendar.YearPickerTrigger>
                            <Calendar.YearPickerTriggerHeading />
                            <Calendar.YearPickerTriggerIndicator />
                          </Calendar.YearPickerTrigger>
                          <Calendar.NavButton slot="previous" />
                          <Calendar.NavButton slot="next" />
                        </Calendar.Header>
                        <Calendar.Grid>
                          <Calendar.GridHeader>
                            {(day) => <Calendar.HeaderCell>{day}</Calendar.HeaderCell>}
                          </Calendar.GridHeader>
                          <Calendar.GridBody>
                            {(date) => <Calendar.Cell date={date} />}
                          </Calendar.GridBody>
                        </Calendar.Grid>
                        <Calendar.YearPickerGrid>
                          <Calendar.YearPickerGridBody>
                            {({ year }) => <Calendar.YearPickerCell year={year} />}
                          </Calendar.YearPickerGridBody>
                        </Calendar.YearPickerGrid>
                      </Calendar>
                    </DatePicker.Popover>
                  </DatePicker>
                  <div className="coupon-switch-row">
                    <div>
                      <strong>Uso individual</strong>
                      <span>Impide combinar el cupón con otros descuentos.</span>
                    </div>
                    <Switch
                      aria-label="Uso individual"
                      isSelected={individualUse}
                      onChange={setIndividualUse}
                    >
                      <Switch.Content>
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                      </Switch.Content>
                    </Switch>
                  </div>
                  <div className="coupon-switch-row">
                    <div>
                      <strong>Excluir artículos rebajados</strong>
                      <span>No aplica el descuento a productos en promoción.</span>
                    </div>
                    <Switch
                      aria-label="Excluir artículos rebajados"
                      isSelected={excludeSaleItems}
                      onChange={setExcludeSaleItems}
                    >
                      <Switch.Content>
                        <Switch.Control>
                          <Switch.Thumb />
                        </Switch.Control>
                      </Switch.Content>
                    </Switch>
                  </div>
                  <TextField fullWidth name="usageLimit" type="number">
                    <Label>Límite de uso por cupón</Label>
                    <Input
                      variant="secondary"
                      min="1"
                      step="1"
                      value={usageLimit}
                      onChange={(event) => setUsageLimit(event.target.value)}
                      placeholder="Sin límite"
                    />
                  </TextField>
                  <TextField fullWidth name="usageLimitPerUser" type="number">
                    <Label>Límite de uso por usuario</Label>
                    <Input
                      variant="secondary"
                      min="1"
                      step="1"
                      value={usageLimitPerUser}
                      onChange={(event) => setUsageLimitPerUser(event.target.value)}
                      placeholder="Sin límite"
                    />
                  </TextField>
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

      {isAdmin && (
        <Modal isOpen={diagnostics !== null} onOpenChange={(open) => !open && setDiagnostics(null)}>
          <Modal.Backdrop>
            <Modal.Container size="md" placement="center" scroll="inside">
              <Modal.Dialog className="coupon-diagnostics-modal">
                <Modal.CloseTrigger aria-label="Cerrar el diagnóstico">
                  <Xmark />
                </Modal.CloseTrigger>
                <Modal.Header>
                  <div>
                    <Modal.Heading>Diagnóstico de la sincronización</Modal.Heading>
                    <p>
                      {diagnostics?.coupon} · Último intento:{' '}
                      {dateTime(diagnostics?.lastSyncAt ?? null)}
                    </p>
                  </div>
                </Modal.Header>
                <Modal.Body className="coupon-diagnostics-body">
                  {diagnostics?.entries.map((entry) => (
                    <article className="coupon-diagnostics-card" key={entry.store}>
                      <header className="coupon-diagnostics-heading">
                        <strong>{storeLabels[entry.store]}</strong>
                        <Chip color={entry.color}>{entry.label}</Chip>
                      </header>
                      <dl className="coupon-diagnostics-detail">
                        <dt>Código</dt>
                        <dd>{entry.errorCode || 'Sin código'}</dd>
                        <dt>Mensaje</dt>
                        <dd>{entry.errorMessage || 'Sin detalle registrado'}</dd>
                        <dt>Cupón en la tienda</dt>
                        <dd>{entry.externalId ?? 'Sin identificar'}</dd>
                      </dl>
                    </article>
                  ))}
                </Modal.Body>
                <Modal.Footer>
                  <Button variant="ghost" onPress={() => setDiagnostics(null)}>
                    Cerrar
                  </Button>
                </Modal.Footer>
              </Modal.Dialog>
            </Modal.Container>
          </Modal.Backdrop>
        </Modal>
      )}

      <AlertDialog
        isOpen={deleteTarget !== null}
        onOpenChange={(open) => !open && busyId === null && setDeleteTarget(null)}
      >
        <AlertDialog.Backdrop>
          <AlertDialog.Container size="sm">
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger">
                  <TrashBin />
                </AlertDialog.Icon>
                <AlertDialog.Heading>Eliminar cupón</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                Se eliminará definitivamente <strong>{deleteTarget?.coupon}</strong> del CRM, de
                Seratus y de Pali. Los pedidos que ya lo utilizaron conservarán la información
                histórica del cupón.
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button
                  variant="ghost"
                  onPress={() => setDeleteTarget(null)}
                  isDisabled={busyId !== null}
                >
                  Cancelar
                </Button>
                <Button
                  variant="danger"
                  onPress={() => void removeCoupon()}
                  isPending={busyId === deleteTarget?.id}
                >
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
