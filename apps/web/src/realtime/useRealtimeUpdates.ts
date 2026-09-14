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
    let customerRefreshTimer: number | undefined;
    const refreshProducts = () => {
      if (productRefreshTimer !== undefined) window.clearTimeout(productRefreshTimer);
      productRefreshTimer = window.setTimeout(() => {
        productRefreshTimer = undefined;
        void queryClient.invalidateQueries({ queryKey: ['products'] });
      }, 500);
    };
    const refreshCustomers = () => {
      if (customerRefreshTimer !== undefined) window.clearTimeout(customerRefreshTimer);
      customerRefreshTimer = window.setTimeout(() => {
        customerRefreshTimer = undefined;
        void queryClient.invalidateQueries({ queryKey: ['customers'] });
      }, 300);
    };
    const refreshNotifications = (notification: {
      type: string;
      title: string;
      message: string;
    }) => {
      void queryClient.invalidateQueries({ queryKey: ['notifications'] });
      // Las acciones de Clientes ya presentan un toast contextual en el formulario o reintento.
      // El evento realtime actualiza el centro sin duplicar ese mensaje visual.
      if (notification.type.startsWith('CUSTOMER_')) return;
      Toast.toast.info(notification.title, {
        description: notification.message,
        timeout: 6_000,
      });
    };

    socket.on('product.created', refreshProducts);
    socket.on('product.updated', refreshProducts);
    socket.on('product.deleted', refreshProducts);
    socket.on('products.updated', refreshProducts);
    socket.on('customer.created', refreshCustomers);
    socket.on('customer.updated', refreshCustomers);
    socket.on('customer.deleted', refreshCustomers);
    socket.on('customer.integration.updated', refreshCustomers);
    socket.on('notification.created', refreshNotifications);

    return () => {
      if (productRefreshTimer !== undefined) window.clearTimeout(productRefreshTimer);
      if (customerRefreshTimer !== undefined) window.clearTimeout(customerRefreshTimer);
      socket.disconnect();
    };
  }, [queryClient]);
}
