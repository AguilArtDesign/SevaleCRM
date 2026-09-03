import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Button, Popover, Skeleton } from '@heroui/react';
import { Bell, Check, CheckDouble } from '@gravity-ui/icons';
import { notificationsApi, type NotificationStatus } from './api';

const relativeTime = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

function notificationTime(value: string): string {
  const difference = new Date(value).getTime() - Date.now();
  const minutes = Math.round(difference / 60_000);
  if (Math.abs(minutes) < 60) return relativeTime.format(minutes, 'minute');
  const hours = Math.round(difference / 3_600_000);
  if (Math.abs(hours) < 24) return relativeTime.format(hours, 'hour');
  const days = Math.round(difference / 86_400_000);
  if (Math.abs(days) < 7) return relativeTime.format(days, 'day');
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(value));
}

export function NotificationCenter() {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<NotificationStatus>('unread');
  const notificationsQuery = useQuery({
    queryKey: ['notifications', status],
    queryFn: () => notificationsApi.list(status),
  });
  const refresh = async () => {
    await queryClient.invalidateQueries({ queryKey: ['notifications'] });
  };
  const markRead = useMutation({ mutationFn: notificationsApi.markRead, onSuccess: refresh });
  const markAllRead = useMutation({ mutationFn: notificationsApi.markAllRead, onSuccess: refresh });
  const unreadCount = notificationsQuery.data?.unreadCount ?? 0;

  return (
    <Popover>
      <Popover.Trigger
        className="notification-trigger"
        aria-label={
          unreadCount > 0 ? `Abrir notificaciones, ${unreadCount} sin leer` : 'Abrir notificaciones'
        }
      >
        <Bell width={20} height={20} />
        {unreadCount > 0 && (
          <span className="notification-badge" aria-hidden="true">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </Popover.Trigger>
      <Popover.Content placement="bottom end" className="shell-popover notification-popover">
        <Popover.Dialog>
          <div className="notification-heading">
            <div>
              <strong>Notificaciones</strong>
              <span>{unreadCount} sin leer</span>
            </div>
            <Button
              size="sm"
              variant="ghost"
              isPending={markAllRead.isPending}
              isDisabled={unreadCount === 0}
              onPress={() => markAllRead.mutate()}
            >
              <CheckDouble width={16} height={16} />
              Marcar todas
            </Button>
          </div>

          <div className="notification-tabs" role="group" aria-label="Filtrar notificaciones">
            <Button
              size="sm"
              variant={status === 'unread' ? 'primary' : 'ghost'}
              aria-pressed={status === 'unread'}
              onPress={() => setStatus('unread')}
            >
              No leídas
            </Button>
            <Button
              size="sm"
              variant={status === 'read' ? 'primary' : 'ghost'}
              aria-pressed={status === 'read'}
              onPress={() => setStatus('read')}
            >
              Leídas
            </Button>
          </div>

          <div className="notification-list" aria-live="polite">
            {notificationsQuery.isPending ? (
              Array.from({ length: 4 }, (_, index) => (
                <div className="notification-skeleton" key={index}>
                  <Skeleton />
                  <Skeleton />
                </div>
              ))
            ) : notificationsQuery.isError ? (
              <div className="notification-empty">
                <strong>No pudimos cargar las notificaciones</strong>
                <span>{notificationsQuery.error.message}</span>
              </div>
            ) : notificationsQuery.data.data.length === 0 ? (
              <div className="notification-empty">
                <span className="notification-empty-icon" aria-hidden="true">
                  <Bell width={20} height={20} />
                </span>
                <strong>
                  {status === 'unread' ? 'Todo está al día' : 'Sin notificaciones leídas'}
                </strong>
                <span>
                  {status === 'unread'
                    ? 'Las novedades del inventario aparecerán aquí.'
                    : 'Las notificaciones que marques como leídas aparecerán aquí.'}
                </span>
              </div>
            ) : (
              notificationsQuery.data.data.map((notification) => (
                <article
                  className={`notification-item${notification.readAt ? '' : ' notification-item-unread'}`}
                  key={notification.id}
                >
                  <span className="notification-dot" aria-hidden="true" />
                  <div>
                    <strong>{notification.title}</strong>
                    <p>{notification.message}</p>
                    <time dateTime={notification.createdAt}>
                      {notificationTime(notification.createdAt)}
                    </time>
                  </div>
                  {!notification.readAt && (
                    <Button
                      isIconOnly
                      size="sm"
                      variant="ghost"
                      aria-label={`Marcar como leída: ${notification.title}`}
                      isDisabled={markRead.isPending}
                      onPress={() => markRead.mutate(notification.id)}
                    >
                      <Check width={16} height={16} />
                    </Button>
                  )}
                </article>
              ))
            )}
          </div>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
