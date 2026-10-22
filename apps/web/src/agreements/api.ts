import type {
  AgreementTaskStatusInput,
  CreateAgreementCommentInput,
  CreateAgreementInput,
  CreateAgreementTaskInput,
  UpdateAgreementInput,
  UpdateAgreementTaskInput,
} from '@sevale/validation';
import { apiUrl } from '../config/api-url';

export type AgreementTaskStatus = AgreementTaskStatusInput;

export type AgreementAuthor = { id: string; name: string; email: string };

export type AgreementRecord = {
  id: number;
  companyName: string;
  nit: string | null;
  /** Código ISO del país (`CO`, `MX`…). */
  country: string;
  /** Nombre del país resuelto por la API contra el catálogo de Clientes. */
  countryName: string | null;
  /** Código del departamento (`CO-ANT`); el nombre lo resuelve la API al leer. */
  region: string | null;
  regionName: string | null;
  /** Código de la ciudad (`05001`), solo en países con catálogo. */
  cityCode: string | null;
  /**
   * Nombre de la ciudad resuelto por la API. Fuera de Colombia es el texto libre que se guardó, así
   * que el formulario lo usa tal cual al editar.
   */
  cityName: string | null;
  postalCode: string | null;
  addressLine1: string | null;
  addressLine2: string | null;
  contactName: string | null;
  contactPosition: string | null;
  contactEmail: string | null;
  contactPhone: string | null;
  /** Fecha de vigencia del contrato (`YYYY-MM-DD`); null si no se pactó o no se conoce. */
  validUntil: string | null;
  /** URL pública del logo en R2; null si el convenio no tiene logo. */
  logoUrl: string | null;
  description: string | null;
  active: boolean;
  /** Tareas por estado. Se cuentan en la API, no se guardan en la tabla. */
  pendingTasks: number;
  completedTasks: number;
  cancelledTasks: number;
  commentsCount: number;
  createdBy: AgreementAuthor | null;
  createdAt: string;
  updatedAt: string;
};

export type AgreementCommentRecord = {
  id: number;
  agreementId: number;
  comment: string;
  /** null cuando el autor fue eliminado; el historial se conserva. */
  author: AgreementAuthor | null;
  createdAt: string;
  updatedAt: string;
};

export type AgreementTaskRecord = {
  id: number;
  agreementId: number;
  title: string;
  description: string | null;
  scheduledAt: string;
  status: AgreementTaskStatus;
  completedAt: string | null;
  assignedUser: AgreementAuthor | null;
  createdBy: AgreementAuthor | null;
  createdAt: string;
  updatedAt: string;
};

export type Pagination = { page: number; pageSize: number; total: number; totalPages: number };

export type AgreementListResponse = { data: AgreementRecord[]; pagination: Pagination };
export type AgreementCommentsResponse = {
  data: AgreementCommentRecord[];
  pagination: Pagination;
};
export type AgreementTasksResponse = { data: AgreementTaskRecord[]; pagination: Pagination };

export type AgreementActiveFilter = 'all' | 'active' | 'inactive';
export type AgreementSort = 'companyName' | 'nit' | 'createdAt' | 'updatedAt';

export type AgreementListInput = {
  search: string;
  active: AgreementActiveFilter;
  region?: string;
  cityCode?: string;
  page: number;
  pageSize: number;
  /** El panel no ofrece ordenar: se listan los más recientes primero. */
  sort?: AgreementSort;
  order?: 'asc' | 'desc';
};

type ApiErrorBody = { message?: string; error?: { code?: string; message?: string } };

/** El panel muestra el código de la API para distinguir un NIT repetido de un error genérico. */
export class AgreementRequestError extends Error {
  readonly code: string | null;

  constructor(message: string, code: string | null) {
    super(message);
    this.name = 'AgreementRequestError';
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
    throw new AgreementRequestError(
      body.error?.message || body.message || 'No pudimos completar la solicitud.',
      body.error?.code ?? null,
    );
  }
  return response.json() as Promise<T>;
}

export const agreementsApi = {
  list: (input: AgreementListInput) => {
    const query = new URLSearchParams({
      search: input.search,
      active: input.active,
      page: String(input.page),
      pageSize: String(input.pageSize),
      sort: input.sort ?? 'createdAt',
      order: input.order ?? 'desc',
    });
    if (input.region) query.set('region', input.region);
    if (input.cityCode) query.set('cityCode', input.cityCode);
    return request<AgreementListResponse>(`/api/agreements?${query}`);
  },
  detail: (id: number) => request<AgreementRecord>(`/api/agreements/${id}`),
  create: (input: CreateAgreementInput) =>
    request<AgreementRecord>('/api/agreements', {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  update: (id: number, input: UpdateAgreementInput) =>
    request<AgreementRecord>(`/api/agreements/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  logoStatus: () => request<{ enabled: boolean; maxBytes: number }>('/api/agreements/logo/status'),
  uploadLogo: (contentType: string, data: string) =>
    request<{ url: string; key: string }>('/api/agreements/logo', {
      method: 'POST',
      body: JSON.stringify({ contentType, data }),
    }),
  /** Borra una subida que no llegó a guardarse; el backend rechaza los logos en uso. */
  discardLogo: (url: string) =>
    request<{ success: true }>('/api/agreements/logo', {
      method: 'DELETE',
      body: JSON.stringify({ url }),
    }),
  comments: (agreementId: number, page = 1, pageSize = 50) =>
    request<AgreementCommentsResponse>(
      `/api/agreements/${agreementId}/comments?page=${page}&pageSize=${pageSize}`,
    ),
  addComment: (agreementId: number, input: CreateAgreementCommentInput) =>
    request<AgreementCommentRecord>(`/api/agreements/${agreementId}/comments`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  tasks: (agreementId: number, status?: AgreementTaskStatus, page = 1, pageSize = 50) => {
    const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
    if (status) query.set('status', status);
    return request<AgreementTasksResponse>(`/api/agreements/${agreementId}/tasks?${query}`);
  },
  addTask: (agreementId: number, input: CreateAgreementTaskInput) =>
    request<AgreementTaskRecord>(`/api/agreements/${agreementId}/tasks`, {
      method: 'POST',
      body: JSON.stringify(input),
    }),
  updateTask: (agreementId: number, taskId: number, input: UpdateAgreementTaskInput) =>
    request<AgreementTaskRecord>(`/api/agreements/${agreementId}/tasks/${taskId}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  /** Completar, cancelar o reabrir: el estado no se edita a mano. */
  setTaskStatus: (agreementId: number, taskId: number, action: 'complete' | 'cancel' | 'reopen') =>
    request<AgreementTaskRecord>(`/api/agreements/${agreementId}/tasks/${taskId}/${action}`, {
      method: 'POST',
    }),
  /** Usuarios a los que se puede asignar una tarea; el comercial no puede listar Usuarios. */
  assignees: () =>
    request<Array<{ id: string; name: string; email: string }>>('/api/agreements/assignees'),
};
