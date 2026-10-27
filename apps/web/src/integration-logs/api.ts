import { apiUrl } from '../config/api-url';

export type LogOutcome = 'SUCCESS' | 'ERROR';

export type LogRecord = {
  id: number;
  integration: string;
  operation: string;
  outcome: LogOutcome;
  method: string | null;
  url: string | null;
  statusCode: number | null;
  code: string | null;
  message: string | null;
  durationMs: number | null;
  referenceType: string | null;
  referenceId: string | null;
  createdAt: string;
  user: { id: string; name: string } | null;
};

export type LogDetailRecord = Omit<LogRecord, 'user'> & {
  requestBody: string | null;
  responseBody: string | null;
  user: { id: string; name: string; email: string } | null;
};

export type LogListInput = {
  integration: string;
  outcome: LogOutcome | '';
  code?: string;
  search: string;
  page: number;
  pageSize: number;
};

export type LogListResponse = {
  data: LogRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type LogFacets = { integrations: string[]; codes: string[] };

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

export const logsApi = {
  list: (input: LogListInput) => {
    const query = new URLSearchParams({
      page: String(input.page),
      pageSize: String(input.pageSize),
      search: input.search,
    });
    if (input.integration) query.set('integration', input.integration);
    if (input.outcome) query.set('outcome', input.outcome);
    if (input.code) query.set('code', input.code);
    return request<LogListResponse>(`/api/logs?${query.toString()}`);
  },
  facets: () => request<LogFacets>('/api/logs/facets'),
  detail: (id: number) => request<LogDetailRecord>(`/api/logs/${id}`),
  clear: () => request<{ success: boolean; deleted: number }>('/api/logs', { method: 'DELETE' }),
};
