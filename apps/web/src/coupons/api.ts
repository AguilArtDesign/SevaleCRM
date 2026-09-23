import type { CreateCouponInput, UpdateCouponInput } from '@sevale/validation';
import { apiUrl } from '../config/api-url';

export type CouponSyncAction = 'CREATED' | 'UPDATED' | 'DELETED' | 'SKIPPED' | 'FAILED';

export type CouponSyncStatus = 'PENDING' | 'SYNCED' | 'PARTIAL' | 'ERROR';

export type CouponSyncOutcome = {
  store: 'SERATUS' | 'PALI';
  action: CouponSyncAction;
  externalId: number | null;
  errorCode: string | null;
  errorMessage: string | null;
};

export type CouponRecord = {
  id: number;
  coupon: string;
  description: string | null;
  type: string;
  amount: number;
  dateExpires: string | null;
  individualUse: boolean;
  excludeSaleItems: boolean;
  usageLimit: number | null;
  usageLimitPerUser: number | null;
  seratusCouponId: number | null;
  paliCouponId: number | null;
  syncStatus: CouponSyncStatus;
  createdAt: string;
  updatedAt: string;
};

export type CouponSyncResult = CouponRecord & { sync: CouponSyncOutcome[] };

export type CouponDeleteResult = {
  deleted: true;
  coupon: CouponRecord;
  sync: CouponSyncOutcome[];
};

export type CouponListResponse = {
  data: CouponRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

type CouponListInput = {
  search: string;
  page: number;
  pageSize?: number;
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

export const couponsApi = {
  list: ({ search, page, pageSize = 20 }: CouponListInput) => {
    const query = new URLSearchParams({
      search,
      page: String(page),
      pageSize: String(pageSize),
      sort: 'createdAt',
      order: 'desc',
    });
    return apiRequest<CouponListResponse>(`/api/coupons?${query}`);
  },
  create: (input: CreateCouponInput) =>
    apiRequest<CouponRecord>('/api/coupons', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: number, input: UpdateCouponInput) =>
    apiRequest<CouponRecord>(`/api/coupons/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  synchronize: (id: number) =>
    apiRequest<CouponSyncResult>(`/api/coupons/${id}/sync`, { method: 'POST' }),
  remove: (id: number) =>
    apiRequest<CouponDeleteResult>(`/api/coupons/${id}`, { method: 'DELETE' }),
};
