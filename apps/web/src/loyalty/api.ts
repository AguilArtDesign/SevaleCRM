import type { PointsDocumentType, PointsInvoiceListQuery } from '@sevale/validation';
import { apiUrl } from '../config/api-url';

export type PointsInvoiceStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'UNVERIFIED';

export type PointsInvoiceRecord = {
  id: number;
  source: 'SIIGO' | 'UAT_SEED';
  siigoInvoiceId: string | null;
  name: string;
  invoiceDate: string;
  sellerId: number | null;
  sellerName: string | null;
  customerIdentification: string;
  customerDocumentType: string | null;
  total: string;
  itemCount: number;
  points: number;
  status: PointsInvoiceStatus;
  completedAt: string | null;
  createdBy: { id: string; name: string; email: string } | null;
  createdAt: string;
  accrual: {
    id: number;
    status: 'PROCESSING' | 'COMPLETED' | 'FAILED' | 'UNVERIFIED';
    pointsRequested: number;
    pointsEarned: number | null;
    pointsBalance: number | null;
    approbationNumber: string | null;
    balanceValueInMoney: string | null;
    balanceCheckedAt: string | null;
    documentNumber: string;
    documentType: string;
    errorCode: string | null;
    errorMessage: string | null;
    completedAt: string | null;
    createdAt: string;
    user: { id: string; name: string };
  } | null;
};

export type PointsInvoiceListResponse = {
  data: PointsInvoiceRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type PointsInvoicePreview = {
  invoice: {
    id: string;
    name: string;
    date: string;
    sellerId: number;
    total: string;
    customerIdentification: string;
    itemCount: number;
    points: number;
  };
  /** Ya registrada en el panel: se abre su fila en lugar de duplicarla. */
  existingId: number | null;
};

export type PointsBalanceRecord = {
  name: string | null;
  pointsAmount: number;
  pointsValueInMoney: number;
  allowAccrual: boolean;
};

export type PointsLookupResult = { found: true; balance: PointsBalanceRecord } | { found: false };

export type PointsAccrualResponse = {
  invoice: PointsInvoiceRecord;
  pointsEarned: number;
  pointsBalance: number;
  balanceValueInMoney: number | null;
};

export type PointsPrefixOption = {
  prefix: string;
  sellerId: number | null;
  userName: string;
};

type ApiErrorBody = { message?: string; error?: { message?: string } };

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
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

export const pointsColombiaApi = {
  list: (input: PointsInvoiceListQuery) => {
    const query = new URLSearchParams({
      search: input.search,
      status: input.status ?? 'all',
      page: String(input.page),
      pageSize: String(input.pageSize),
    });
    if (input.sellerId) query.set('sellerId', String(input.sellerId));
    if (input.dateFrom) query.set('dateFrom', input.dateFrom.toISOString());
    if (input.dateTo) query.set('dateTo', input.dateTo.toISOString());
    return apiRequest<PointsInvoiceListResponse>(`/api/points-colombia/invoices?${query}`);
  },
  prefixes: () => apiRequest<PointsPrefixOption[]>('/api/points-colombia/invoices/prefixes'),
  detail: (id: number) => apiRequest<PointsInvoiceRecord>(`/api/points-colombia/invoices/${id}`),
  search: (number: string, sellerId?: number) =>
    apiRequest<PointsInvoicePreview>('/api/points-colombia/invoices/search', {
      method: 'POST',
      body: JSON.stringify(sellerId ? { number, sellerId } : { number }),
    }),
  register: (number: string, sellerId?: number) =>
    apiRequest<PointsInvoiceRecord>('/api/points-colombia/invoices', {
      method: 'POST',
      body: JSON.stringify(sellerId ? { number, sellerId } : { number }),
    }),
  lookupAccount: (documentNumber: string, documentType: PointsDocumentType) =>
    apiRequest<PointsLookupResult>('/api/points-colombia/accounts/lookup', {
      method: 'POST',
      body: JSON.stringify({ documentNumber, documentType }),
    }),
  accrue: (id: number, documentNumber: string, documentType: PointsDocumentType) =>
    apiRequest<PointsAccrualResponse>(`/api/points-colombia/invoices/${id}/accrue`, {
      method: 'POST',
      body: JSON.stringify({ documentNumber, documentType }),
    }),
};
