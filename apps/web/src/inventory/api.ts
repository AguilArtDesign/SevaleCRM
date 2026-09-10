import { apiUrl } from '../config/api-url';

export type ProductStore = 'SERATUS' | 'PALI';
export type ProductSyncStatus = 'PENDING' | 'SYNCED' | 'OUT_OF_SYNC' | 'ERROR';
export type ProductStatusFilter = ProductSyncStatus | 'OUT_OF_STOCK';

export type ProductRecord = {
  id: number;
  siigoId: string;
  sku: string;
  siigoPriceCop: number;
  siigoPriceUsd: number;
  siigoStock: number;
  store: ProductStore;
  wooParentId: string | null;
  wooVariationId: string | null;
  wooSku: string;
  wooPriceCop: number;
  wooPriceUsd: number;
  wooStock: number;
  syncStatus: ProductSyncStatus;
  lastSyncAt: string | null;
  lastCheckAt: string | null;
  productName: string;
  imageUrl: string | null;
  createdAt: string;
  updatedAt: string;
};

export type ProductFilters = {
  search: string;
  store: ProductStore | '';
  syncStatus: ProductStatusFilter | '';
  page: number;
  pageSize: number;
};

export type ProductsResponse = {
  data: ProductRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type ProductSyncJob = {
  id: string;
  status: 'PENDING' | 'RUNNING' | 'COMPLETED' | 'COMPLETED_WITH_ERRORS' | 'FAILED';
  total: number;
  processed: number;
  succeeded: number;
  failed: number;
  errorMessage: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  failedProductIds?: number[];
};

export type ExternalProductSource = {
  id: string;
  sku: string;
  name: string;
  priceCop: number | null;
  priceUsd: number | null;
  stock: number;
};

export type ExternalStoreSource = {
  store: ProductStore;
  parentId: string | null;
  variationId: string;
  sku: string;
  priceCop: number | null;
  priceUsd: number | null;
  stock: number | null;
  productName: string;
  imageUrl: string | null;
  dataWarnings: string[];
};

export type ProductLinkPreview = {
  sku: string;
  isLinked: boolean;
  siigo: ExternalProductSource;
  store: ExternalStoreSource;
  syncStatus: ProductSyncStatus;
  canLink: boolean;
  issues: string[];
};

export type ProductImportIssue = {
  row: number;
  field: string;
  message: string;
};

export type ProductImportPreview = {
  totalRows: number;
  validRows: number;
  newProducts: number;
  existingProducts: number;
  errorCount: number;
  conflictCount: number;
  errors: ProductImportIssue[];
  conflicts: ProductImportIssue[];
  canImport: boolean;
};

export type ProductImportResult = {
  success: true;
  totalRows: number;
  imported: number;
  skipped: number;
};

type ApiErrorBody = { message?: string; error?: { message?: string } };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      ...init?.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error?.message || body.message || 'No pudimos cargar el inventario.');
  }
  return response.json() as Promise<T>;
}

async function download(path: string, init: RequestInit) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error?.message || body.message || 'No pudimos exportar los productos.');
  }
  const disposition = response.headers.get('content-disposition') || '';
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'inventario.xlsx';
  return { blob: await response.blob(), filename };
}

export const inventoryApi = {
  list: (filters: ProductFilters) => {
    const query = new URLSearchParams({
      search: filters.search,
      page: String(filters.page),
      pageSize: String(filters.pageSize),
    });
    if (filters.store) query.set('store', filters.store);
    if (filters.syncStatus) query.set('syncStatus', filters.syncStatus);
    return request<ProductsResponse>(`/api/products?${query.toString()}`);
  },
  detail: (id: number) => request<ProductRecord>(`/api/products/${id}`),
  linkPreview: (sku: string) =>
    request<ProductLinkPreview>(
      `/api/products/link-preview?${new URLSearchParams({ sku }).toString()}`,
    ),
  createLink: (sku: string) =>
    request<ProductRecord>('/api/products', {
      method: 'POST',
      body: JSON.stringify({ sku }),
    }),
  updateLink: (sku: string) =>
    request<ProductRecord>('/api/products', {
      method: 'PUT',
      body: JSON.stringify({ sku }),
    }),
  importStatus: () => request<{ enabled: boolean }>('/api/products/import/status'),
  previewImport: (csv: string) =>
    request<ProductImportPreview>('/api/products/import/preview', {
      method: 'POST',
      body: JSON.stringify({ csv }),
    }),
  importProducts: (csv: string) =>
    request<ProductImportResult>('/api/products/import', {
      method: 'POST',
      body: JSON.stringify({ csv }),
    }),
  sync: (id: number) =>
    request<ProductRecord>(`/api/products/${id}/sync`, {
      method: 'POST',
    }),
  createSyncJob: (ids: number[]) =>
    request<ProductSyncJob>('/api/products/sync-jobs', {
      method: 'POST',
      body: JSON.stringify({ ids }),
    }),
  syncJob: (jobId: string) => request<ProductSyncJob>(`/api/products/sync-jobs/${jobId}`),
  exportProducts: (ids: number[]) =>
    download('/api/products/export', { method: 'POST', body: JSON.stringify({ ids }) }),
  remove: (id: number) => request<ProductRecord>(`/api/products/${id}`, { method: 'DELETE' }),
};
