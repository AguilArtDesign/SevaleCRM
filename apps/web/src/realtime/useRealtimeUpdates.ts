import { useEffect } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { io } from 'socket.io-client';
import { Toast } from '@heroui/react';
import { apiUrl } from '../config/api-url';

export function useRealtimeUpdates() {
  const queryClient = useQueryClient();

  useEffect(() => {
    const socket = io(apiUrl, { withCredentials: true });
    let productRefreshTimer: number | undefined;
    const refreshProducts = () => {
      if (productRefreshTimer !== undefined) window.clearTimeout(productRefreshTimer);
      productRefreshTimer = window.setTimeout(() => {
        productRefreshTimer = undefined;
        void queryClient.invalidateQueries({ queryKey: ['products'] });
      }, 500);
    };
    const refreshNotifications = (notification: { title: string; message: string }) => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      Toast.toast.info(notification.title, {
        description: notification.message,
        timeout: 6_000,
      });
    };

    socket.on('product.created', refreshProducts);
    socket.on('product.updated', refreshProducts);
    socket.on('product.deleted', refreshProducts);
    socket.on('products.updated', refreshProducts);
    socket.on('notification.created', refreshNotifications);

    return () => {
      if (productRefreshTimer !== undefined) window.clearTimeout(productRefreshTimer);
      socket.disconnect();
    };
  }, [queryClient]);
}
