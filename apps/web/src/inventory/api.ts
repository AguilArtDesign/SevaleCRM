import { apiUrl } from '../config/api-url';

export type ProductStore = 'SERATUS' | 'PALI';
export type ProductSyncStatus = 'PENDING' | 'SYNCED' | 'OUT_OF_SYNC' | 'ERROR';

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
  syncStatus: ProductSyncStatus | '';
  page: number;
  pageSize: number;
};

export type ProductsResponse = {
  data: ProductRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
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
  remove: (id: number) => request<ProductRecord>(`/api/products/${id}`, { method: 'DELETE' }),
};
