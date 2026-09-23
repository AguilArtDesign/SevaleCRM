import type { CreateCouponInput, UpdateCouponInput } from '@sevale/validation';
import { apiUrl } from '../config/api-url';

export type CouponRecord = {
  id: number;
  coupon: string;
  description: string | null;
  type: string;
  amount: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CouponListResponse = {
  data: CouponRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

type CouponListInput = {
  search: string;
  active?: boolean;
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
  list: ({ search, active, page, pageSize = 20 }: CouponListInput) => {
    const query = new URLSearchParams({
      search,
      page: String(page),
      pageSize: String(pageSize),
      sort: 'createdAt',
      order: 'desc',
    });
    if (active !== undefined) query.set('active', String(active));
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
  remove: (id: number) => apiRequest<CouponRecord>(`/api/coupons/${id}`, { method: 'DELETE' }),
};
