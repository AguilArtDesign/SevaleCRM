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
    let orderRefreshTimer: number | undefined;
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
    const refreshOrders = () => {
      if (orderRefreshTimer !== undefined) window.clearTimeout(orderRefreshTimer);
      orderRefreshTimer = window.setTimeout(() => {
        orderRefreshTimer = undefined;
        void queryClient.invalidateQueries({ queryKey: ['orders'] });
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
    socket.on('order.operation.created', refreshOrders);
    socket.on('order.operation.updated', refreshOrders);
    socket.on('order.sync.updated', refreshOrders);
    socket.on('order.shipment.updated', refreshOrders);
    socket.on('order.siigo-quotation.updated', refreshOrders);
    socket.on('notification.created', refreshNotifications);

    return () => {
      if (productRefreshTimer !== undefined) window.clearTimeout(productRefreshTimer);
      if (customerRefreshTimer !== undefined) window.clearTimeout(customerRefreshTimer);
      if (orderRefreshTimer !== undefined) window.clearTimeout(orderRefreshTimer);
      socket.disconnect();
    };
  }, [queryClient]);
}
