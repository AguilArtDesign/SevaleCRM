import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Avatar, Button, Popover, Skeleton, Tabs } from '@heroui/react';
import { Bell, Boxes3, Check, CheckDouble } from '@gravity-ui/icons';
import { Chip } from '../components/Chip';
import { customerAvatarClass, customerInitials } from '../customers/presentation';
import { notificationsApi, type NotificationRecord, type NotificationStatus } from './api';

const relativeTime = new Intl.RelativeTimeFormat('es', { numeric: 'auto' });

function notificationTime(value: string): string {
  const difference = new Date(value).getTime() - Date.now();
  const minutes = Math.round(difference / 60_000);
  if (Math.abs(minutes) < 60) return capitalize(relativeTime.format(minutes, 'minute'));
  const hours = Math.round(difference / 3_600_000);
  if (Math.abs(hours) < 24) return capitalize(relativeTime.format(hours, 'hour'));
  const days = Math.round(difference / 86_400_000);
  if (Math.abs(days) < 7) return capitalize(relativeTime.format(days, 'day'));
  return new Intl.DateTimeFormat('es-CO', { dateStyle: 'medium' }).format(new Date(value));
}

function capitalize(value: string) {
  return `${value.charAt(0).toUpperCase()}${value.slice(1)}`;
}

function notificationDescription(notification: NotificationRecord) {
  if (notification.type.startsWith('CUSTOMER_')) {
    return notification.message.split('\n')[0] || notification.customer?.displayName || '';
  }
  if (
    notification.type === 'SIIGO_PRODUCT_UPDATED' ||
    notification.type === 'PRODUCT_LINK_UPDATED'
  ) {
    return notification.message.split('\n')[0] || notification.product?.productName || '';
  }
  if (notification.type === 'PRODUCT_LINKED' && notification.product) {
    return notification.product.productName;
  }
  return notification.message;
}

function notificationChanges(notification: NotificationRecord) {
  if (notification.type !== 'PRODUCT_LINK_UPDATED') return null;
  const [, ...changes] = notification.message.split('\n');
  return changes.join('\n') || null;
}

type CustomerProvider = 'SIIGO' | 'PALI' | 'SERATUS';

const customerProviderLabels: Record<CustomerProvider, string> = {
  SIIGO: 'Siigo',
  PALI: 'Pali',
  SERATUS: 'Seratus',
};

function customerNotificationProvider(notification: NotificationRecord): CustomerProvider | null {
  const providerFromType = notification.type.match(/_(SIIGO|PALI|SERATUS)$/)?.[1] as
    CustomerProvider | undefined;
  if (providerFromType) return providerFromType;

  const details = notification.message.split('\n').slice(1).join(' ');
  return (
    (Object.keys(customerProviderLabels) as CustomerProvider[]).find((provider) =>
      details.toLocaleLowerCase('es-CO').includes(customerProviderLabels[provider].toLowerCase()),
    ) ?? null
  );
}

function customerNotificationPresentation(notification: NotificationRecord) {
  if (!notification.type.startsWith('CUSTOMER_')) return null;
  if (notification.type === 'CUSTOMER_CREATED') {
    return { title: 'Cliente creado', provider: null };
  }
  if (notification.type.includes('ERROR') || notification.type === 'CUSTOMER_SYNC_PARTIAL') {
    return {
      title: 'Error de sincronización',
      provider: customerNotificationProvider(notification),
    };
  }
  if (notification.type.includes('SYNCED') || notification.type === 'CUSTOMER_RETRY_SUCCEEDED') {
    return { title: 'Cliente sincronizado', provider: customerNotificationProvider(notification) };
  }
  return { title: notification.title, provider: null };
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

  const renderNotifications = () => (
    <div className="notification-list" aria-live="polite">
      {notificationsQuery.isPending ? (
        Array.from({ length: 5 }, (_, index) => (
          <div className="notification-skeleton" key={index}>
            <Skeleton className="notification-skeleton-image" />
            <div>
              <Skeleton />
              <Skeleton />
              <Skeleton />
            </div>
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
          <strong>{status === 'unread' ? 'Todo está al día' : 'Sin notificaciones leídas'}</strong>
          <span>
            {status === 'unread'
              ? 'Las novedades del inventario y clientes aparecerán aquí.'
              : 'Las notificaciones que marques como leídas aparecerán aquí.'}
          </span>
        </div>
      ) : (
        notificationsQuery.data.data.map((notification) => {
          const customerPresentation = customerNotificationPresentation(notification);
          return (
            <article
              className={`notification-item${notification.readAt ? '' : ' notification-item-unread'}`}
              key={notification.id}
            >
              <span className="notification-dot" aria-hidden="true" />
              {notification.customer ? (
                <Avatar
                  size="md"
                  className={`notification-customer-avatar ${customerAvatarClass(notification.customerId ?? notification.id)}`}
                  aria-hidden="true"
                >
                  <Avatar.Fallback>{customerInitials(notification.customer)}</Avatar.Fallback>
                </Avatar>
              ) : (
                <span className="notification-product-image" aria-hidden="true">
                  {notification.product?.imageUrl ? (
                    <img src={notification.product.imageUrl} alt="" />
                  ) : (
                    <Boxes3 width={20} height={20} />
                  )}
                </span>
              )}
              <div className="notification-copy">
                <div className="notification-title-row">
                  <strong>{customerPresentation?.title ?? notification.title}</strong>
                  {notification.type === 'SIIGO_PRODUCT_UPDATED' && (
                    <>
                      <Chip className="notification-siigo-chip" color="default">
                        Siigo
                      </Chip>
                      {notification.product?.store && (
                        <Chip
                          className={`inventory-store-chip-${notification.product.store.toLowerCase()}`}
                          color="default"
                        >
                          {notification.product.store === 'PALI' ? 'Pali' : 'Seratus'}
                        </Chip>
                      )}
                    </>
                  )}
                  {customerPresentation?.provider && (
                    <Chip
                      className={`notification-provider-chip--${customerPresentation.provider.toLowerCase()}`}
                      color="default"
                    >
                      {customerProviderLabels[customerPresentation.provider]}
                    </Chip>
                  )}
                </div>
                <p>{notificationDescription(notification)}</p>
                {notificationChanges(notification) && (
                  <p className="notification-changes">{notificationChanges(notification)}</p>
                )}
                <time dateTime={notification.createdAt}>
                  {notificationTime(notification.createdAt)}
                </time>
              </div>
              {!notification.readAt && (
                <Button
                  className="notification-read-button"
                  isIconOnly
                  size="sm"
                  variant="ghost"
                  aria-label={`Marcar como leída: ${customerPresentation?.title ?? notification.title}`}
                  isDisabled={markRead.isPending}
                  onPress={() => markRead.mutate(notification.id)}
                >
                  <Check width={15} height={15} />
                </Button>
              )}
            </article>
          );
        })
      )}
    </div>
  );

  return (
    <Popover>
      <Button
        className="notification-trigger"
        isIconOnly
        size="sm"
        variant="ghost"
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
      </Button>
      <Popover.Content placement="bottom end" className="shell-popover notification-popover">
        <Popover.Dialog className="notification-dialog">
          <div className="notification-heading">
            <strong>Notificaciones</strong>
            <Button
              className="notification-read-all"
              size="sm"
              variant="ghost"
              isPending={markAllRead.isPending}
              isDisabled={unreadCount === 0}
              onPress={() => markAllRead.mutate()}
            >
              <CheckDouble width={16} height={16} />
              Marcar como leídas
            </Button>
          </div>

          <Tabs
            className="notification-tabs"
            selectedKey={status}
            onSelectionChange={(key) => setStatus(String(key) as NotificationStatus)}
          >
            <Tabs.ListContainer>
              <Tabs.List aria-label="Filtrar notificaciones">
                <Tabs.Tab id="unread">
                  No leídas ({unreadCount})
                  <Tabs.Indicator />
                </Tabs.Tab>
                <Tabs.Tab id="read">
                  Leídas
                  <Tabs.Indicator />
                </Tabs.Tab>
              </Tabs.List>
            </Tabs.ListContainer>
            <Tabs.Panel className="notification-panel" id="unread">
              {status === 'unread' ? renderNotifications() : null}
            </Tabs.Panel>
            <Tabs.Panel className="notification-panel" id="read">
              {status === 'read' ? renderNotifications() : null}
            </Tabs.Panel>
          </Tabs>
        </Popover.Dialog>
      </Popover.Content>
    </Popover>
  );
}
