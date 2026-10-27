import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Alert,
  AlertDialog,
  Button,
  ListBox,
  Modal,
  SearchField,
  Spinner,
  Table,
  Typography,
  toast,
} from '@heroui/react';
import { ArrowRotateRight, CircleInfo, TrashBin } from '@gravity-ui/icons';
import { hasPermission } from '@sevale/permissions';
import { Chip } from '../components/Chip';
import { getPaginationItems, Pagination } from '../components/Pagination';
import { Select } from '../components/Select';
import { useCurrentUser } from '../users/useCurrentUser';
import { logsApi, type LogDetailRecord, type LogOutcome } from './api';

const integrationLabels: Record<string, string> = {
  SIIGO: 'Siigo',
  TRM: 'TRM',
};

function integrationLabel(value: string): string {
  if (value.startsWith('WOO_SERATUS')) return 'WooCommerce · Seratus';
  if (value.startsWith('WOO_PALI')) return 'WooCommerce · Pali';
  return integrationLabels[value] ?? value.replaceAll('_', ' ');
}

const formattedDateFormatter = new Intl.DateTimeFormat('es-CO', {
  dateStyle: 'short',
  timeStyle: 'medium',
});

function formattedDate(value: string): string {
  return formattedDateFormatter.format(new Date(value));
}

function durationLabel(value: number | null): string {
  if (value === null) return '—';
  return value < 1_000 ? `${value} ms` : `${(value / 1_000).toFixed(2)} s`;
}

/** El cuerpo se guarda como texto JSON; se muestra con sangría cuando se puede interpretar. */
function prettyBody(value: string | null): string {
  if (!value) return 'Sin cuerpo.';
  try {
    return JSON.stringify(JSON.parse(value) as unknown, null, 2);
  } catch {
    return value;
  }
}

export function LogsPage() {
  const { user } = useCurrentUser();
  const canClear = Boolean(user && hasPermission(user.role, 'logs.clear'));
  const queryClient = useQueryClient();

  const [searchDraft, setSearchDraft] = useState('');
  const [search, setSearch] = useState('');
  const [integration, setIntegration] = useState('');
  const [outcome, setOutcome] = useState<LogOutcome | ''>('');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(50);
  const [detailId, setDetailId] = useState<number | null>(null);
  const [clearOpen, setClearOpen] = useState(false);

  const logsQuery = useQuery({
    queryKey: ['logs', { search, integration, outcome, page, pageSize }],
    queryFn: () => logsApi.list({ search, integration, outcome, page, pageSize }),
    placeholderData: (previous) => previous,
  });
  const facetsQuery = useQuery({ queryKey: ['logs', 'facets'], queryFn: logsApi.facets });
  const detailQuery = useQuery({
    queryKey: ['logs', 'detail', detailId],
    queryFn: () => logsApi.detail(detailId as number),
    enabled: detailId !== null,
  });
  const clearLogs = useMutation({
    mutationFn: logsApi.clear,
    onSuccess: async (result) => {
      setClearOpen(false);
      toast.success(
        result.deleted === 1
          ? 'Se eliminó 1 registro.'
          : `Se eliminaron ${result.deleted} registros.`,
      );
      await queryClient.invalidateQueries({ queryKey: ['logs'] });
    },
  });

  const logs = logsQuery.data?.data ?? [];
  const total = logsQuery.data?.pagination.total ?? 0;
  const totalPages = logsQuery.data?.pagination.totalPages ?? 1;
  const detail: LogDetailRecord | undefined = detailQuery.data;

  return (
    <section className="logs-layout">
      <div className="page-heading-row">
        <div className="logs-heading">
          <Typography.Heading level={2}>Logs de integración</Typography.Heading>
          <Chip>{total}</Chip>
        </div>
        <div className="logs-actions">
          <Button
            variant="secondary"
            isDisabled={logsQuery.isFetching}
            onPress={() => void logsQuery.refetch()}
          >
            <ArrowRotateRight width={17} height={17} />
            Actualizar
          </Button>
          {canClear && (
            <Button variant="danger-soft" onPress={() => setClearOpen(true)}>
              <TrashBin width={17} height={17} />
              Vaciar
            </Button>
          )}
        </div>
      </div>

      <div className="logs-toolbar">
        <SearchField
          aria-label="Buscar en los logs"
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
            <SearchField.Input placeholder="Código, mensaje o ruta" />
            <SearchField.ClearButton />
          </SearchField.Group>
        </SearchField>
        <Select
          aria-label="Integración"
          value={integration}
          onChange={(value) => {
            setIntegration(String(value));
            setPage(1);
          }}
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="" textValue="Todas las integraciones">
                Todas las integraciones
                <ListBox.ItemIndicator />
              </ListBox.Item>
              {(facetsQuery.data?.integrations ?? []).map((value) => (
                <ListBox.Item key={value} id={value} textValue={integrationLabel(value)}>
                  {integrationLabel(value)}
                  <ListBox.ItemIndicator />
                </ListBox.Item>
              ))}
            </ListBox>
          </Select.Popover>
        </Select>
        <Select
          aria-label="Resultado"
          value={outcome}
          onChange={(value) => {
            setOutcome(String(value) as LogOutcome | '');
            setPage(1);
          }}
        >
          <Select.Trigger>
            <Select.Value />
            <Select.Indicator />
          </Select.Trigger>
          <Select.Popover>
            <ListBox>
              <ListBox.Item id="" textValue="Todos los resultados">
                Todos los resultados
                <ListBox.ItemIndicator />
              </ListBox.Item>
              <ListBox.Item id="ERROR" textValue="Solo errores">
                Solo errores
                <ListBox.ItemIndicator />
              </ListBox.Item>
              <ListBox.Item id="SUCCESS" textValue="Solo correctos">
                Solo correctos
                <ListBox.ItemIndicator />
              </ListBox.Item>
            </ListBox>
          </Select.Popover>
        </Select>
      </div>

      <div className="logs-table-shell">
        {logsQuery.isPending ? (
          <div className="logs-state">
            <Spinner />
            <span>Cargando registros…</span>
          </div>
        ) : logsQuery.isError ? (
          <div className="logs-state">
            <Alert status="danger">
              <Alert.Content>
                <Alert.Description>{logsQuery.error.message}</Alert.Description>
              </Alert.Content>
            </Alert>
          </div>
        ) : logs.length === 0 ? (
          <div className="logs-state">
            <CircleInfo width={30} height={30} />
            <strong>Sin registros</strong>
            <span>Aquí aparecerá cada llamada a Siigo, WooCommerce y la TRM.</span>
          </div>
        ) : (
          <Table>
            <Table.ScrollContainer>
              <Table.Content aria-label="Logs de integración">
                <Table.Header>
                  <Table.Column isRowHeader>Fecha</Table.Column>
                  <Table.Column>Integración</Table.Column>
                  <Table.Column>Llamada</Table.Column>
                  <Table.Column>Resultado</Table.Column>
                  <Table.Column>Código</Table.Column>
                  <Table.Column>Mensaje</Table.Column>
                  <Table.Column>Duración</Table.Column>
                </Table.Header>
                <Table.Body>
                  {logs.map((log) => (
                    <Table.Row key={log.id} id={log.id} onAction={() => setDetailId(log.id)}>
                      <Table.Cell>{formattedDate(log.createdAt)}</Table.Cell>
                      <Table.Cell>
                        <span className="logs-integration-cell">
                          {integrationLabel(log.integration)}
                        </span>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="logs-call-cell">
                          <strong>{log.method ?? '—'}</strong>
                          <span title={log.url ?? undefined}>{log.operation}</span>
                        </span>
                      </Table.Cell>
                      <Table.Cell>
                        <LogOutcomeChip outcome={log.outcome} statusCode={log.statusCode} />
                      </Table.Cell>
                      <Table.Cell>
                        <span className="logs-code-cell">{log.code ?? '—'}</span>
                      </Table.Cell>
                      <Table.Cell>
                        <span className="logs-message-cell" title={log.message ?? undefined}>
                          {log.message ?? '—'}
                        </span>
                      </Table.Cell>
                      <Table.Cell>{durationLabel(log.durationMs)}</Table.Cell>
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
          </Table>
        )}

        <Pagination aria-label="Paginación de logs">
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
                    {[20, 50, 100].map((size) => (
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
                isDisabled={page <= 1 || logsQuery.isFetching}
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
                    isDisabled={logsQuery.isFetching}
                    onPress={() => setPage(item)}
                  >
                    {item}
                  </Pagination.Link>
                </Pagination.Item>
              ),
            )}
            <Pagination.Item>
              <Pagination.Next
                isDisabled={page >= totalPages || logsQuery.isFetching}
                onPress={() => setPage((value) => Math.min(totalPages, value + 1))}
              >
                Siguiente
                <Pagination.NextIcon />
              </Pagination.Next>
            </Pagination.Item>
          </Pagination.Content>
        </Pagination>
      </div>

      <Modal isOpen={detailId !== null} onOpenChange={(open) => !open && setDetailId(null)}>
        <Modal.Backdrop>
          <Modal.Container size="lg" placement="center" scroll="inside">
            <Modal.Dialog className="log-detail-modal">
              <Modal.CloseTrigger aria-label="Cerrar registro" />
              <Modal.Header>
                <div>
                  <Modal.Heading>{detail?.code ?? 'Registro de integración'}</Modal.Heading>
                  <p>
                    {detail ? `${integrationLabel(detail.integration)} · ${detail.operation}` : ''}
                  </p>
                </div>
              </Modal.Header>
              <Modal.Body>
                {detailQuery.isPending ? (
                  <div className="logs-state">
                    <Spinner />
                    <span>Cargando registro…</span>
                  </div>
                ) : detailQuery.isError ? (
                  <Alert status="danger">
                    <Alert.Content>
                      <Alert.Description>{detailQuery.error.message}</Alert.Description>
                    </Alert.Content>
                  </Alert>
                ) : detail ? (
                  <>
                    <dl className="log-detail-meta">
                      <div>
                        <dt>Fecha</dt>
                        <dd>{formattedDate(detail.createdAt)}</dd>
                      </div>
                      <div>
                        <dt>Resultado</dt>
                        <dd>
                          <LogOutcomeChip outcome={detail.outcome} statusCode={detail.statusCode} />
                        </dd>
                      </div>
                      <div>
                        <dt>Duración</dt>
                        <dd>{durationLabel(detail.durationMs)}</dd>
                      </div>
                      <div>
                        <dt>Usuario</dt>
                        <dd>{detail.user?.name ?? 'Sistema'}</dd>
                      </div>
                      <div className="log-detail-wide">
                        <dt>Ruta</dt>
                        <dd className="log-detail-url">{detail.url ?? '—'}</dd>
                      </div>
                      {detail.referenceType && (
                        <div>
                          <dt>Referencia</dt>
                          <dd>
                            {detail.referenceType} {detail.referenceId}
                          </dd>
                        </div>
                      )}
                    </dl>

                    {detail.message && (
                      <Alert status={detail.outcome === 'ERROR' ? 'danger' : 'success'}>
                        <Alert.Content>
                          <Alert.Description>{detail.message}</Alert.Description>
                        </Alert.Content>
                      </Alert>
                    )}

                    <div className="log-detail-bodies">
                      <section>
                        <h3>Petición enviada</h3>
                        <pre>{prettyBody(detail.requestBody)}</pre>
                      </section>
                      <section>
                        <h3>Respuesta recibida</h3>
                        <pre>{prettyBody(detail.responseBody)}</pre>
                      </section>
                    </div>
                  </>
                ) : null}
              </Modal.Body>
            </Modal.Dialog>
          </Modal.Container>
        </Modal.Backdrop>
      </Modal>

      <AlertDialog isOpen={clearOpen} onOpenChange={setClearOpen}>
        <AlertDialog.Backdrop>
          <AlertDialog.Container>
            <AlertDialog.Dialog className="sm:max-w-[420px]">
              <AlertDialog.CloseTrigger />
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger" />
                <AlertDialog.Heading>¿Vaciar el registro?</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p>
                  Se eliminarán todos los registros de integración. Los pedidos, clientes y
                  cotizaciones no se modifican.
                </p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button slot="close" variant="tertiary">
                  Cancelar
                </Button>
                <Button
                  variant="danger"
                  isPending={clearLogs.isPending}
                  onPress={() => clearLogs.mutate()}
                >
                  Vaciar
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
    </section>
  );
}

function LogOutcomeChip({
  outcome,
  statusCode,
}: {
  outcome: LogOutcome;
  statusCode: number | null;
}) {
  const label = outcome === 'SUCCESS' ? 'OK' : 'Error';
  const status = statusCode ? ` ${statusCode}` : '';
  return (
    <Chip className={`log-outcome-chip log-outcome-${outcome.toLowerCase()}`} color="default">
      {label}
      {status}
    </Chip>
  );
}
