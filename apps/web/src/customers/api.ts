import type { CreateCustomerInput, UpdateCustomerInput } from '@sevale/validation';
import { apiUrl } from '../config/api-url';

export type CustomerIntegration = {
  id: number;
  provider: 'SIIGO' | 'SERATUS' | 'PALI';
  externalId: string | null;
  externalData: WooCustomerData | null;
  status: 'PENDING' | 'SYNCED' | 'ERROR';
  lastAttemptAt: string | null;
  lastSyncedAt: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
};

export type WooCustomerData = {
  id: number;
  email: string;
  first_name: string;
  last_name: string;
  username: string;
  billing: {
    first_name: string;
    last_name: string;
    company: string;
    address_1: string;
    address_2: string;
    city: string;
    postcode: string;
    country: string;
    state: string;
    email: string;
    phone: string;
  };
  meta_data: Array<{
    id: number | null;
    key: 'billing_type_document' | 'billing_identification';
    value: string;
  }>;
};

export type CustomerRecord = CreateCustomerInput & {
  id: number;
  active: boolean;
  createdAt: string;
  updatedAt: string;
  deletedAt: string | null;
  integrations: CustomerIntegration[];
  location: {
    countryName: string | null;
    regionName: string | null;
    cityName: string | null;
  };
};

export type CustomerListResponse = {
  data: CustomerRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type SiigoCustomerDraft = CreateCustomerInput & { active: boolean };

export type CustomerSourceLookup = {
  provider: CustomerIntegration['provider'];
  status: 'FOUND' | 'NOT_FOUND' | 'ERROR';
  externalId: string | null;
  externalData: WooCustomerData | null;
};

export type SiigoCustomerLookupResponse =
  | { exists: false; identification: string; integrations: CustomerSourceLookup[] }
  | {
      exists: true;
      identification: string;
      customer: SiigoCustomerDraft;
      integrations: CustomerSourceLookup[];
    };

type CustomerListInput = {
  search: string;
  country: string;
  page: number;
  pageSize: number;
  sort: string;
  order: 'asc' | 'desc';
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

export const customersApi = {
  list: (input: CustomerListInput) => {
    const query = new URLSearchParams({
      search: input.search,
      page: String(input.page),
      pageSize: String(input.pageSize),
      sort: input.sort,
      order: input.order,
    });
    if (input.country) query.set('country', input.country);
    return apiRequest<CustomerListResponse>(`/api/customers?${query}`);
  },
  detail: (id: number) => apiRequest<CustomerRecord>(`/api/customers/${id}`),
  lookupSiigo: (identification: string) =>
    apiRequest<SiigoCustomerLookupResponse>(
      `/api/customers/siigo-lookup?${new URLSearchParams({ identification })}`,
    ),
  create: (input: CreateCustomerInput) =>
    apiRequest<CustomerRecord>('/api/customers', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: number, input: UpdateCustomerInput) =>
    apiRequest<CustomerRecord>(`/api/customers/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  delete: (id: number) =>
    apiRequest<CustomerRecord>(`/api/customers/${id}`, {
      method: 'DELETE',
    }),
  sync: (id: number, provider: CustomerIntegration['provider']) =>
    apiRequest<CustomerRecord>(`/api/customers/${id}/sync`, {
      method: 'POST',
      body: JSON.stringify({ provider }),
    }),
};
