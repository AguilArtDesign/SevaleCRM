import { useState, type FormEvent } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Alert, Button, Input, Label, Modal, Skeleton, TextField, Typography } from '@heroui/react';
import { Boxes3, Link, Magnifier, Xmark } from '@gravity-ui/icons';
import { Chip } from '../components/Chip';
import {
  inventoryApi,
  type ProductLinkPreview,
  type ProductRecord,
  type ProductSyncStatus,
} from './api';

const currencyCop = new Intl.NumberFormat('es-CO', {
  style: 'currency',
  currency: 'COP',
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
      <span>Consultando Siigo, Seratus y Pali…</span>
    </div>
  );
}

function nullableCurrency(value: number | null): string {
  return value === null ? 'Sin dato' : currencyCop.format(value);
}

function nullableUsd(value: number | null): string {
  return value === null ? 'Sin dato' : `USD ${value.toFixed(2)}`;
}

function nullableStock(value: number | null): string {
  return value === null ? 'Sin dato' : `${value} unidades`;
}

function SourcePanel({
  title,
  sku,
  priceCop,
  priceUsd,
  stock,
}: {
  title: string;
  sku: string;
  priceCop: number | null;
  priceUsd: number | null;
  stock: number | null;
}) {
  return (
    <section className="link-preview-source">
      <strong>{title}</strong>
      <dl>
        <div>
          <dt>SKU</dt>
          <dd>{sku}</dd>
        </div>
        <div>
          <dt>Precio COP</dt>
          <dd>{nullableCurrency(priceCop)}</dd>
        </div>
        <div>
          <dt>Precio USD</dt>
          <dd>{nullableUsd(priceUsd)}</dd>
        </div>
        <div>
          <dt>Stock</dt>
          <dd>{nullableStock(stock)}</dd>
        </div>
      </dl>
    </section>
  );
}

function Preview({ preview }: { preview: ProductLinkPreview }) {
  const status = statusMeta[preview.syncStatus];
  return (
    <div className="link-preview">
      <div className="link-preview-product">
        <span className="link-preview-image" aria-hidden="true">
          {preview.store.imageUrl ? (
            <img src={preview.store.imageUrl} alt="" />
          ) : (
            <Boxes3 width={28} height={28} />
          )}
        </span>
        <div>
          <Typography.Heading level={3}>
            {preview.store.productName || preview.siigo.name}
          </Typography.Heading>
          <span>{preview.sku}</span>
          <div className="link-preview-chips">
            <Chip color="default">{preview.store.store === 'SERATUS' ? 'Seratus' : 'Pali'}</Chip>
            <Chip color={status.color}>{status.label}</Chip>
          </div>
        </div>
      </div>

      {preview.issues.length > 0 && (
        <Alert status="danger">
          <Alert.Content>
            <Alert.Title>No se puede crear el enlace</Alert.Title>
            <Alert.Description>{preview.issues.join(' ')}</Alert.Description>
          </Alert.Content>
        </Alert>
      )}

      <div className="link-preview-sources">
        <SourcePanel
          title="Siigo"
          sku={preview.siigo.sku}
          priceCop={preview.siigo.priceCop}
          priceUsd={preview.siigo.priceUsd}
          stock={preview.siigo.stock}
        />
        <SourcePanel
          title={`WooCommerce · ${preview.store.store === 'SERATUS' ? 'Seratus' : 'Pali'}`}
          sku={preview.store.sku}
          priceCop={preview.store.priceCop}
          priceUsd={preview.store.priceUsd}
          stock={preview.store.stock}
        />
      </div>
    </div>
  );
}

function SuccessfulLink({ product }: { product: ProductRecord }) {
  return (
    <div className="link-success">
      <span className="link-success-icon" aria-hidden="true">
        <Link width={26} height={26} />
      </span>
      <Typography.Heading level={3}>Producto vinculado</Typography.Heading>
      <Typography.Paragraph color="muted">
        {product.productName} ya está disponible en el inventario.
      </Typography.Paragraph>
      <Chip color="success">{product.sku}</Chip>
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
  const [created, setCreated] = useState<ProductRecord | null>(null);
  const previewMutation = useMutation({
    mutationFn: inventoryApi.linkPreview,
    onSuccess: setPreview,
  });
  const createMutation = useMutation({
    mutationFn: inventoryApi.createLink,
    onSuccess: async (product) => {
      setCreated(product);
      await queryClient.invalidateQueries({ queryKey: ['products'] });
    },
  });

  const reset = () => {
    setSku('');
    setPreview(null);
    setCreated(null);
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
    setCreated(null);
    setPreview(null);
    createMutation.reset();
    previewMutation.mutate(normalizedSku);
  };

  const startNewSearch = () => {
    setPreview(null);
    previewMutation.reset();
    createMutation.reset();
  };

  return (
    <Modal isOpen={isOpen} onOpenChange={changeOpen}>
      <Modal.Backdrop>
        <Modal.Container size="lg" placement="center" scroll="inside">
          <Modal.Dialog>
            <Modal.Header>
              <div>
                <Modal.Heading>Vincular producto</Modal.Heading>
                <p>Comprueba el SKU antes de agregarlo al inventario.</p>
              </div>
              <Modal.CloseTrigger aria-label="Cerrar">
                <Xmark width={18} height={18} />
              </Modal.CloseTrigger>
            </Modal.Header>

            <Modal.Body className="link-product-modal-body">
              {!created && (
                <form className="link-product-search" onSubmit={search}>
                  <TextField fullWidth name="link-product-sku">
                    <Label>SKU</Label>
                    <Input
                      value={sku}
                      onChange={(event) => setSku(event.target.value)}
                      placeholder="Ej. 40204-ROJO-S"
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
                    <Magnifier width={17} height={17} />
                    Buscar
                  </Button>
                </form>
              )}

              {previewMutation.isPending ? (
                <LinkPreviewSkeleton />
              ) : previewMutation.isError ? (
                <Alert status="danger">
                  <Alert.Content>
                    <Alert.Title>No pudimos preparar el producto</Alert.Title>
                    <Alert.Description>{previewMutation.error.message}</Alert.Description>
                  </Alert.Content>
                </Alert>
              ) : created ? (
                <SuccessfulLink product={created} />
              ) : preview ? (
                <Preview preview={preview} />
              ) : (
                <div className="link-product-empty">
                  <span aria-hidden="true">
                    <Link width={24} height={24} />
                  </span>
                  <strong>Busca un SKU para comenzar</strong>
                  <p>La consulta revisará Siigo y las dos tiendas sin modificar sus datos.</p>
                </div>
              )}

              {createMutation.isError && (
                <Alert status="danger">
                  <Alert.Content>
                    <Alert.Title>No se pudo vincular el producto</Alert.Title>
                    <Alert.Description>{createMutation.error.message}</Alert.Description>
                  </Alert.Content>
                </Alert>
              )}
            </Modal.Body>

            <Modal.Footer>
              {created ? (
                <Button variant="primary" onPress={() => changeOpen(false)}>
                  Cerrar
                </Button>
              ) : (
                <>
                  <Button variant="secondary" onPress={() => changeOpen(false)}>
                    Cancelar
                  </Button>
                  {preview && (
                    <Button variant="ghost" onPress={startNewSearch}>
                      Buscar otro SKU
                    </Button>
                  )}
                  <Button
                    variant="primary"
                    isPending={createMutation.isPending}
                    isDisabled={!preview?.canLink || previewMutation.isPending}
                    onPress={() => preview && createMutation.mutate(preview.sku)}
                  >
                    <Link width={17} height={17} />
                    Crear enlace
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
