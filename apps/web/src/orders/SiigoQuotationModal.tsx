import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Modal, Spinner, Table } from '@heroui/react';
import { ArrowUpRightFromSquare, PaperPlane } from '@gravity-ui/icons';
import { Chip } from '../components/Chip';
import { ordersApi, type SiigoQuotationPreviewRecord } from './api';
import { formattedDate, formattedMoneyWithCode } from './presentation';

/**
 * Solo tres estados, como los ve quien cotiza: pendiente, con error o sincronizada. `SYNCING` cae en
 * pendiente porque el panel no tiene una cuarta etiqueta que añada algo útil.
 */
const quotationStatusMeta = {
  PENDING: { label: 'Pendiente', color: 'warning' as const },
  ERROR: { label: 'Error', color: 'danger' as const },
  SYNCED: { label: 'Sincronizado', color: 'success' as const },
};

function quotationStatus(preview: SiigoQuotationPreviewRecord) {
  // Si el pedido cambió después de cotizar, Siigo se quedó con la versión anterior: para el panel
  // vuelve a estar pendiente, porque hay algo que reenviar.
  if (preview.quotationOutdated) return quotationStatusMeta.PENDING;
  const status = preview.quotation?.status;
  if (status === 'SYNCED' || status === 'ERROR') return quotationStatusMeta[status];
  return quotationStatusMeta.PENDING;
}

/** Una cotización ya creada no se vuelve a crear: se actualiza con el pedido actual. */
function submitLabel(preview: SiigoQuotationPreviewRecord | undefined, isPending: boolean) {
  if (isPending) return preview?.quotationOutdated ? 'Actualizando' : 'Sincronizando';
  if (isUpToDate(preview)) return 'Sincronizado';
  return preview?.quotationOutdated ? 'Actualizar Cotización' : 'Sincronizar Cotización';
}

/** Ya está en Siigo tal como está el pedido: no hay nada que reenviar. */
function isUpToDate(preview: SiigoQuotationPreviewRecord | undefined) {
  return Boolean(preview && preview.quotation?.status === 'SYNCED' && !preview.quotationOutdated);
}

function productCount(preview: SiigoQuotationPreviewRecord): string {
  const products = preview.items.filter((item) => item.kind === 'PRODUCT').length;
  return products === 1 ? '1 Producto' : `${products} Productos`;
}

function exchangeRateLabel(preview: SiigoQuotationPreviewRecord): string {
  if (!preview.exchangeRate.value) return 'No disponible';
  const rate = new Intl.NumberFormat('es-CO', {
    maximumFractionDigits: 2,
    minimumFractionDigits: 2,
  }).format(preview.exchangeRate.value);
  return `$ ${rate} COP`;
}

type PreviewItem = SiigoQuotationPreviewRecord['items'][number];

/**
 * Lo que se muestra en el campo Cotización. Se prefiere `name` —el nombre completo, `C-1-846`— y no
 * `number` —el consecutivo suelto, `846`—: Siigo busca por el nombre, así que es el dato que sirve
 * para encontrar la cotización allá. `number` queda de respaldo por si una respuesta antigua no
 * trajo nombre.
 */
function quotationLabel(preview: SiigoQuotationPreviewRecord): string | null {
  return preview.quotation?.name || preview.quotation?.number || null;
}

/** Lo que se paga por unidad después del descuento porcentual que viaja a Siigo. */
function payablePrice(item: PreviewItem): number {
  if (item.discount <= 0) return item.grossPrice;
  return Math.round(item.grossPrice * (1 - item.discount / 100) * 100) / 100;
}

/**
 * Antes de enviar nada a Siigo se muestra exactamente lo que se va a cotizar: cliente, vendedor,
 * productos de todas las tiendas de la operación y, en dólares, la TRM que exige el comprobante.
 */
export function SiigoQuotationModal({
  isOpen,
  operationId,
  isSubmitting,
  serverError,
  onClose,
  onSubmit,
}: {
  isOpen: boolean;
  operationId: number | null;
  isSubmitting: boolean;
  serverError: string;
  onClose: () => void;
  onSubmit: () => void;
}) {
  const previewQuery = useQuery({
    queryKey: ['orders', 'siigo-quotation', operationId],
    queryFn: () => ordersApi.siigoQuotationPreview(operationId!),
    enabled: isOpen && operationId !== null,
    staleTime: 0,
  });
  const preview = previewQuery.data;
  const blocked = Boolean(preview && preview.issues.length > 0);

  return (
    <Modal isOpen={isOpen} onOpenChange={(open) => !open && onClose()}>
      <Modal.Backdrop>
        <Modal.Container placement="center" scroll="inside">
          <Modal.Dialog className="siigo-quotation-modal">
            <Modal.CloseTrigger aria-label="Cerrar cotización" />
            <Modal.Header>
              <div>
                <Modal.Heading className="siigo-quotation-heading">
                  Cotización Siigo
                  <Chip color="default">{preview?.operationCode ?? '—'}</Chip>
                </Modal.Heading>
                <p className="siigo-quotation-subtitle">
                  Validar información antes de enviarla a Siigo
                </p>
              </div>
            </Modal.Header>
            <Modal.Body>
              {previewQuery.isPending ? (
                <div className="siigo-quotation-loading">
                  <Spinner />
                  <span>Preparando la cotización…</span>
                </div>
              ) : previewQuery.isError ? (
                <Alert status="danger">
                  <Alert.Content>
                    <Alert.Description>{previewQuery.error.message}</Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : (
                preview && (
                  <>
                    <div className="siigo-quotation-brand">
                      <img src="/img/siigo.svg" alt="Siigo" />
                      <Chip className="siigo-quotation-currency" color="default">
                        <img
                          src={
                            preview.currency === 'USD' ? '/img/flags/US.webp' : '/img/flags/CO.webp'
                          }
                          alt=""
                          aria-hidden="true"
                        />
                        {preview.currency}
                      </Chip>
                    </div>

                    <dl className="order-ticket-data siigo-quotation-meta">
                      <div>
                        <dt>Cliente</dt>
                        <dd>{preview.customer.displayName}</dd>
                      </div>
                      <div>
                        <dt>Estado</dt>
                        <dd>
                          <Chip color={quotationStatus(preview).color}>
                            {quotationStatus(preview).label}
                          </Chip>
                        </dd>
                      </div>
                      <div>
                        <dt>{preview.customer.documentTypeLabel}</dt>
                        <dd>{preview.customer.documentNumber}</dd>
                      </div>
                      <div>
                        <dt>Cotización</dt>
                        <dd>
                          {quotationLabel(preview) ? (
                            preview.quotation?.url ? (
                              <a
                                href={preview.quotation.url}
                                target="_blank"
                                rel="noreferrer"
                                className="siigo-quotation-link"
                              >
                                {quotationLabel(preview)}
                                <ArrowUpRightFromSquare width={13} height={13} />
                              </a>
                            ) : (
                              quotationLabel(preview)
                            )
                          ) : (
                            '—'
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Comercial</dt>
                        <dd>
                          {/* Un pedido importado de la tienda no lo creó un comercial del CRM:
                              mostrarlo como Sistema evita atribuírselo a quien abrió la vista. */}
                          {preview.source === 'WOOCOMMERCE'
                            ? 'Sistema'
                            : preview.seller.name || '—'}
                        </dd>
                      </div>
                      {/* Solo en dólares: Siigo exige la tasa de cambio en el comprobante. En pesos
                          no hay TRM que mostrar y la celda quedaría vacía. */}
                      {preview.exchangeRate.required && (
                        <div>
                          <dt>TRM</dt>
                          <dd>{exchangeRateLabel(preview)}</dd>
                        </div>
                      )}
                    </dl>

                    <section className="siigo-quotation-summary">
                      <header>
                        <strong>Resumen</strong>
                        <span>{productCount(preview)}</span>
                      </header>
                      {/* Sin encabezado visible: las tres columnas se leen solas en un resumen tan
                          corto. Se conserva en el marcado (oculto) porque la tabla lo necesita para
                          definir las columnas y para que un lector de pantalla las anuncie. */}
                      <Table className="siigo-quotation-table">
                        <Table.Content aria-label="Resumen de la cotización">
                          <Table.Header className="siigo-quotation-table-head">
                            <Table.Column isRowHeader>Producto</Table.Column>
                            <Table.Column>Cantidad</Table.Column>
                            <Table.Column>Precio</Table.Column>
                          </Table.Header>
                          <Table.Body>
                            {preview.items.map((item) => (
                              <Table.Row key={`${item.kind}-${item.code}`}>
                                <Table.Cell>
                                  <div className="siigo-quotation-item-copy">
                                    <strong>{item.description}</strong>
                                    <span>
                                      {item.kind === 'SHIPPING' ? 'Envío' : `SKU ${item.code}`}
                                    </span>
                                  </div>
                                </Table.Cell>
                                <Table.Cell>
                                  <span className="siigo-quotation-item-qty">{item.quantity}</span>
                                </Table.Cell>
                                <Table.Cell>
                                  {/* Con descuento porcentual se conserva el valor de lista tachado
                                      encima del que se paga. Un precio modificado a mano no tiene
                                      descuento: se muestra solo ese valor, sin inventar un precio
                                      anterior que Siigo ya no usa. */}
                                  <div className="siigo-quotation-amount">
                                    {item.discount > 0 ? (
                                      <>
                                        <del>
                                          {formattedMoneyWithCode(
                                            String(item.grossPrice),
                                            preview.currency,
                                          )}
                                        </del>
                                        <span>
                                          {formattedMoneyWithCode(
                                            String(payablePrice(item)),
                                            preview.currency,
                                          )}
                                        </span>
                                      </>
                                    ) : (
                                      <span>
                                        {formattedMoneyWithCode(
                                          String(item.grossPrice),
                                          preview.currency,
                                        )}
                                      </span>
                                    )}
                                  </div>
                                </Table.Cell>
                              </Table.Row>
                            ))}
                          </Table.Body>
                        </Table.Content>
                      </Table>
                    </section>

                    <dl className="order-ticket-data siigo-quotation-meta">
                      <div>
                        <dt>Última sincronización</dt>
                        <dd>
                          {preview.lastSync ? (
                            <>
                              {preview.lastSync.name ?? 'Sistema'}
                              <p className="siigo-quotation-sync-date">
                                {formattedDate(preview.lastSync.at)}
                              </p>
                            </>
                          ) : (
                            '—'
                          )}
                        </dd>
                      </div>
                    </dl>

                    {preview.issues.length > 0 && (
                      <Alert status="warning">
                        <Alert.Content>
                          <Alert.Description>
                            <ul className="siigo-quotation-issues">
                              {preview.issues.map((issue) => (
                                <li key={issue.code}>{issue.message}</li>
                              ))}
                            </ul>
                          </Alert.Description>
                        </Alert.Content>
                      </Alert>
                    )}

                    {preview.quotation?.errorMessage && (
                      <Alert status="danger">
                        <Alert.Content>
                          <Alert.Description>{preview.quotation.errorMessage}</Alert.Description>
                        </Alert.Content>
                      </Alert>
                    )}

                    {serverError && (
                      <Alert status="danger">
                        <Alert.Content>
                          <Alert.Description>{serverError}</Alert.Description>
                        </Alert.Content>
                      </Alert>
                    )}
                  </>
                )
              )}
            </Modal.Body>
            <Modal.Footer>
              <Button variant="tertiary" onPress={onClose} isDisabled={isSubmitting}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                isPending={isSubmitting}
                isDisabled={!preview || blocked || previewQuery.isPending || isUpToDate(preview)}
                onPress={onSubmit}
              >
                {({ isPending }) => (
                  <>
                    {isPending ? <Spinner color="current" size="sm" /> : <PaperPlane width={17} />}
                    {submitLabel(preview, isPending)}
                  </>
                )}
              </Button>
            </Modal.Footer>
          </Modal.Dialog>
        </Modal.Container>
      </Modal.Backdrop>
    </Modal>
  );
}
