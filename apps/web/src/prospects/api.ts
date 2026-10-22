import type {
  CreateProspectInput,
  CreateTagInput,
  ProspectSourceInput,
  ProspectStatusInput,
  UpdateProspectInput,
  UpdateTagInput,
} from '@sevale/validation';
import type { CreateCustomerInput } from '@sevale/validation';
import { apiUrl } from '../config/api-url';

export type ProspectStatus = ProspectStatusInput;
export type ProspectSource = ProspectSourceInput;

export type ProspectUser = { id: string; name: string; email: string };

export type ProspectAgreement = { id: number; companyName: string; active: boolean };

export type TagRecord = {
  id: number;
  name: string;
  /** Hex `#RRGGBB`; nulo en las etiquetas creadas antes de existir el campo. */
  color: string | null;
  active: boolean;
  /** Prospectos que usan la etiqueta; lo calcula la API al listar el catálogo. */
  _count?: { prospects: number };
};

export type ProspectRecord = {
  id: number;
  personType: 'PERSON' | 'COMPANY' | null;
  firstName: string | null;
  lastName: string | null;
  displayName: string;
  company: string | null;
  documentType: string | null;
  documentNumber: string | null;
  checkDigit: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  /** Código del departamento (`CO-ANT`); el nombre lo resuelve la API al leer. */
  region: string | null;
  /** Código de la ciudad (`05001`) en Colombia; nulo en el exterior. */
  cityCode: string | null;
  /** Ciudad libre en el exterior; nulo en Colombia. */
  cityName: string | null;
  postalCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  source: ProspectSource;
  status: ProspectStatus;
  agreement: ProspectAgreement | null;
  assignedUser: ProspectUser | null;
  createdBy: ProspectUser | null;
  convertedCustomer: { id: number; displayName: string; documentNumber: string | null } | null;
  convertedAt: string | null;
  tags: TagRecord[];
  /** Lo calcula la API con la misma lista de requisitos que exige Clientes. */
  completeness: { complete: boolean; missing: string[] };
  location: {
    countryName: string | null;
    regionName: string | null;
    cityName: string | null;
  };
  createdAt: string;
  updatedAt: string;
};

export type Pagination = { page: number; pageSize: number; total: number; totalPages: number };

export type ProspectImportIssue = { row: number; field: string; message: string };

export type ProspectImportPreview = {
  totalRows: number;
  validRows: number;
  newProspects: number;
  duplicates: number;
  errorCount: number;
  errors: ProspectImportIssue[];
  canImport: boolean;
};

export type ProspectImportResult = {
  success: true;
  totalRows: number;
  imported: number;
  duplicates: number;
};

export type ProspectListResponse = { data: ProspectRecord[]; pagination: Pagination };

/** `all` excluye los convertidos: son historial y no trabajo diario. */
export type ProspectStatusFilter = ProspectStatus | 'all';
export type ProspectSort = 'displayName' | 'createdAt' | 'updatedAt' | 'status';

export type ProspectListInput = {
  search: string;
  status: ProspectStatusFilter;
  source?: ProspectSource;
  assignedUserId?: string;
  unassigned?: boolean;
  agreementId?: number;
  tagId?: number;
  page: number;
  pageSize: number;
  sort: ProspectSort;
  order: 'asc' | 'desc';
};

export type ProspectConvertResponse = {
  prospect: ProspectRecord;
  customer: { id: number; displayName: string };
};

type ApiErrorBody = { message?: string; error?: { code?: string; message?: string } };

/** El panel necesita el código para distinguir «ya convertido» de un error genérico. */
export class ProspectRequestError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null) {
    super(message);
    this.name = 'ProspectRequestError';
    this.code = code;
  }
}

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
    throw new ProspectRequestError(
      body.error?.message || body.message || 'No pudimos completar la solicitud.',
      body.error?.code ?? null,
    );
  }
  return response.json() as Promise<T>;
}

export const prospectsApi = {
  list: (input: ProspectListInput) => {
    const query = new URLSearchParams({
      search: input.search,
      status: input.status,
      page: String(input.page),
      pageSize: String(input.pageSize),
      sort: input.sort,
      order: input.order,
    });
    if (input.source) query.set('source', input.source);
    if (input.assignedUserId) query.set('assignedUserId', input.assignedUserId);
    if (input.unassigned) query.set('unassigned', 'true');
    if (input.agreementId) query.set('agreementId', String(input.agreementId));
    if (input.tagId) query.set('tagId', String(input.tagId));
    return request<ProspectListResponse>(`/api/prospects?${query}`);
  },
  detail: (id: number) => request<ProspectRecord>(`/api/prospects/${id}`),
  create: (input: CreateProspectInput) =>
    request<ProspectRecord>('/api/prospects', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: number, input: UpdateProspectInput) =>
    request<ProspectRecord>(`/api/prospects/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: number) => request<ProspectRecord>(`/api/prospects/${id}`, { method: 'DELETE' }),
  /** El cuerpo es el mismo que `POST /customers`: no hay un contrato paralelo. */
  convert: (id: number, input: CreateCustomerInput) =>
    request<ProspectConvertResponse>(`/api/prospects/${id}/convert`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  convertLink: (id: number, customerId: number) =>
    request<ProspectConvertResponse>(`/api/prospects/${id}/convert/link`, {
      method: 'POST',
      body: JSON.stringify({ customerId }),
    }),
  /** Usuarios asignables; el comercial no puede listar el panel de Usuarios. */
  assignees: () => request<ProspectUser[]>('/api/prospects/assignees'),
  importStatus: () =>
    request<{ enabled: boolean; template: string }>('/api/prospects/import/status'),
  previewImport: (csv: string) =>
    request<ProspectImportPreview>('/api/prospects/import/preview', {
      method: 'POST',
      body: JSON.stringify({ csv }),
    }),
  importProspects: (csv: string) =>
    request<ProspectImportResult>('/api/prospects/import', {
      method: 'POST',
      body: JSON.stringify({ csv }),
    }),
  tags: () => request<TagRecord[]>('/api/tags'),
  createTag: (input: CreateTagInput) =>
    request<TagRecord>('/api/tags', { method: 'POST', body: JSON.stringify(input) }),
  updateTag: (id: number, input: UpdateTagInput) =>
    request<TagRecord>(`/api/tags/${id}`, { method: 'PATCH', body: JSON.stringify(input) }),
};

/** Convenios activos para el selector; el formulario conserva uno inactivo ya vinculado. */
export function fetchActiveAgreements() {
  return request<{ data: ProspectAgreement[] }>(
    '/api/agreements?active=active&pageSize=100&sort=companyName&order=asc',
  ).then((response) =>
    response.data.map(({ id, companyName, active }) => ({ id, companyName, active })),
  );
}
