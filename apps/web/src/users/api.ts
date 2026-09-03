import { apiUrl } from '../config/api-url';

export type UserRole = 'ADMIN' | 'COMMERCIAL' | 'LOGISTICS';

export type UserRecord = {
  id: string;
  name: string;
  email: string;
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

type ApiErrorBody = { message?: string; error?: { message?: string } };

async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: { 'content-type': 'application/json', ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error?.message || body.message || 'No pudimos completar la solicitud.');
  }
  return response.json() as Promise<T>;
}

export const usersApi = {
  current: () => apiRequest<CurrentUser>('/api/me'),
  list: (search: string, page: number) =>
    apiRequest<UserListResponse>(
      `/api/users?search=${encodeURIComponent(search)}&page=${page}&pageSize=20`,
    ),
  create: (input: { name: string; email: string; role: UserRole; active: boolean }) =>
    apiRequest<UserRecord>('/api/users', { method: 'POST', body: JSON.stringify(input) }),
  update: (id: string, input: { name?: string; role?: UserRole; active?: boolean }) =>
    apiRequest<UserRecord>(`/api/users/${id}`, {
      method: 'PATCH',
      body: JSON.stringify(input),
    }),
};
