import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  Button,
  Description,
  Label,
  ListBox,
  Modal,
  SearchField,
  Spinner,
  Table,
} from '@heroui/react';
import { Gem, Magnifier, Plus } from '@gravity-ui/icons';
import { pointsDocumentTypes, type PointsDocumentType } from '@sevale/validation';
import { Chip } from '../components/Chip';
import { Input } from '../components/Input';
import { Select } from '../components/Select';
import { formattedMoneyWithCode } from '../orders/presentation';
import {
  pointsColombiaApi,
  type PointsInvoiceRecord,
  type PointsInvoiceStatus,
  type PointsPrefixOption,
} from './api';
import { accrualTimestamp, canAccrue, invoiceDate, statusMeta } from './presentation';

/**
 * Panel de Puntos Colombia. Mientras el proveedor certifica, el módulo es exclusivo del
 * administrador: el permiso del backend y la bandera `PCO_ADMIN_ONLY` lo cierran para los demás.
 */
export function PointsColombiaPage() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<PointsInvoiceStatus | 'all'>('all');
  const [search, setSearch] = useState('');
  const [dateFrom, setDateFrom] = useState('');
  const [dateTo, setDateTo] = useState('');
  const [sellerId, setSellerId] = useState('all');
  const [page, setPage] = useState(1);
  const [searchOpen, setSearchOpen] = useState(false);
  const [accrualTarget, setAccrualTarget] = useState<PointsInvoiceRecord | null>(null);
  const [detailTarget, setDetailTarget] = useState<PointsInvoiceRecord | null>(null);

  const listQuery = useQuery({
    queryKey: ['points-colombia', status, search, dateFrom, dateTo, sellerId, page],
    queryFn: () =>
      pointsColombiaApi.list({
        search,
        status,
        page,
        pageSize: 20,
        sellerId: sellerId === 'all' ? undefined : Number(sellerId),
        dateFrom: dateFrom ? new Date(`${dateFrom}T00:00:00`) : undefined,
        dateTo: dateTo ? new Date(`${dateTo}T23:59:59`) : undefined,
      }),
  });
  const prefixesQuery = useQuery({
    queryKey: ['points-colombia', 'prefixes'],
    queryFn: pointsColombiaApi.prefixes,
    staleTime: 5 * 60_000,
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['points-colombia'] });
  const result = listQuery.data;
  const totalPages = result?.pagination.totalPages ?? 1;
  // Un comercial puede tener varias cuentas con prefijo, así que el filtro agrupa por seller.
  const sellerOptions = Array.from(
    new Map(
      (prefixesQuery.data ?? [])
        .filter((option) => option.sellerId !== null)
        .map((option) => [option.sellerId as number, option]),
    ).values(),
  );

  return (
    <section className="customers-layout">
      <header className="customers-heading">
        <div>
          <h2>Puntos Colombia</h2>
          <span className="customers-count">{result?.pagination.total ?? 0}</span>
        </div>
        <Button variant="primary" onPress={() => setSearchOpen(true)}>
          <Plus width={16} height={16} />
          Buscar factura
        </Button>
      </header>

      <div className="orders-toolbar">
        <div className="orders-filters">
          <Select
            aria-label="Filtrar por estado"
            value={status}
            variant="secondary"
            onChange={(value) => {
              setStatus(String(value) as PointsInvoiceStatus | 'all');
              setPage(1);
            }}
          >
            <Select.Trigger>
              <Select.Value />
              <Select.Indicator />
            </Select.Trigger>
            <Select.Popover>
              <ListBox>
                <ListBox.Item id="all">Todos los estados</ListBox.Item>
                {(Object.keys(statusMeta) as PointsInvoiceStatus[]).map((key) => (
                  <ListBox.Item key={key} id={key}>
                    {statusMeta[key].label}
                  </ListBox.Item>
                ))}
              </ListBox>
            </Select.Popover>
          </Select>
          {sellerOptions.length > 1 && (
            <Select
              aria-label="Filtrar por comercial"
              value={sellerId}
              variant="secondary"
              onChange={(value) => {
                setSellerId(String(value));
                setPage(1);
              }}
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="all">Todos los comerciales</ListBox.Item>
                  {sellerOptions.map((option) => (
                    <ListBox.Item key={option.sellerId} id={String(option.sellerId)}>
                      {option.userName}
                    </ListBox.Item>
                  ))}
                </ListBox>
              </Select.Popover>
            </Select>
          )}
          <div className="points-date-range">
            <Input
              type="date"
              aria-label="Facturas desde"
              variant="secondary"
              value={dateFrom}
              onChange={(event) => {
                setDateFrom(event.target.value);
                setPage(1);
              }}
            />
            <span>–</span>
            <Input
              type="date"
              aria-label="Facturas hasta"
              variant="secondary"
              value={dateTo}
              onChange={(event) => {
                setDateTo(event.target.value);
                setPage(1);
              }}
            />
          </div>
        </div>
        <SearchField
          className="orders-search"
          value={search}
          aria-label="Buscar factura o documento"
          onChange={(value) => {
            setSearch(value);
            setPage(1);
          }}
        >
          <SearchField.Group>
            <SearchField.SearchIcon />
            <SearchField.Input placeholder="Factura o documento" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
      </div>

      {listQuery.isError && (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Description>{listQuery.error.message}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      <Table>
        <Table.Content aria-label="Facturas del panel de Puntos Colombia">
          <Table.Header>
            <Table.Column isRowHeader>Factura</Table.Column>
            <Table.Column>Fecha</Table.Column>
            <Table.Column>Documento</Table.Column>
            <Table.Column>Vendedor</Table.Column>
            <Table.Column>Total COP</Table.Column>
            <Table.Column>Productos</Table.Column>
            <Table.Column>Puntos</Table.Column>
            <Table.Column>Estado</Table.Column>
            <Table.Column>Acumulado</Table.Column>
            <Table.Column>Acciones</Table.Column>
          </Table.Header>
          <Table.Body
            renderEmptyState={() => (
              <div className="coming-soon">
                <span className="coming-soon-icon" aria-hidden="true">
                  <Gem width={22} height={22} />
                </span>
                <strong>Sin facturas en el panel</strong>
                <p>Busca una factura de Siigo para empezar a acumular puntos.</p>
              </div>
            )}
          >
            {(result?.data ?? []).map((invoice) => {
              const meta = statusMeta[invoice.status];
              return (
                <Table.Row key={invoice.id}>
                  <Table.Cell>
                    <div className="points-invoice-copy">
                      <Button
                        size="sm"
                        variant="ghost"
                        aria-label={`Ver detalle de ${invoice.name}`}
                        onPress={() => setDetailTarget(invoice)}
                      >
                        <strong>{invoice.name}</strong>
                      </Button>
                      {/* Una factura de prueba nunca debe confundirse con una real de Siigo. */}
                      {invoice.source === 'UAT_SEED' && <Chip color="default">Prueba UAT</Chip>}
                    </div>
                  </Table.Cell>
                  <Table.Cell>{invoiceDate(invoice.invoiceDate)}</Table.Cell>
                  <Table.Cell>{invoice.customerIdentification}</Table.Cell>
                  <Table.Cell>
                    {invoice.sellerName ??
                      (invoice.sellerId === null ? '—' : `Siigo #${invoice.sellerId}`)}
                  </Table.Cell>
                  <Table.Cell>{formattedMoneyWithCode(invoice.total, 'COP')}</Table.Cell>
                  <Table.Cell>{invoice.itemCount}</Table.Cell>
                  <Table.Cell>
                    <strong>{invoice.points}</strong>
                  </Table.Cell>
                  <Table.Cell>
                    <Chip color={meta.color}>{meta.label}</Chip>
                    {invoice.accrual?.errorMessage && (
                      <p className="points-invoice-error">{invoice.accrual.errorMessage}</p>
                    )}
                  </Table.Cell>
                  <Table.Cell>
                    {invoice.accrual?.completedAt
                      ? accrualTimestamp(invoice.accrual.completedAt)
                      : '—'}
                  </Table.Cell>
                  <Table.Cell>
                    {/* Una vez acreditada, la acción deja de existir: el resultado se consulta en el
                        detalle, porque los puntos no se pueden volver a acumular. */}
                    {canAccrue(invoice) ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onPress={() => setAccrualTarget(invoice)}
                      >
                        <Gem width={15} height={15} />
                        {invoice.status === 'FAILED' ? 'Reintentar' : 'Acumular'}
                      </Button>
                    ) : (
                      <Button size="sm" variant="ghost" onPress={() => setDetailTarget(invoice)}>
                        Ver resultado
                      </Button>
                    )}
                  </Table.Cell>
                </Table.Row>
              );
            })}
          </Table.Body>
        </Table.Content>
      </Table>

      {listQuery.isPending && (
        <div className="siigo-quotation-loading">
          <Spinner />
          <span>Cargando facturas…</span>
        </div>
      )}

      {totalPages > 1 && (
        <div className="points-pagination">
          <Button
            size="sm"
            variant="ghost"
            isDisabled={page <= 1}
            onPress={() => setPage((current) => current - 1)}
          >
            Anterior
          </Button>
          <span>
            Página {page} de {totalPages}
          </span>
          <Button
            size="sm"
            variant="ghost"
            isDisabled={page >= totalPages}
            onPress={() => setPage((current) => current + 1)}
          >
            Siguiente
          </Button>
        </div>
      )}

      <InvoiceSearchModal
        isOpen={searchOpen}
        prefixes={prefixesQuery.data ?? []}
        onClose={() => setSearchOpen(false)}
        onRegistered={(invoice) => {
          setSearchOpen(false);
          void refresh();
          setAccrualTarget(invoice);
        }}
      />

      <InvoiceDetailModal invoice={detailTarget} onClose={() => setDetailTarget(null)} />

      <AccrualModal
        invoice={accrualTarget}
        onClose={() => setAccrualTarget(null)}
        onDone={() => {
          setAccrualTarget(null);
          void refresh();
        }}
      />
    </section>
  );
}

/**
 * Histórico de la factura. La acumulación confirmada no se puede repetir, así que el resultado tiene
 * que quedar consultable: aprobación, saldo y el documento con el que se envió.
 */
function InvoiceDetailModal({
  invoice,
  onClose,
}: {
  invoice: PointsInvoiceRecord | null;
  onClose: () => void;
}) {
  if (!invoice) return null;
  const accrual = invoice.accrual;
  const meta = statusMeta[invoice.status];

  return (
    <Modal isOpen onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container placement="center">
          <Modal.Dialog className="siigo-quotation-modal">
            <Modal.CloseTrigger aria-label="Cerrar detalle" />
            <Modal.Header>
              <div>
                <Modal.Heading>Detalle de {invoice.name}</Modal.Heading>
                <p className="siigo-quotation-subtitle">
                  Resultado del último intento de acumulación
                </p>
              </div>
            </Modal.Header>
            <Modal.Body>
              <dl className="order-ticket-data siigo-quotation-meta">
                <div>
                  <dt>Fecha de factura</dt>
                  <dd>{invoiceDate(invoice.invoiceDate)}</dd>
                </div>
                <div>
                  <dt>Documento del cliente</dt>
                  <dd>{invoice.customerIdentification}</dd>
                </div>
                <div>
                  <dt>Vendedor</dt>
                  <dd>
                    {invoice.sellerName ??
                      (invoice.sellerId === null ? '—' : `Siigo #${invoice.sellerId}`)}
                  </dd>
                </div>
                <div>
                  <dt>Total</dt>
                  <dd>{formattedMoneyWithCode(invoice.total, 'COP')}</dd>
                </div>
                <div>
                  <dt>Productos</dt>
                  <dd>{invoice.itemCount}</dd>
                </div>
                <div>
                  <dt>Puntos</dt>
                  <dd>
                    <strong>{invoice.points}</strong>
                  </dd>
                </div>
                <div>
                  <dt>Estado</dt>
                  <dd>
                    <Chip color={meta.color}>{meta.label}</Chip>
                  </dd>
                </div>
                <div>
                  <dt>Origen</dt>
                  <dd>{invoice.source === 'SIIGO' ? 'Siigo' : 'Prueba UAT'}</dd>
                </div>
              </dl>

              {accrual ? (
                <dl className="order-ticket-data siigo-quotation-meta">
                  <div>
                    <dt>Puntos acreditados</dt>
                    <dd>{accrual.pointsEarned ?? accrual.pointsRequested}</dd>
                  </div>
                  <div>
                    <dt>Saldo después</dt>
                    <dd>{accrual.pointsBalance === null ? '—' : `${accrual.pointsBalance} pts`}</dd>
                  </div>
                  <div>
                    <dt>Equivalente</dt>
                    <dd>
                      {accrual.balanceValueInMoney === null
                        ? '—'
                        : formattedMoneyWithCode(accrual.balanceValueInMoney, 'COP')}
                    </dd>
                  </div>
                  <div>
                    <dt>Aprobación</dt>
                    <dd>{accrual.approbationNumber ?? '—'}</dd>
                  </div>
                  <div>
                    <dt>Documento enviado</dt>
                    <dd>
                      {pointsDocumentLabel(accrual.documentType)} {accrual.documentNumber}
                    </dd>
                  </div>
                  <div>
                    <dt>Registrado por</dt>
                    <dd>{accrual.user.name}</dd>
                  </div>
                  <div>
                    <dt>Fecha del intento</dt>
                    <dd>{accrualTimestamp(accrual.createdAt)}</dd>
                  </div>
                  <div>
                    <dt>Fecha de acumulación</dt>
                    <dd>{accrual.completedAt ? accrualTimestamp(accrual.completedAt) : '—'}</dd>
                  </div>
                </dl>
              ) : (
                <p className="siigo-quotation-subtitle">
                  La factura aún no tiene ningún intento de acumulación.
                </p>
              )}

              {accrual?.errorMessage && (
                <Alert status="danger">
                  <Alert.Content>
                    <Alert.Description>{accrual.errorMessage}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={onClose}>
                Cerrar
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

/** Etiqueta del tipo de documento tal como la ve el operador al elegirlo. */
function pointsDocumentLabel(value: string) {
  return pointsDocumentTypes.find((type) => type.value === value)?.label ?? value;
}

/**
 * Busca la factura en Siigo. El operador solo escribe el número: el prefijo lo pone el backend desde
 * su usuario, así que desde aquí no se puede pedir la factura de otro vendedor.
 */
function InvoiceSearchModal({
  isOpen,
  prefixes,
  onClose,
  onRegistered,
}: {
  isOpen: boolean;
  prefixes: PointsPrefixOption[];
  onClose: () => void;
  onRegistered: (invoice: PointsInvoiceRecord) => void;
}) {
  const [number, setNumber] = useState('');
  const [sellerId, setSellerId] = useState('');
  const [error, setError] = useState('');

  const searchMutation = useMutation({
    mutationFn: () =>
      pointsColombiaApi.search(number.trim(), sellerId ? Number(sellerId) : undefined),
    onError: (failure: Error) => setError(failure.message),
    onSuccess: () => setError(''),
  });
  const registerMutation = useMutation({
    mutationFn: () =>
      pointsColombiaApi.register(number.trim(), sellerId ? Number(sellerId) : undefined),
    onSuccess: onRegistered,
    onError: (failure: Error) => setError(failure.message),
  });

  const preview = searchMutation.data;
  // Con un solo prefijo configurado no hay contexto que elegir.
  const needsSeller = prefixes.length > 1;
  const close = () => {
    setNumber('');
    setSellerId('');
    setError('');
    searchMutation.reset();
    registerMutation.reset();
    onClose();
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && close()}>
      <Modal.Backdrop>
        <Modal.Container placement="center">
          <Modal.Dialog className="siigo-quotation-modal">
            <Modal.CloseTrigger aria-label="Cerrar búsqueda" />
            <Modal.Header>
              <div>
                <Modal.Heading>Buscar factura</Modal.Heading>
                <p className="siigo-quotation-subtitle">
                  Consulta la factura en Siigo antes de agregarla al panel
                </p>
              </div>
            </Modal.Header>
            <Modal.Body>
              {error && (
                <Alert status="danger">
                  <Alert.Content>
                    <Alert.Description>{error}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}
              {needsSeller && (
                <div className="customer-field">
                  <Label>Punto de venta o comercial</Label>
                  <Select
                    aria-label="Punto de venta o comercial"
                    value={sellerId}
                    variant="secondary"
                    onChange={(value) => {
                      setSellerId(String(value));
                      searchMutation.reset();
                    }}
                  >
                    <Select.Trigger>
                      <Select.Value />
                      <Select.Indicator />
                    </Select.Trigger>
                    <Select.Popover>
                      <ListBox>
                        {prefixes.map((option) => (
                          <ListBox.Item
                            key={String(option.sellerId) + option.prefix}
                            id={String(option.sellerId ?? '')}
                          >
                            {option.userName} · {option.prefix}
                            <ListBox.ItemIndicator />
                          </ListBox.Item>
                        ))}
                      </ListBox>
                    </Select.Popover>
                  </Select>
                  <Description>Define con qué prefijo se arma el nombre de la factura.</Description>
                </div>
              )}
              <div className="customer-field">
                <Label>Número de factura</Label>
                <SearchField
                  aria-label="Número de factura"
                  value={number}
                  variant="secondary"
                  onChange={setNumber}
                  onSubmit={() => number.trim() && searchMutation.mutate()}
                >
                  <SearchField.Group>
                    <SearchField.SearchIcon />
                    <SearchField.Input placeholder="789" inputMode="numeric" />
                    <SearchField.ClearButton />
                  </SearchField.Group>
                </SearchField>
                <Description>Solo el número. El prefijo lo pone el CRM.</Description>
              </div>

              {preview && (
                <dl className="order-ticket-data">
                  <div>
                    <dt>Factura</dt>
                    <dd>{preview.invoice.name}</dd>
                  </div>
                  <div>
                    <dt>Fecha</dt>
                    <dd>{invoiceDate(preview.invoice.date)}</dd>
                  </div>
                  <div>
                    <dt>Documento</dt>
                    <dd>{preview.invoice.customerIdentification}</dd>
                  </div>
                  <div>
                    <dt>Total</dt>
                    <dd>{formattedMoneyWithCode(preview.invoice.total, 'COP')}</dd>
                  </div>
                  <div>
                    <dt>Productos</dt>
                    <dd>{preview.invoice.itemCount}</dd>
                  </div>
                  <div>
                    <dt>Puntos</dt>
                    <dd>
                      <strong>{preview.invoice.points}</strong>
                    </dd>
                  </div>
                </dl>
              )}
              {preview?.existingId && (
                <Alert status="warning">
                  <Alert.Content>
                    <Alert.Description>
                      Esta factura ya está registrada en el panel. Ábrela desde la tabla para
                      acumular sus puntos, sin volver a agregarla.
                    </Alert.Description>
                  </Alert.Content>
                </Alert>
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={close}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                isPending={registerMutation.isPending}
                isDisabled={!preview || Boolean(preview.existingId) || preview.invoice.points <= 0}
                onPress={() => registerMutation.mutate()}
              >
                Usar factura
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}

/**
 * Consulta la cuenta en Puntos Colombia y acumula. Cambiar el documento o el tipo invalida la
 * consulta anterior: el botón no puede quedar habilitado con datos que ya no corresponden.
 */
function AccrualModal({
  invoice,
  onClose,
  onDone,
}: {
  invoice: PointsInvoiceRecord | null;
  onClose: () => void;
  onDone: () => void;
}) {
  const [documentNumber, setDocumentNumber] = useState<string | null>(null);
  const [documentType, setDocumentType] = useState<PointsDocumentType>('2');
  const [error, setError] = useState('');
  const [result, setResult] = useState<{
    pointsEarned: number;
    pointsBalance: number;
    balanceValueInMoney: number | null;
  } | null>(null);

  const lookupMutation = useMutation({
    mutationFn: () => pointsColombiaApi.lookupAccount(currentDocument().value, documentType),
    onError: (failure: Error) => setError(failure.message),
    onSuccess: () => setError(''),
  });
  const accrueMutation = useMutation({
    mutationFn: () => pointsColombiaApi.accrue(invoice!.id, currentDocument().value, documentType),
    onError: (failure: Error) => setError(failure.message),
    onSuccess: (data) => {
      setError('');
      setResult({
        pointsEarned: data.pointsEarned,
        pointsBalance: data.pointsBalance,
        balanceValueInMoney: data.balanceValueInMoney,
      });
    },
  });

  /**
   * Documento con el que se consulta. Mientras el operador no escriba nada se usa el que trajo
   * Siigo: el campo se ve precargado, así que consultar con el estado vacío sería una contradicción.
   */
  function currentDocument() {
    const value = documentNumber ?? invoice?.customerIdentification ?? '';
    return { value: value.trim() };
  }

  if (!invoice) return null;
  const shownDocument = currentDocument().value;
  const lookup = lookupMutation.data;
  const canSubmit = lookup?.found === true && lookup.balance.allowAccrual;
  const invalidate = () => {
    lookupMutation.reset();
    setError('');
  };
  const close = () => {
    setDocumentNumber(null);
    setError('');
    setResult(null);
    lookupMutation.reset();
    accrueMutation.reset();
    onClose();
  };

  return (
    <Modal isOpen onOpenChange={(open) => !open && close()}>
      <Modal.Backdrop>
        <Modal.Container placement="center">
          <Modal.Dialog className="siigo-quotation-modal">
            <Modal.CloseTrigger aria-label="Cerrar acumulación" />
            <Modal.Header>
              <div>
                <Modal.Heading>
                  Acumular puntos
                  <Chip color="default">{invoice.name}</Chip>
                </Modal.Heading>
                <p className="siigo-quotation-subtitle">
                  {formattedMoneyWithCode(invoice.total, 'COP')} · {invoice.points} puntos
                </p>
              </div>
            </Modal.Header>
            <Modal.Body>
              {error && (
                <Alert status="danger">
                  <Alert.Content>
                    <Alert.Description>{error}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}
              {result ? (
                <dl className="order-ticket-data">
                  <div>
                    <dt>Puntos acreditados</dt>
                    <dd>
                      <strong>{result.pointsEarned}</strong>
                    </dd>
                  </div>
                  <div>
                    <dt>Saldo total</dt>
                    <dd>{result.pointsBalance} puntos</dd>
                  </div>
                  <div>
                    <dt>Equivalente</dt>
                    <dd>
                      {/* Si la consulta posterior falló, la acumulación sigue siendo un éxito. */}
                      {result.balanceValueInMoney === null
                        ? 'No disponible por ahora'
                        : formattedMoneyWithCode(String(result.balanceValueInMoney), 'COP')}
                    </dd>
                  </div>
                </dl>
              ) : (
                <>
                  <div className="customer-field">
                    <Label>Tipo de documento</Label>
                    <Select
                      aria-label="Tipo de documento"
                      value={documentType}
                      variant="secondary"
                      onChange={(value) => {
                        setDocumentType(String(value) as PointsDocumentType);
                        invalidate();
                      }}
                    >
                      <Select.Trigger>
                        <Select.Value />
                        <Select.Indicator />
                      </Select.Trigger>
                      <Select.Popover>
                        <ListBox>
                          {pointsDocumentTypes.map((option) => (
                            <ListBox.Item key={option.value} id={option.value}>
                              {option.label}
                              <ListBox.ItemIndicator />
                            </ListBox.Item>
                          ))}
                        </ListBox>
                      </Select.Popover>
                    </Select>
                  </div>
                  <div className="customer-field">
                    <Label>Número de documento</Label>
                    <SearchField
                      aria-label="Número de documento"
                      value={shownDocument}
                      variant="secondary"
                      onChange={(value) => {
                        setDocumentNumber(value);
                        invalidate();
                      }}
                      onSubmit={() => shownDocument && lookupMutation.mutate()}
                    >
                      <SearchField.Group>
                        <SearchField.SearchIcon />
                        <SearchField.Input placeholder="Documento del cliente" />
                        <SearchField.ClearButton />
                      </SearchField.Group>
                    </SearchField>
                  </div>
                  <div>
                    <Button
                      variant="secondary"
                      isPending={lookupMutation.isPending}
                      isDisabled={!shownDocument}
                      onPress={() => lookupMutation.mutate()}
                    >
                      <Magnifier width={16} height={16} />
                      Consultar cuenta
                    </Button>
                  </div>

                  {lookup?.found === false && (
                    <Alert status="warning">
                      <Alert.Content>
                        <Alert.Description>
                          El cliente no está registrado en Puntos Colombia.
                        </Alert.Description>
                      </Alert.Content>
                    </Alert>
                  )}
                  {lookup?.found === true && (
                    <Alert status={canSubmit ? 'success' : 'warning'}>
                      <Alert.Content>
                        <Alert.Description>
                          {canSubmit
                            ? 'Puede acumular. Saldo actual: ' +
                              lookup.balance.pointsAmount +
                              ' puntos.'
                            : 'Cuenta encontrada, pero no habilitada para acumular puntos.'}
                        </Alert.Description>
                      </Alert.Content>
                    </Alert>
                  )}
                </>
              )}
            </Modal.Body>
            <Modal.Footer>
              {result ? (
                <Button variant="primary" onPress={onDone}>
                  Listo
                </Button>
              ) : (
                <>
                  <Button variant="tertiary" onPress={close}>
                    Cancelar
                  </Button>
                  <Button
                    variant="primary"
                    isPending={accrueMutation.isPending}
                    isDisabled={!canSubmit}
                    onPress={() => accrueMutation.mutate()}
                  >
                    <Gem width={16} height={16} />
                    Acumular puntos
                  </Button>
                </>
              )}
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
