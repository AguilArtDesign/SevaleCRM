import { useState, type FormEvent, type ReactNode } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Modal, Skeleton, Spinner, TextField, Typography } from '@heroui/react';
import { Boxes3, Link, Magnifier, TriangleExclamation, Xmark } from '@gravity-ui/icons';
import { Chip } from '../components/Chip';
import { Input } from '../components/Input';
import { inventoryApi, type ProductLinkPreview, type ProductSyncStatus } from './api';

const currencyNumber = new Intl.NumberFormat('es-CO', {
  maximumFractionDigits: 0,
});

const statusMeta: Record<
  ProductSyncStatus,
  { label: string; color: 'success' | 'warning' | 'danger' | 'default' }
> = {
  SYNCED: { label: 'Sincronizado', color: 'success' },
  PENDING: { label: 'Pendiente', color: 'warning' },
  OUT_OF_SYNC: { label: 'Desactualizado', color: 'danger' },
  ERROR: { label: 'Datos incompletos', color: 'danger' },
};

function LinkPreviewSkeleton() {
  return (
    <div className="link-preview-skeleton" aria-label="Consultando proveedores">
      <Skeleton className="link-preview-image-skeleton" />
      <div>
        <Skeleton className="link-preview-line" />
        <Skeleton className="link-preview-line link-preview-line-short" />
      </div>
      <div className="link-preview-panels-skeleton">
        <Skeleton />
        <Skeleton />
      </div>
    </div>
  );
}

function nullableCurrency(value: number | null): string {
  return value === null ? 'Sin dato' : `$${currencyNumber.format(value)}`;
}

function nullableUsd(value: number | null): string {
  return value === null ? 'Sin dato' : `$${currencyNumber.format(value)}`;
}

function nullableStock(value: number | null): string {
  return value === null ? 'Sin dato' : currencyNumber.format(value);
}

function SourcePanel({
  title,
  source,
  priceCop,
  priceUsd,
  stock,
  mismatches,
}: {
  title: string;
  source: 'siigo' | 'pali' | 'seratus';
  priceCop: number | null;
  priceUsd: number | null;
  stock: number | null;
  mismatches?: Partial<Record<'stock' | 'priceCop' | 'priceUsd', boolean>>;
}) {
  return (
    <section className={`product-source-${source}`}>
      <span>{title}</span>
      <dl>
        <div>
          <dt>Precio COP</dt>
          <dd>
            <SourceValue hasMismatch={mismatches?.priceCop}>
              {nullableCurrency(priceCop)}
            </SourceValue>
          </dd>
        </div>
        <div>
          <dt>Precio USD</dt>
          <dd>
            <SourceValue hasMismatch={mismatches?.priceUsd}>{nullableUsd(priceUsd)}</SourceValue>
          </dd>
        </div>
        <div>
          <dt>Stock</dt>
          <dd>
            <SourceValue hasMismatch={mismatches?.stock}>{nullableStock(stock)}</SourceValue>
          </dd>
        </div>
      </dl>
    </section>
  );
}

function SourceValue({
  children,
  hasMismatch = false,
}: {
  children: ReactNode;
  hasMismatch?: boolean;
}) {
  return (
    <span className="product-source-value">
      {children}
      {hasMismatch && (
        <TriangleExclamation
          className="product-source-mismatch-icon"
          width={14}
          height={14}
          role="img"
          aria-label="No coincide con Siigo"
        />
      )}
    </span>
  );
}

function Preview({ preview }: { preview: ProductLinkPreview }) {
  const status = statusMeta[preview.syncStatus];
  return (
    <div className="link-preview product-detail-body">
      <div className="product-detail-product">
        <span className="product-detail-image" aria-hidden="true">
          {preview.store.imageUrl ? (
            <img src={preview.store.imageUrl} alt="" />
          ) : (
            <Boxes3 width={28} height={28} />
          )}
        </span>
        <div>
          <strong>{preview.store.productName || preview.siigo.name}</strong>
          <span className="product-detail-sku">{preview.sku}</span>
          <div className="link-preview-chips">
            <Chip
              className={`inventory-store-chip-${preview.store.store.toLowerCase()}`}
              color="default"
            >
              {preview.store.store === 'SERATUS' ? 'Seratus' : 'Pali'}
            </Chip>
            <Chip color={status.color}>{status.label}</Chip>
          </div>
        </div>
      </div>

      {preview.issues.length > 0 && (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Title>
              {preview.isLinked
                ? 'No se puede actualizar el enlace'
                : 'No se puede crear el enlace'}
            </Alert.Title>
            <Alert.Description>{preview.issues.join(' ')}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      <div className="product-source-panels">
        <SourcePanel
          title="Siigo"
          source="siigo"
          priceCop={preview.siigo.priceCop}
          priceUsd={preview.siigo.priceUsd}
          stock={preview.siigo.stock}
        />
        <SourcePanel
          title="WooCommerce"
          source={preview.store.store.toLowerCase() as 'pali' | 'seratus'}
          priceCop={preview.store.priceCop}
          priceUsd={preview.store.priceUsd}
          stock={preview.store.stock}
          mismatches={{
            priceCop: preview.store.priceCop !== preview.siigo.priceCop,
            priceUsd: preview.store.priceUsd !== preview.siigo.priceUsd,
            stock: preview.store.stock !== preview.siigo.stock,
          }}
        />
      </div>
    </div>
  );
}

export function LinkProductModal({
  isOpen,
  onOpenChange,
}: {
  isOpen: boolean;
  onOpenChange: (isOpen: boolean) => void;
}) {
  const queryClient = useQueryClient();
  const [sku, setSku] = useState('');
  const [preview, setPreview] = useState<ProductLinkPreview | null>(null);
  const previewMutation = useMutation({
    mutationFn: inventoryApi.linkPreview,
    onSuccess: setPreview,
  });
  const createMutation = useMutation({
    mutationFn: ({ sku: productSku, isLinked }: { sku: string; isLinked: boolean }) =>
      isLinked ? inventoryApi.updateLink(productSku) : inventoryApi.createLink(productSku),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      changeOpen(false);
    },
  });

  const reset = () => {
    setSku('');
    setPreview(null);
    previewMutation.reset();
    createMutation.reset();
  };

  const changeOpen = (nextOpen: boolean) => {
    if (!nextOpen) reset();
    onOpenChange(nextOpen);
  };

  const search = (event: FormEvent) => {
    event.preventDefault();
    const normalizedSku = sku.trim();
    if (!normalizedSku) return;
    setPreview(null);
    createMutation.reset();
    previewMutation.mutate(normalizedSku);
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={changeOpen}>
      <Modal.Backdrop>
        <Modal.Container size="md" placement="center" scroll="inside">
          <Modal.Dialog className="link-product-modal">
            <Modal.Header>
              <div>
                <Modal.Heading>Vincular producto</Modal.Heading>
                <Typography.Paragraph color="muted" size="sm">
                  Comprobar datos antes de vincular
                </Typography.Paragraph>
              </div>
              <Modal.CloseTrigger aria-label="Cerrar">
                <Xmark width={18} height={18} />
              </Modal.CloseTrigger>
            </Modal.Header>

            <Modal.Body className="link-product-modal-body">
              <form className="link-product-search" onSubmit={search} autoComplete="off">
                <TextField fullWidth name="product-link-sku-search">
                  <Input
                    aria-label="SKU"
                    variant="secondary"
                    value={sku}
                    onChange={(event) => setSku(event.target.value)}
                    placeholder="Ej. 40204-ROJO-S"
                    autoComplete="off"
                    autoCorrect="off"
                    spellCheck={false}
                    autoFocus
                    disabled={previewMutation.isPending || createMutation.isPending}
                  />
                </TextField>
                <Button
                  type="submit"
                  variant="primary"
                  isPending={previewMutation.isPending}
                  isDisabled={!sku.trim() || createMutation.isPending}
                >
                  {({ isPending }) => (
                    <>
                      {isPending ? (
                        <Spinner color="current" size="sm" />
                      ) : (
                        <Magnifier width={17} height={17} />
                      )}
                      {isPending ? 'Buscando' : 'Buscar'}
                    </>
                  )}
                </Button>
              </form>

              {previewMutation.isPending ? (
                <LinkPreviewSkeleton />
              ) : previewMutation.isError ? (
                <Alert status="danger">
                  <Alert.Content>
                    <Alert.Title>No pudimos preparar el producto</Alert.Title>
                    <Alert.Description>{previewMutation.error.message}</Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : preview ? (
                <Preview preview={preview} />
              ) : (
                <div className="link-product-empty">
                  <span aria-hidden="true">
                    <Link width={24} height={24} />
                  </span>
                  <strong>Buscar un SKU</strong>
                  <p>Se validara en Siigo y tiendas virtuales sin modificar sus datos</p>
                </div>
              )}

              {createMutation.isError && (
                <Alert status="danger">
                  <Alert.Content>
                    <Alert.Title>
                      {preview?.isLinked
                        ? 'No se pudo actualizar el enlace'
                        : 'No se pudo vincular el producto'}
                    </Alert.Title>
                    <Alert.Description>{createMutation.error.message}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}
            </Modal.Body>

            <Modal.Footer>
              <Button variant="secondary" onPress={() => changeOpen(false)}>
                Cancelar
              </Button>
              <Button
                variant="primary"
                isPending={createMutation.isPending}
                isDisabled={!preview?.canLink || previewMutation.isPending}
                onPress={() =>
                  preview && createMutation.mutate({ sku: preview.sku, isLinked: preview.isLinked })
                }
              >
                {({ isPending }) => (
                  <>
                    {isPending ? (
                      <Spinner color="current" size="sm" />
                    ) : (
                      <Link width={17} height={17} />
                    )}
                    {isPending
                      ? 'Vinculando'
                      : preview?.isLinked
                        ? 'Actualizar enlace'
                        : 'Crear enlace'}
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
