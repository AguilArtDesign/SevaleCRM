import { apiUrl } from '../config/api-url';

export type NotificationStatus = 'unread' | 'read';

export type NotificationRecord = {
  id: number;
  type: string;
  title: string;
  message: string;
  productId: number | null;
  product: {
    sku: string;
    productName: string;
    imageUrl: string | null;
    store: 'PALI' | 'SERATUS';
  } | null;
  createdAt: string;
  readAt: string | null;
};

export type NotificationsResponse = {
  data: NotificationRecord[];
  unreadCount: number;
  pagination: { page: number; pageSize: number; total: number; totalPages: number };
};

type ApiErrorBody = { message?: string; error?: { message?: string } };

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiUrl}${path}`, {
    ...init,
    credentials: 'include',
    headers: { ...(init?.body ? { 'content-type': 'application/json' } : {}), ...init?.headers },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as ApiErrorBody;
    throw new Error(body.error?.message || body.message || 'No pudimos cargar las notificaciones.');
  }
  return response.json() as Promise<T>;
}

export const notificationsApi = {
  list: (status: NotificationStatus) =>
    request<NotificationsResponse>(
      `/api/notifications?${new URLSearchParams({ status, page: '1', pageSize: '30' })}`,
    ),
  markRead: (id: number) =>
    request<{ success: true; notificationId: number; readAt: string }>(
      `/api/notifications/${id}/read`,
      { method: 'PATCH' },
    ),
  markAllRead: () =>
    request<{ success: true; updated: number }>('/api/notifications/read-all', {
      method: 'PATCH',
    }),
};
