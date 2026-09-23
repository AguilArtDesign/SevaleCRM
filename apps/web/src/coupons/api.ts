import type { CreateCouponInput, UpdateCouponInput } from '@sevale/validation';
import { apiUrl } from '../config/api-url';

export type CouponSyncAction = 'CREATED' | 'UPDATED' | 'DELETED' | 'MISSING' | 'SKIPPED' | 'FAILED';

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
  // Veces que el cupón se aplicó en operaciones del CRM; el panel lo muestra junto a su límite.
  usageCount: number;
  // Diagnóstico del último intento. La API solo lo entrega a un administrador: para el resto de
  // los roles estos campos llegan siempre en null.
  lastSyncAt: string | null;
  seratusLastErrorCode: string | null;
  seratusLastErrorMessage: string | null;
  paliLastErrorCode: string | null;
  paliLastErrorMessage: string | null;
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
  syncStatus?: CouponSyncStatus | '';
};

type ApiErrorBody = {
  message?: string;
  error?: { code?: string; message?: string; details?: unknown };
};

// El error conserva el código y el detalle por tienda que envía la API: sin ellos el panel no puede
// explicar por qué falló una sincronización ni por qué la eliminación quedó incompleta.
export class CouponRequestError extends Error {
  readonly code: string | null;
  readonly outcomes: CouponSyncOutcome[] | null;

  constructor(message: string, code: string | null, outcomes: CouponSyncOutcome[] | null) {
    super(message);
    this.name = 'CouponRequestError';
    this.code = code;
    this.outcomes = outcomes;
  }
}

function outcomeList(value: unknown): CouponSyncOutcome[] | null {
  if (!Array.isArray(value)) return null;
  const outcomes = value.filter(
    (item): item is CouponSyncOutcome =>
      Boolean(item) &&
      typeof item === 'object' &&
      typeof (item as { store?: unknown }).store === 'string',
  );
  return outcomes.length > 0 ? outcomes : null;
}

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
    throw new CouponRequestError(
      body.error?.message || body.message || 'No pudimos completar la solicitud.',
      body.error?.code ?? null,
      outcomeList(body.error?.details),
    );
  }
  return response.json() as Promise<T>;
}

export const couponsApi = {
  list: ({ search, page, pageSize = 20, syncStatus = '' }: CouponListInput) => {
    const query = new URLSearchParams({
      search,
      page: String(page),
      pageSize: String(pageSize),
      sort: 'createdAt',
      order: 'desc',
    });
    // El valor vacío significa «todos los estados», así que el parámetro no se envía.
    if (syncStatus) query.set('syncStatus', syncStatus);
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
