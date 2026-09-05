import { useMemo, useState } from 'react';
import { keepPreviousData, useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { tableFeatures, useTable, type ColumnDef } from '@tanstack/react-table';
import type { Selection } from '@heroui/react';
import {
  Alert,
  AlertDialog,
  Button,
  Card,
  Checkbox,
  Description,
  Dropdown,
  Header,
  Label,
  ListBox,
  SearchField,
  Select,
  Separator,
  Skeleton,
  Table,
  Toast,
  Typography,
} from '@heroui/react';
import {
  ArrowRotateLeft,
  Boxes3,
  EllipsisVertical,
  Eye,
  Link,
  TrashBin,
  Xmark,
} from '@gravity-ui/icons';
import { Chip } from '../components/Chip';
import { getPaginationItems, Pagination } from '../components/Pagination';
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
          <Skeleton className="skeleton-selection" />
          <Skeleton className="skeleton-product" />
          <Skeleton className="skeleton-cell" />
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
  const queryClient = useQueryClient();
  const { user } = useCurrentUser();
  const [searchDraft, setSearchDraft] = useState('');
  const [filters, setFilters] = useState<ProductFilters>(initialFilters);
  const [selectedKeys, setSelectedKeys] = useState<Selection>(new Set());
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ProductRecord | null>(null);
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
  const deleteProduct = useMutation({
    mutationFn: (product: ProductRecord) => inventoryApi.remove(product.id),
    onSuccess: async (_, product) => {
      setDeleteTarget(null);
      setSelectedKeys(new Set());
      if (selectedId === product.id) setSelectedId(null);
      if ((productsQuery.data?.data.length ?? 0) === 1 && filters.page > 1) {
        setFilters((current) => ({ ...current, page: current.page - 1 }));
      }
      await queryClient.invalidateQueries({ queryKey: ['products'] });
      Toast.toast.success('Producto eliminado', {
        description: `${product.productName} se eliminó únicamente del inventario local del CRM.`,
      });
    },
    onError: (error) => {
      Toast.toast.danger('No pudimos eliminar el producto', {
        description: error.message,
      });
    },
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
        header: 'Acciones',
        cell: ({ row }) => (
          <Dropdown>
            <Button
              isIconOnly
              size="sm"
              variant="secondary"
              aria-label={`Acciones para ${row.original.productName}`}
            >
              <EllipsisVertical width={17} height={17} />
            </Button>
            <Dropdown.Popover placement="bottom end">
              <Dropdown.Menu
                aria-label={`Acciones para ${row.original.productName}`}
                onAction={(key) => {
                  if (String(key) === 'view') setSelectedId(row.original.id);
                  if (String(key) === 'delete') setDeleteTarget(row.original);
                }}
              >
                <Dropdown.Section>
                  <Header>Acciones</Header>
                  <Dropdown.Item id="view" textValue="Ver producto">
                    <span className="inventory-action-item-icon" aria-hidden="true">
                      <Eye width={16} height={16} />
                    </span>
                    <span className="inventory-action-item-copy">
                      <Label>Ver producto</Label>
                      <Description>Consultar información</Description>
                    </span>
                  </Dropdown.Item>
                </Dropdown.Section>
                {user?.role === 'ADMIN' && <Separator />}
                {user?.role === 'ADMIN' && (
                  <Dropdown.Section>
                    <Header>Zona de peligro</Header>
                    <Dropdown.Item id="delete" textValue="Eliminar producto" variant="danger">
                      <span
                        className="inventory-action-item-icon inventory-action-item-icon-danger"
                        aria-hidden="true"
                      >
                        <TrashBin width={16} height={16} />
                      </span>
                      <span className="inventory-action-item-copy">
                        <Label>Eliminar</Label>
                        <Description>Suprimir del CRM</Description>
                      </span>
                    </Dropdown.Item>
                  </Dropdown.Section>
                )}
              </Dropdown.Menu>
            </Dropdown.Popover>
          </Dropdown>
        ),
      },
    ],
    [user?.role],
  );

  const table = useTable({
    key: 'inventory-products',
    features: tableFeatureSet,
    columns,
    data: productsQuery.data?.data ?? [],
  });

  const applySearch = (value: string) => {
    setSelectedKeys(new Set());
    setFilters((current) => ({ ...current, search: value.trim(), page: 1 }));
  };

  const updateStore = (store: ProductStore | '') => {
    setSelectedKeys(new Set());
    setFilters((current) => ({ ...current, store, page: 1 }));
  };

  const updateStatus = (syncStatus: ProductSyncStatus | '') => {
    setSelectedKeys(new Set());
    setFilters((current) => ({ ...current, syncStatus, page: 1 }));
  };

  const clearFilters = () => {
    setSearchDraft('');
    setSelectedKeys(new Set());
    setFilters(initialFilters);
  };

  const changePage = (page: number) => {
    setSelectedKeys(new Set());
    setFilters((current) => ({ ...current, page }));
  };

  const pagination = productsQuery.data?.pagination;
  const hasFilters = Boolean(filters.search || filters.store || filters.syncStatus);
  const selectedCount =
    selectedKeys === 'all' ? (productsQuery.data?.data.length ?? 0) : selectedKeys.size;
  const pageItems = getPaginationItems(pagination?.page ?? 1, pagination?.totalPages ?? 1);
  const firstResult =
    pagination && pagination.total > 0 ? (pagination.page - 1) * filters.pageSize + 1 : 0;
  const lastResult = pagination
    ? Math.min(pagination.page * filters.pageSize, pagination.total)
    : 0;

  return (
    <section className={`inventory-layout${selectedId ? ' inventory-layout-with-detail' : ''}`}>
      <div className="inventory-list">
        <header className="inventory-list-heading">
          <div>
            <Typography.Heading level={2}>Todos los productos</Typography.Heading>
            <Chip color="default">{pagination?.total ?? 0}</Chip>
          </div>
          {user?.role === 'ADMIN' && (
            <Button variant="primary" onPress={() => setLinkOpen(true)}>
              <Link width={17} height={17} />
              Vincular producto
            </Button>
          )}
        </header>

        <div className="inventory-toolbar">
          <div className="inventory-filters">
            <Select
              aria-label="Filtrar por tienda"
              value={filters.store || 'ALL'}
              variant="secondary"
              onChange={(value) =>
                updateStore(
                  value === 'ALL' || value === null ? '' : (String(value) as ProductStore),
                )
              }
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="ALL" textValue="Todas las tiendas">
                    Todas las tiendas
                  </ListBox.Item>
                  <ListBox.Item id="SERATUS" textValue="Seratus">
                    Seratus
                  </ListBox.Item>
                  <ListBox.Item id="PALI" textValue="Pali">
                    Pali
                  </ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>

            <Select
              aria-label="Filtrar por estado"
              value={filters.syncStatus || 'ALL'}
              variant="secondary"
              onChange={(value) =>
                updateStatus(
                  value === 'ALL' || value === null ? '' : (String(value) as ProductSyncStatus),
                )
              }
            >
              <Select.Trigger>
                <Select.Value />
                <Select.Indicator />
              </Select.Trigger>
              <Select.Popover>
                <ListBox>
                  <ListBox.Item id="ALL" textValue="Todos los estados">
                    Todos los estados
                  </ListBox.Item>
                  <ListBox.Item id="SYNCED" textValue="Sincronizado">
                    Sincronizado
                  </ListBox.Item>
                  <ListBox.Item id="PENDING" textValue="Pendiente">
                    Pendiente
                  </ListBox.Item>
                  <ListBox.Item id="OUT_OF_SYNC" textValue="Desactualizado">
                    Desactualizado
                  </ListBox.Item>
                  <ListBox.Item id="ERROR" textValue="Con error">
                    Con error
                  </ListBox.Item>
                </ListBox>
              </Select.Popover>
            </Select>

            {hasFilters && (
              <Button size="sm" variant="ghost" onPress={clearFilters}>
                <Xmark width={15} height={15} />
                Limpiar
              </Button>
            )}
          </div>

          <SearchField
            aria-label="Buscar productos"
            className="inventory-search"
            value={searchDraft}
            variant="secondary"
            onChange={setSearchDraft}
            onSubmit={applySearch}
            onClear={() => {
              setSearchDraft('');
              applySearch('');
            }}
          >
            <SearchField.Group>
              <SearchField.SearchIcon />
              <SearchField.Input placeholder="Buscar por nombre o SKU..." />
              <SearchField.ClearButton />
            </SearchField.Group>
          </SearchField>
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
          <Table className="inventory-products-table">
            <Table.ScrollContainer>
              <Table.Content
                aria-label="Productos del inventario"
                selectionMode="multiple"
                selectedKeys={selectedKeys}
                onSelectionChange={setSelectedKeys}
              >
                <Table.Header>
                  <Table.Column id="selection" className="inventory-selection-column">
                    <Checkbox
                      slot="selection"
                      aria-label="Seleccionar todos los productos de esta página"
                    >
                      <Checkbox.Content>
                        <Checkbox.Control>
                          <Checkbox.Indicator />
                        </Checkbox.Control>
                      </Checkbox.Content>
                    </Checkbox>
                  </Table.Column>
                  {table.getHeaderGroups()[0]?.headers.map((header) => (
                    <Table.Column
                      key={header.id}
                      id={header.id}
                      isRowHeader={header.id === 'product'}
                    >
                      {header.isPlaceholder ? null : <table.FlexRender header={header} />}
                    </Table.Column>
                  ))}
                </Table.Header>
                <Table.Body>
                  {table.getRowModel().rows.map((row) => (
                    <Table.Row key={row.id} id={row.original.id}>
                      <Table.Cell className="inventory-selection-cell">
                        <Checkbox
                          slot="selection"
                          aria-label={`Seleccionar ${row.original.productName}`}
                          variant="secondary"
                        >
                          <Checkbox.Content>
                            <Checkbox.Control>
                              <Checkbox.Indicator />
                            </Checkbox.Control>
                          </Checkbox.Content>
                        </Checkbox>
                      </Table.Cell>
                      {row.getAllCells().map((cell) => (
                        <Table.Cell key={cell.id}>
                          <table.FlexRender cell={cell} />
                        </Table.Cell>
                      ))}
                    </Table.Row>
                  ))}
                </Table.Body>
              </Table.Content>
            </Table.ScrollContainer>
            <Table.Footer>
              <Pagination aria-label="Paginación del inventario">
                <Pagination.Summary>
                  {selectedCount > 0
                    ? `${selectedCount} ${selectedCount === 1 ? 'seleccionado' : 'seleccionados'}`
                    : `${firstResult} a ${lastResult} de ${pagination?.total ?? 0} productos`}
                </Pagination.Summary>
                <Pagination.Content>
                  <Pagination.Item>
                    <Pagination.Previous
                      isDisabled={!pagination || pagination.page <= 1 || productsQuery.isFetching}
                      onPress={() => changePage(Math.max(1, (pagination?.page ?? 1) - 1))}
                    >
                      <Pagination.PreviousIcon />
                      Anterior
                    </Pagination.Previous>
                  </Pagination.Item>
                  {pageItems.map((item, index) =>
                    item === 'ellipsis' ? (
                      <Pagination.Item key={`ellipsis-${index}`}>
                        <Pagination.Ellipsis />
                      </Pagination.Item>
                    ) : (
                      <Pagination.Item key={item}>
                        <Pagination.Link
                          isActive={item === (pagination?.page ?? 1)}
                          isDisabled={productsQuery.isFetching}
                          onPress={() => changePage(item)}
                        >
                          {item}
                        </Pagination.Link>
                      </Pagination.Item>
                    ),
                  )}
                  <Pagination.Item>
                    <Pagination.Next
                      isDisabled={
                        !pagination ||
                        pagination.page >= pagination.totalPages ||
                        productsQuery.isFetching
                      }
                      onPress={() =>
                        changePage(
                          Math.min(pagination?.totalPages ?? 1, (pagination?.page ?? 1) + 1),
                        )
                      }
                    >
                      Siguiente
                      <Pagination.NextIcon />
                    </Pagination.Next>
                  </Pagination.Item>
                </Pagination.Content>
              </Pagination>
            </Table.Footer>
          </Table>
        )}
      </div>

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

      <AlertDialog
        isOpen={deleteTarget !== null}
        onOpenChange={(isOpen) => {
          if (!isOpen && !deleteProduct.isPending) setDeleteTarget(null);
        }}
      >
        <AlertDialog.Backdrop>
          <AlertDialog.Container size="sm">
            <AlertDialog.Dialog>
              <AlertDialog.Header>
                <AlertDialog.Icon status="danger">
                  <TrashBin width={20} height={20} />
                </AlertDialog.Icon>
                <AlertDialog.Heading>Eliminar producto del CRM</AlertDialog.Heading>
              </AlertDialog.Header>
              <AlertDialog.Body>
                <p>
                  Se eliminará <strong>{deleteTarget?.productName}</strong> del inventario local.
                  Esta acción no elimina el producto en Siigo ni en WooCommerce.
                </p>
              </AlertDialog.Body>
              <AlertDialog.Footer>
                <Button
                  variant="secondary"
                  isDisabled={deleteProduct.isPending}
                  onPress={() => setDeleteTarget(null)}
                >
                  Cancelar
                </Button>
                <Button
                  variant="danger"
                  isPending={deleteProduct.isPending}
                  onPress={() => deleteTarget && deleteProduct.mutate(deleteTarget)}
                >
                  Eliminar producto
                </Button>
              </AlertDialog.Footer>
            </AlertDialog.Dialog>
          </AlertDialog.Container>
        </AlertDialog.Backdrop>
      </AlertDialog>
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
