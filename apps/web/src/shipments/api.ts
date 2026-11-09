import type { ProductStore } from '../inventory/api';
import type { OrderCustomerRecord, OrderSyncStatus } from '../orders/api';
import { apiUrl } from '../config/api-url';

/** Fila del panel de Envíos: una operación completada y con cotización creada en Siigo. */
export type ShipmentBoardRow = {
  operationId: number;
  operationCode: string;
  currency: 'COP' | 'USD';
  total: string;
  createdAt: string;
  updatedAt: string;
  customer: OrderCustomerRecord;
  stores: ProductStore[];
  quotation: { name: string; number: string | null; url: string | null } | null;
  shipment: {
    carrier: string | null;
    trackingNumber: string | null;
    status: string | null;
    updatedAt: string;
    syncs: Array<{
      store: ProductStore;
      syncStatus: OrderSyncStatus;
      errorMessage: string | null;
    }>;
    lastEvent: {
      status: string;
      note: string | null;
      createdAt: string;
      author: string | null;
    } | null;
  } | null;
};

export type ShipmentGuideFilter = 'all' | 'pending' | 'assigned';

export type ShipmentBoardFilters = {
  search: string;
  status: string;
  guide: ShipmentGuideFilter;
  dateFrom: Date | null;
  dateTo: Date | null;
  page: number;
  pageSize: number;
};

export type ShipmentsResponse = {
  data: ShipmentBoardRow[];
  /** Operaciones listas para despachar que todavía no tienen guía. */
  pending: number;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type ShipmentEventRecord = {
  id: number;
  status: string;
  note: string | null;
  createdAt: string;
  author: string | null;
};

/** Bitácora del envío: la guía que tiene hoy y las novedades que se le fueron escribiendo. */
export type ShipmentHistory = {
  operationId: number;
  operationCode: string;
  shipment: {
    carrier: string | null;
    trackingNumber: string | null;
    status: string | null;
    updatedAt: string;
    syncs: Array<{
      store: ProductStore;
      syncStatus: OrderSyncStatus;
      errorMessage: string | null;
    }>;
    events: ShipmentEventRecord[];
  } | null;
};

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
    const body = (await response.json().catch(() => ({}))) as {
      error?: { message?: string };
      message?: string;
    };
    throw new Error(body.error?.message || body.message || 'No pudimos completar la solicitud.');
  }
  return response.json() as Promise<T>;
}

export const shipmentsApi = {
  list: (input: ShipmentBoardFilters) => {
    const query = new URLSearchParams({
      search: input.search,
      guide: input.guide,
      page: String(input.page),
      pageSize: String(input.pageSize),
    });
    if (input.status) query.set('status', input.status);
    if (input.dateFrom) query.set('dateFrom', input.dateFrom.toISOString());
    if (input.dateTo) query.set('dateTo', input.dateTo.toISOString());
    return request<ShipmentsResponse>(`/api/shipments?${query}`);
  },
  history: (operationId: number) => request<ShipmentHistory>(`/api/shipments/${operationId}`),
  addNote: (operationId: number, note: string) =>
    request<ShipmentEventRecord>(`/api/shipments/${operationId}/events`, {
      method: 'POST',
      body: JSON.stringify({ note }),
    }),
};
