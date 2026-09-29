import { apiUrl } from '../config/api-url';

export type UserRole = 'ADMIN' | 'COMMERCIAL' | 'LOGISTICS';

export type UserRecord = {
  id: string;
  name: string;
  email: string;
  sellerId: number | null;
  role: UserRole;
  active: boolean;
  createdAt: string;
  lastLoginAt: string | null;
};

export type CurrentUser = Pick<UserRecord, 'id' | 'name' | 'email' | 'role'>;

export type UserListResponse = {
  data: UserRecord[];
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

export type UserListInput = {
  search: string;
  role: UserRole | '';
  page: number;
  pageSize: number;
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

export const usersApi = {
  current: () => apiRequest<CurrentUser>('/api/me'),
  list: (input: UserListInput) => {
    const query = new URLSearchParams({
      search: input.search,
      page: String(input.page),
      pageSize: String(input.pageSize),
    });
    if (input.role) query.set('role', input.role);
    return apiRequest<UserListResponse>(`/api/users?${query}`);
  },
  create: (input: {
    name: string;
    email: string;
    sellerId: number;
    role: UserRole;
    active: boolean;
  }) => apiRequest<UserRecord>('/api/users', { method: 'POST', body: JSON.stringify(input) }),
  update: (
    id: string,
    input: { name?: string; sellerId?: number; role?: UserRole; active?: boolean },
  ) =>
    apiRequest<UserRecord>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
  remove: (id: string) => apiRequest<UserRecord>(`/api/users/${id}`, { method: 'DELETE' }),
};
