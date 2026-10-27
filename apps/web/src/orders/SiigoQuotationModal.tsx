import { useQuery } from '@tanstack/react-query';
import { Alert, Button, Modal, Spinner } from '@heroui/react';
import { ArrowUpRightFromSquare, PaperPlane } from '@gravity-ui/icons';
import { Chip } from '../components/Chip';
import { ordersApi, type SiigoQuotationPreviewRecord } from './api';
import { formattedDate, formattedMoneyWithCode } from './presentation';

function quotationStatusLabel(preview: SiigoQuotationPreviewRecord): string {
  const status = preview.quotation?.status;
  if (status === 'SYNCED') return 'Sincronizada';
  if (status === 'ERROR') return 'Con error';
  if (status === 'SYNCING') return 'Sincronizando';
  return 'Sin sincronizar';
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
        <Modal.Container size="sm" placement="center" scroll="inside">
          <Modal.Dialog className="siigo-quotation-modal">
            <Modal.CloseTrigger aria-label="Cerrar cotización" />
            <Modal.Header>
              <div>
                <Modal.Heading>Cotizaciones Siigo</Modal.Heading>
                <p>{preview?.operationCode ?? 'Cargando operación…'}</p>
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

                    <dl className="siigo-quotation-meta">
                      <div>
                        <dt>Cliente</dt>
                        <dd>{preview.customer.displayName}</dd>
                      </div>
                      <div>
                        <dt>Estado</dt>
                        <dd>{quotationStatusLabel(preview)}</dd>
                      </div>
                      <div>
                        <dt>{preview.customer.documentTypeLabel}</dt>
                        <dd>{preview.customer.documentNumber}</dd>
                      </div>
                      <div>
                        <dt>Cotización</dt>
                        <dd>
                          {preview.quotation?.number ? (
                            preview.quotation.url ? (
                              <a
                                href={preview.quotation.url}
                                target="_blank"
                                rel="noreferrer"
                                className="siigo-quotation-link"
                              >
                                {preview.quotation.number}
                                <ArrowUpRightFromSquare width={13} height={13} />
                              </a>
                            ) : (
                              preview.quotation.number
                            )
                          ) : (
                            '—'
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt>Vendedor</dt>
                        <dd>{preview.seller.name}</dd>
                      </div>
                    </dl>

                    <section className="siigo-quotation-summary">
                      <header>
                        <strong>Resumen</strong>
                        <span>{productCount(preview)}</span>
                      </header>
                      <ul>
                        {preview.items.map((item) => (
                          <li key={`${item.kind}-${item.code}`}>
                            <div className="siigo-quotation-item-copy">
                              <strong>{item.description}</strong>
                              <span>
                                {item.kind === 'SHIPPING' ? 'Envío' : `SKU ${item.code}`}
                                {item.discount > 0 && (
                                  <em className="siigo-quotation-item-discount">
                                    −{item.discount}% desc.
                                  </em>
                                )}
                              </span>
                            </div>
                            <span className="siigo-quotation-item-qty">{item.quantity}x</span>
                            <strong className="siigo-quotation-item-amount">
                              {formattedMoneyWithCode(String(item.grossPrice), preview.currency)}
                            </strong>
                          </li>
                        ))}
                      </ul>
                    </section>

                    <p className="siigo-quotation-footnote">
                      {preview.tax.id > 0 && (
                        <span>
                          Impuesto aplicado: <strong>{preview.tax.label}</strong>
                        </span>
                      )}
                      <span>
                        Última sincronización{' '}
                        {preview.quotation?.syncedAt
                          ? formattedDate(preview.quotation.syncedAt)
                          : '—'}
                      </span>
                    </p>

                    {preview.exchangeRate.required && (
                      <div className="siigo-quotation-rate">
                        <div>
                          <span>TRM del día</span>
                          <strong>{exchangeRateLabel(preview)}</strong>
                        </div>
                        <p>
                          Siigo exige la tasa de cambio en las cotizaciones en dólares. El precio
                          del pedido no cambia.
                        </p>
                      </div>
                    )}

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
              <Button variant="danger-soft" onPress={onClose} isDisabled={isSubmitting}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                isPending={isSubmitting}
                isDisabled={!preview || blocked || previewQuery.isPending}
                onPress={onSubmit}
              >
                {({ isPending }) => (
                  <>
                    {isPending ? <Spinner color="current" size="sm" /> : <PaperPlane width={17} />}
                    {isPending ? 'Sincronizando' : 'Sincronizar Cotización'}
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
