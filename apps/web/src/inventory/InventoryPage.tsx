import { useMemo, useState, type FormEvent } from 'react';
import { keepPreviousData, useQuery } from '@tanstack/react-query';
import { tableFeatures, useTable, type ColumnDef } from '@tanstack/react-table';
import {
  Alert,
  Button,
  Card,
  Chip,
  Input,
  Label,
  Skeleton,
  TextField,
  Typography,
} from '@heroui/react';
import {
  ArrowLeft,
  ArrowRight,
  ArrowRotateLeft,
  Boxes3,
  Eye,
  Link,
  Magnifier,
  Sliders,
  Xmark,
} from '@gravity-ui/icons';
import {
  inventoryApi,
  type ProductFilters,
  type ProductRecord,
  type ProductStore,
  type ProductSyncStatus,
} from './api';
import { LinkProductModal } from './LinkProductModal';
import { useCurrentUser } from '../users/useCurrentUser';

const tableFeatureSet = tableFeatures({});
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
  ERROR: { label: 'Con error', color: 'danger' },
};

const initialFilters: ProductFilters = {
  search: '',
  store: '',
  syncStatus: '',
  page: 1,
  pageSize: 20,
};

function dateTime(value: string | null): string {
  if (!value) return 'Sin registro';
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium', timeStyle: 'short' }).format(
    new Date(value),
  );
}

function InventorySkeleton() {
  return (
    <div className="inventory-skeleton" aria-label="Cargando inventario">
      {Array.from({ length: 7 }, (_, index) => (
        <div className="inventory-skeleton-row" key={index}>
          <Skeleton className="skeleton-product" />
          <Skeleton className="skeleton-cell" />
          <Skeleton className="skeleton-cell" />
          <Skeleton className="skeleton-cell" />
          <Skeleton className="skeleton-action" />
        </div>
      ))}
    </div>
  );
}

export function InventoryPage() {
  const { user } = useCurrentUser();
  const [searchDraft, setSearchDraft] = useState('');
  const [filters, setFilters] = useState<ProductFilters>(initialFilters);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [linkOpen, setLinkOpen] = useState(false);
  const productsQuery = useQuery({
    queryKey: ['products', filters],
    queryFn: () => inventoryApi.list(filters),
    placeholderData: keepPreviousData,
  });
  const detailQuery = useQuery({
    queryKey: ['products', 'detail', selectedId],
    queryFn: () => inventoryApi.detail(selectedId as number),
    enabled: selectedId !== null,
  });

  const columns = useMemo<Array<ColumnDef<typeof tableFeatureSet, ProductRecord>>>(
    () => [
      {
        id: 'product',
        header: 'Producto',
        cell: ({ row }) => (
          <div className="inventory-product-cell">
            <span className="product-thumbnail" aria-hidden="true">
              {row.original.imageUrl ? (
                <img src={row.original.imageUrl} alt="" loading="lazy" />
              ) : (
                <Boxes3 width={20} height={20} />
              )}
            </span>
            <div>
              <strong>{row.original.productName}</strong>
              <span>{row.original.sku}</span>
            </div>
          </div>
        ),
      },
      {
        accessorKey: 'store',
        header: 'Tienda',
        cell: ({ row }) => (row.original.store === 'SERATUS' ? 'Seratus' : 'Pali'),
      },
      {
        id: 'price',
        header: 'Precio Siigo',
        cell: ({ row }) => currencyCop.format(row.original.siigoPriceCop),
      },
      {
        id: 'stock',
        header: 'Stock',
        cell: ({ row }) => (
          <span className={row.original.siigoStock <= 0 ? 'stock-zero' : undefined}>
            {row.original.siigoStock} unidades
          </span>
        ),
      },
      {
        accessorKey: 'syncStatus',
        header: 'Estado',
        cell: ({ row }) => {
          const status = statusMeta[row.original.syncStatus];
          return <Chip color={status.color}>{status.label}</Chip>;
        },
      },
      {
        id: 'actions',
        header: 'Detalle',
        cell: ({ row }) => (
          <Button
            size="sm"
            variant="ghost"
            onPress={() => setSelectedId(row.original.id)}
            aria-label={`Ver detalle de ${row.original.productName}`}
          >
            <Eye width={16} height={16} />
            Ver
          </Button>
        ),
      },
    ],
    [],
  );

  const table = useTable({
    key: 'inventory-products',
    features: tableFeatureSet,
    columns,
    data: productsQuery.data?.data ?? [],
  });

  const applySearch = (event: FormEvent) => {
    event.preventDefault();
    setFilters((current) => ({ ...current, search: searchDraft.trim(), page: 1 }));
  };

  const updateStore = (store: ProductStore | '') => {
    setFilters((current) => ({ ...current, store, page: 1 }));
  };

  const updateStatus = (syncStatus: ProductSyncStatus | '') => {
    setFilters((current) => ({ ...current, syncStatus, page: 1 }));
  };

  const clearFilters = () => {
    setSearchDraft('');
    setFilters(initialFilters);
  };

  const pagination = productsQuery.data?.pagination;
  const hasFilters = Boolean(filters.search || filters.store || filters.syncStatus);

  return (
    <section className={`inventory-layout${selectedId ? ' inventory-layout-with-detail' : ''}`}>
      <Card className="inventory-card">
        <Card.Content className="inventory-card-content">
          <div className="inventory-toolbar">
            <form className="inventory-search" role="search" onSubmit={applySearch}>
              <TextField fullWidth name="inventory-search">
                <Label>Buscar productos</Label>
                <Input
                  value={searchDraft}
                  onChange={(event) => setSearchDraft(event.target.value)}
                  placeholder="Nombre, SKU Siigo o SKU WooCommerce"
                />
              </TextField>
              <Button type="submit" variant="primary" isPending={productsQuery.isFetching}>
                <Magnifier width={17} height={17} />
                Buscar
              </Button>
            </form>
            <div className="inventory-toolbar-actions">
              <Chip color="default">Datos locales</Chip>
              {user?.role === 'ADMIN' && (
                <Button variant="primary" onPress={() => setLinkOpen(true)}>
                  <Link width={17} height={17} />
                  Vincular producto
                </Button>
              )}
            </div>
          </div>

          <div className="inventory-filters">
            <span className="inventory-filter-label">
              <Sliders width={16} height={16} />
              Filtros
            </span>
            <label>
              <span>Tienda</span>
              <select
                value={filters.store}
                onChange={(event) => updateStore(event.target.value as ProductStore | '')}
              >
                <option value="">Todas</option>
                <option value="SERATUS">Seratus</option>
                <option value="PALI">Pali</option>
              </select>
            </label>
            <label>
              <span>Estado</span>
              <select
                value={filters.syncStatus}
                onChange={(event) => updateStatus(event.target.value as ProductSyncStatus | '')}
              >
                <option value="">Todos</option>
                <option value="SYNCED">Sincronizado</option>
                <option value="PENDING">Pendiente</option>
                <option value="OUT_OF_SYNC">Desactualizado</option>
                <option value="ERROR">Con error</option>
              </select>
            </label>
            {hasFilters && (
              <Button size="sm" variant="ghost" onPress={clearFilters}>
                <Xmark width={15} height={15} />
                Limpiar
              </Button>
            )}
          </div>

          {productsQuery.isError ? (
            <div className="inventory-feedback">
              <Alert status="danger">
                <Alert.Content>
                  <Alert.Title>No pudimos cargar el inventario</Alert.Title>
                  <Alert.Description>{productsQuery.error.message}</Alert.Description>
                </Alert.Content>
              </Alert>
              <Button variant="secondary" onPress={() => void productsQuery.refetch()}>
                <ArrowRotateLeft width={17} height={17} />
                Reintentar
              </Button>
            </div>
          ) : productsQuery.isPending ? (
            <InventorySkeleton />
          ) : productsQuery.data.data.length === 0 ? (
            <div className="inventory-empty">
              <span className="inventory-empty-icon" aria-hidden="true">
                <Boxes3 width={28} height={28} />
              </span>
              <Typography.Heading level={2}>
                {hasFilters ? 'No encontramos coincidencias' : 'Aún no hay productos vinculados'}
              </Typography.Heading>
              <Typography.Paragraph color="muted">
                {hasFilters
                  ? 'Ajusta la búsqueda o limpia los filtros para ver más resultados.'
                  : 'El inventario utilizará los productos guardados en la base de datos local.'}
              </Typography.Paragraph>
              {hasFilters && (
                <Button variant="secondary" onPress={clearFilters}>
                  Limpiar filtros
                </Button>
              )}
            </div>
          ) : (
            <div className="inventory-table-wrap">
              <table className="inventory-table">
                <thead>
                  {table.getHeaderGroups().map((headerGroup) => (
                    <tr key={headerGroup.id}>
                      {headerGroup.headers.map((header) => (
                        <th key={header.id} scope="col">
                          {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                        </th>
                      ))}
                    </tr>
                  ))}
                </thead>
                <tbody>
                  {table.getRowModel().rows.map((row) => (
                    <tr key={row.id}>
                      {row.getAllCells().map((cell) => (
                        <td key={cell.id}>
                          <table.FlexRender cell={cell} />
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <footer className="inventory-pagination">
            <span>
              {pagination?.total ?? 0} {(pagination?.total ?? 0) === 1 ? 'producto' : 'productos'}
            </span>
            <div>
              <Button
                size="sm"
                variant="ghost"
                isDisabled={!pagination || pagination.page <= 1 || productsQuery.isFetching}
                onPress={() =>
                  setFilters((current) => ({ ...current, page: Math.max(1, current.page - 1) }))
                }
                aria-label="Página anterior"
              >
                <ArrowLeft width={16} height={16} />
              </Button>
              <span>
                Página {pagination?.page ?? 1} de {pagination?.totalPages ?? 1}
              </span>
              <Button
                size="sm"
                variant="ghost"
                isDisabled={
                  !pagination ||
                  pagination.page >= pagination.totalPages ||
                  productsQuery.isFetching
                }
                onPress={() =>
                  setFilters((current) => ({
                    ...current,
                    page: Math.min(pagination?.totalPages ?? 1, current.page + 1),
                  }))
                }
                aria-label="Página siguiente"
              >
                <ArrowRight width={16} height={16} />
              </Button>
            </div>
          </footer>
        </Card.Content>
      </Card>

      {selectedId !== null && (
        <Card className="product-detail-card">
          <Card.Content className="product-detail-content">
            <div className="product-detail-heading">
              <div>
                <Typography.Heading level={2}>Detalle del producto</Typography.Heading>
                <Typography.Paragraph color="muted" size="sm">
                  Información almacenada localmente
                </Typography.Paragraph>
              </div>
              <Button
                isIconOnly
                variant="ghost"
                aria-label="Cerrar detalle"
                onPress={() => setSelectedId(null)}
              >
                <Xmark width={18} height={18} />
              </Button>
            </div>

            {detailQuery.isPending ? (
              <div className="product-detail-skeleton">
                <Skeleton className="detail-image-skeleton" />
                <Skeleton className="detail-line-skeleton" />
                <Skeleton className="detail-line-skeleton detail-line-short" />
                <Skeleton className="detail-panel-skeleton" />
              </div>
            ) : detailQuery.isError ? (
              <Alert status="danger">
                <Alert.Content>
                  <Alert.Description>{detailQuery.error.message}</Alert.Description>
                </Alert.Content>
              </Alert>
            ) : (
              detailQuery.data && <ProductDetail product={detailQuery.data} />
            )}
          </Card.Content>
        </Card>
      )}

      {user?.role === 'ADMIN' && <LinkProductModal isOpen={linkOpen} onOpenChange={setLinkOpen} />}
    </section>
  );
}

function ProductDetail({ product }: { product: ProductRecord }) {
  const status = statusMeta[product.syncStatus];
  return (
    <div className="product-detail-body">
      <div className="product-detail-product">
        <span className="product-detail-image" aria-hidden="true">
          {product.imageUrl ? (
            <img src={product.imageUrl} alt="" />
          ) : (
            <Boxes3 width={28} height={28} />
          )}
        </span>
        <div>
          <strong>{product.productName}</strong>
          <span>{product.sku}</span>
          <Chip color={status.color}>{status.label}</Chip>
        </div>
      </div>

      <dl className="product-detail-facts">
        <div>
          <dt>Tienda</dt>
          <dd>{product.store === 'SERATUS' ? 'Seratus' : 'Pali'}</dd>
        </div>
        <div>
          <dt>Última comprobación</dt>
          <dd>{dateTime(product.lastCheckAt)}</dd>
        </div>
        <div>
          <dt>Última sincronización</dt>
          <dd>{dateTime(product.lastSyncAt)}</dd>
        </div>
      </dl>

      <div className="product-source-panels">
        <ProductSource
          title="Siigo"
          sku={product.sku}
          priceCop={product.siigoPriceCop}
          priceUsd={product.siigoPriceUsd}
          stock={product.siigoStock}
        />
        <ProductSource
          title="WooCommerce"
          sku={product.wooSku}
          priceCop={product.wooPriceCop}
          priceUsd={product.wooPriceUsd}
          stock={product.wooStock}
        />
      </div>
    </div>
  );
}

function ProductSource({
  title,
  sku,
  priceCop,
  priceUsd,
  stock,
}: {
  title: string;
  sku: string;
  priceCop: number;
  priceUsd: number;
  stock: number;
}) {
  return (
    <section>
      <span>{title}</span>
      <dl>
        <div>
          <dt>SKU</dt>
          <dd>{sku}</dd>
        </div>
        <div>
          <dt>Precio COP</dt>
          <dd>{currencyCop.format(priceCop)}</dd>
        </div>
        <div>
          <dt>Precio USD</dt>
          <dd>USD {priceUsd.toFixed(2)}</dd>
        </div>
        <div>
          <dt>Stock</dt>
          <dd>{stock}</dd>
        </div>
      </dl>
    </section>
  );
}
