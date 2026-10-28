import type {
  CreateCustomerInput,
  CustomerSiigoLocationInput,
  CustomerSyncStatusFilter,
  UpdateCustomerInput,
} from '@sevale/validation';
import { apiUrl } from '../config/api-url';

export type CustomerIntegration = {
  id: number;
  provider: 'SIIGO' | 'SERATUS' | 'PALI';
  externalId: string | null;
  externalData: unknown;
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
  /** Convenio vinculado, ya resuelto por la API. `null` cuando el cliente no pertenece a ninguno. */
  agreement: { id: number; companyName: string } | null;
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

/** Cada campo que cambió en una edición, con el valor guardado antes y después. */
export type CustomerEventChange = { field: string; from: unknown; to: unknown };

export type CustomerEventRecord = {
  id: number;
  customerId: number | null;
  action: 'CREATED' | 'UPDATED' | 'SYNCED' | 'DELETED';
  /** `BACKFILL` marca las filas reconstruidas para clientes que ya existían; no las creó el panel. */
  origin: 'LIVE' | 'BACKFILL';
  actor: { id: string; name: string; email: string } | null;
  customerName: string | null;
  customerDocument: string | null;
  changes: CustomerEventChange[];
  provider: CustomerIntegration['provider'] | null;
  outcome: 'SYNCED' | 'ERROR' | null;
  message: string | null;
  createdAt: string;
};

export type CustomerActivityResponse = {
  data: CustomerEventRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type SiigoCustomerDraft = Omit<CreateCustomerInput, 'documentType'> & {
  documentType: CreateCustomerInput['documentType'] | null;
  active: boolean;
};

export type CustomerSourceLookup = {
  provider: CustomerIntegration['provider'];
  status: 'FOUND' | 'NOT_FOUND' | 'AMBIGUOUS' | 'ERROR';
  externalId: string | null;
  // Cuántos clientes coincidieron: 1 al encontrar y N cuando la tienda tiene duplicados.
  candidates: number;
};

export type CustomerDraftAddress = Pick<
  CreateCustomerInput,
  'country' | 'region' | 'cityCode' | 'cityName' | 'postalCode' | 'addressLine1' | 'addressLine2'
>;
export type CustomerDraftName = Pick<CreateCustomerInput, 'firstName' | 'lastName' | 'displayName'>;

type CustomerDraftConflictOption<T> = {
  value: T;
  sources: CustomerIntegration['provider'][];
};

export type CustomerDraftConflicts = {
  name?: { options: Array<CustomerDraftConflictOption<CustomerDraftName>> };
  email?: { options: Array<CustomerDraftConflictOption<string>> };
  phone?: { options: Array<CustomerDraftConflictOption<string>> };
  address?: { options: Array<CustomerDraftConflictOption<CustomerDraftAddress>> };
};

export type CustomerResolveResponse =
  | { existsLocally: true; identification: string; customerId: number }
  | {
      existsLocally: false;
      found: boolean;
      identification: string;
      customer: SiigoCustomerDraft | null;
      integrations: CustomerSourceLookup[];
      conflicts: CustomerDraftConflicts;
      // Tipo que reporta Siigo, para avisar cuando difiere del elegido en el panel.
      documentTypeFromSiigo: string | null;
      // Dirección resuelta con su ubicación, para mostrar de dónde viene lo autocompletado.
      resolvedAddress: CustomerDraftAddress | null;
    };

type CustomerListInput = {
  search: string;
  country: string;
  /** `all` no filtra; el resto se resuelve en el backend sobre las tres integraciones. */
  status?: CustomerSyncStatusFilter;
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

/** Igual que en Inventario: el nombre del archivo lo decide la API con `content-disposition`. */
async function download(path: string, init: RequestInit) {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error?.message || body.message || 'No pudimos exportar los clientes.');
  }
  const disposition = response.headers.get('content-disposition') || '';
  const filename = disposition.match(/filename="?([^";]+)"?/i)?.[1] || 'clientes.xlsx';
  return { blob: await response.blob(), filename };
}

export const customersApi = {
  list: (input: CustomerListInput) => {
    const query = new URLSearchParams({
      search: input.search,
      status: input.status ?? 'all',
      page: String(input.page),
      pageSize: String(input.pageSize),
      sort: input.sort,
      order: input.order,
    });
    if (input.country) query.set('country', input.country);
    return apiRequest<CustomerListResponse>(`/api/customers?${query}`);
  },
  detail: (id: number) => apiRequest<CustomerRecord>(`/api/customers/${id}`),
  activity: (id: number, page = 1, pageSize = 50) =>
    apiRequest<CustomerActivityResponse>(
      `/api/customers/${id}/activity?${new URLSearchParams({
        page: String(page),
        pageSize: String(pageSize),
      })}`,
    ),
  exportCustomers: (ids: number[]) =>
    download('/api/customers/export', { method: 'POST', body: JSON.stringify({ ids }) }),
  resolve: (identification: string, documentType: string) =>
    apiRequest<CustomerResolveResponse>(
      `/api/customers/resolve?${new URLSearchParams({ identification, documentType })}`,
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
  sync: (
    id: number,
    provider: CustomerIntegration['provider'],
    siigoLocation?: CustomerSiigoLocationInput,
  ) =>
    apiRequest<CustomerRecord>(`/api/customers/${id}/sync`, {
      method: 'POST',
      body: JSON.stringify({ provider, ...(siigoLocation ? { siigoLocation } : {}) }),
    }),
};
