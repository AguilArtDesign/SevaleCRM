import type {
  CreateSiigoQuotationInput,
  CreateOrderOperationInput,
  UpdateOrderOperationInput,
  UpdateShipmentInput,
} from '@sevale/validation';
import type { CustomerRecord } from '../customers/api';
import type { ProductRecord, ProductStore } from '../inventory/api';
import { apiUrl } from '../config/api-url';

export type OrderStatus = 'PENDING' | 'COMPLETED' | 'CANCELLED';
export type OrderSource = 'CRM' | 'WOOCOMMERCE';
export type OrderSyncStatus = 'PENDING' | 'SYNCING' | 'SYNCED' | 'ERROR';

export type OrderListRecord = {
  id: number;
  operationId: number;
  operationCode: string;
  source: OrderSource;
  status: OrderStatus;
  currency: 'COP' | 'USD';
  store: ProductStore;
  wooOrderId: string | null;
  syncStatus: OrderSyncStatus;
  lastSyncAt: string | null;
  lastSyncErrorCode: string | null;
  lastSyncErrorMessage: string | null;
  subtotal: string;
  discountTotal: string;
  shippingTotal: string;
  total: string;
  createdAt: string;
  updatedAt: string;
  customer: Pick<
    CustomerRecord,
    'id' | 'displayName' | 'documentType' | 'documentNumber' | 'email'
  >;
};

export type OrderItemRecord = {
  id: number;
  productId: number | null;
  skuSnapshot: string;
  nameSnapshot: string;
  storeSnapshot: ProductStore;
  quantity: number;
  originalPrice: string | null;
  unitPrice: string;
  priceModified: boolean;
  subtotal: string;
  discountTotal: string;
  total: string;
  product: Pick<ProductRecord, 'id' | 'sku' | 'productName' | 'store' | 'imageUrl'> | null;
};

export type OrderCustomerRecord = Omit<CustomerRecord, 'integrations' | 'location'>;

export type OrderDetailRecord = {
  id: number;
  operationCode: string;
  source: OrderSource;
  status: OrderStatus;
  currency: 'COP' | 'USD';
  subtotal: string;
  discountTotal: string;
  shippingTotal: string;
  total: string;
  createdAt: string;
  updatedAt: string;
  customer: OrderCustomerRecord;
  createdBy: { id: string; name: string; email: string };
  paymentMethod: string | null;
  paymentMethodTitle: string | null;
  shippingMethod: string | null;
  shippingMethodTitle: string | null;
  billingFirstName: string | null;
  billingLastName: string | null;
  billingCompany: string | null;
  billingAddress1: string | null;
  billingAddress2: string | null;
  billingCity: string | null;
  billingState: string | null;
  billingPostcode: string | null;
  billingCountry: string | null;
  billingEmail: string | null;
  billingPhone: string | null;
  shippingFirstName: string | null;
  shippingLastName: string | null;
  shippingCompany: string | null;
  shippingAddress1: string | null;
  shippingAddress2: string | null;
  shippingCity: string | null;
  shippingState: string | null;
  shippingPostcode: string | null;
  shippingCountry: string | null;
  shippingPhone: string | null;
  shipment: {
    id: number;
    carrier: string | null;
    trackingNumber: string | null;
    status: string | null;
    createdAt: string;
    updatedAt: string;
    events: Array<{
      id: number;
      status: string;
      note: string | null;
      createdAt: string;
      createdBy: { id: string; name: string; email: string } | null;
    }>;
    storeSyncs: Array<{
      id: number;
      store: ProductStore;
      syncStatus: OrderSyncStatus;
      lastSyncAt: string | null;
      lastSyncErrorCode: string | null;
      lastSyncErrorMessage: string | null;
    }>;
  } | null;
  siigoQuotation: {
    id: number;
    externalId: string | null;
    number: string | null;
    name: string | null;
    url: string | null;
    sellerId: string | null;
    status: string | null;
    syncedAt: string | null;
    exchangeRate: string | null;
    errorCode: string | null;
    errorMessage: string | null;
    createdAt: string;
    updatedAt: string;
  } | null;
  orders: Array<{
    id: number;
    store: ProductStore;
    wooOrderId: string | null;
    syncStatus: OrderSyncStatus;
    lastSyncAt: string | null;
    lastSyncErrorCode: string | null;
    lastSyncErrorMessage: string | null;
    subtotal: string;
    discountTotal: string;
    shippingTotal: string;
    total: string;
    items: OrderItemRecord[];
    coupons: Array<{ id: number; code: string; discountTotal: string }>;
  }>;
};

export type OrderListResponse = {
  data: OrderListRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type OrderListInput = {
  search: string;
  status: OrderStatus | '';
  source: OrderSource | '';
  store: ProductStore | '';
  page: number;
  pageSize: number;
  sort: 'operationCode' | 'status' | 'source' | 'total' | 'createdAt';
  order: 'asc' | 'desc';
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
    throw new Error(body.error?.message || body.message || 'No pudimos completar la solicitud.');
  }
  return response.json() as Promise<T>;
}

export const ordersApi = {
  list: (input: OrderListInput) => {
    const query = new URLSearchParams({
      search: input.search,
      page: String(input.page),
      pageSize: String(input.pageSize),
      sort: input.sort,
      order: input.order,
    });
    if (input.status) query.set('status', input.status);
    if (input.source) query.set('source', input.source);
    if (input.store) query.set('store', input.store);
    return request<OrderListResponse>(`/api/orders?${query}`);
  },
  detail: (id: number) => request<OrderDetailRecord>(`/api/orders/${id}`),
  create: (input: CreateOrderOperationInput) =>
    request<OrderDetailRecord>('/api/orders', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: number, input: UpdateOrderOperationInput) =>
    request<OrderDetailRecord>(`/api/orders/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  delete: (id: number) => request<OrderDetailRecord>(`/api/orders/${id}`, { method: 'DELETE' }),
  complete: (id: number) =>
    request<OrderDetailRecord>(`/api/orders/${id}/complete`, { method: 'POST' }),
  retrySync: (id: number) =>
    request<OrderDetailRecord>(`/api/orders/${id}/sync`, { method: 'POST' }),
  retryOrderSync: (id: number) =>
    request<OrderDetailRecord>(`/api/orders/rows/${id}/sync`, { method: 'POST' }),
  updateShipment: (id: number, input: UpdateShipmentInput) =>
    request<OrderDetailRecord>(`/api/orders/${id}/shipment`, {
      method: 'PUT',
      body: JSON.stringify(input),
    }),
  retryShipmentSync: (id: number) =>
    request<OrderDetailRecord>(`/api/orders/${id}/shipment/sync`, { method: 'POST' }),
  createSiigoQuotation: (id: number, input: CreateSiigoQuotationInput) =>
    request<OrderDetailRecord>(`/api/orders/${id}/siigo-quotation`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
};
