import { Injectable, NotFoundException } from '@nestjs/common';
import { rolePermissions, roles, type Permission } from '@sevale/permissions';
import type { NotificationListQuery } from '@sevale/validation';
import type { Customer, Product, SyncStatus } from '../generated/prisma/client.js';
import { RealtimeGateway, type ProductUpdateChanges } from '../realtime/realtime.gateway.js';
import { NotificationsRepository } from './notifications.repository.js';

const compactNumber = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });

const statusLabels: Record<SyncStatus, string> = {
  SYNCED: 'Sincronizado',
  PENDING: 'Pendiente',
  OUT_OF_SYNC: 'Desactualizado',
  ERROR: 'Con error',
};

type CustomerSyncResult = {
  provider: 'SIIGO' | 'SERATUS' | 'PALI';
  status: 'SYNCED' | 'ERROR';
  message: string | null;
};

const customerProviderLabels = { SIIGO: 'Siigo', SERATUS: 'Seratus', PALI: 'Pali' } as const;

function permissionsFor(role: unknown): readonly Permission[] {
  const validRole = roles.find((candidate) => candidate === role);
  return validRole ? rolePermissions[validRole] : [];
}

@Injectable()
export class NotificationsService {
  constructor(
    private readonly repository: NotificationsRepository,
    private readonly realtime: RealtimeGateway,
  ) {}

  async list(userId: string, role: unknown, query: NotificationListQuery) {
    const [notifications, total, unreadCount] = await this.repository.list(
      userId,
      query,
      permissionsFor(role),
    );
    return {
      data: notifications.map((notification) => ({
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        productId: notification.productId,
        product: notification.product,
        customerId: notification.customerId,
        customer: notification.customer,
        createdAt: notification.createdAt,
        readAt: notification.reads[0]?.readAt ?? null,
      })),
      unreadCount,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async markRead(notificationId: number, userId: string, role: unknown) {
    if (!(await this.repository.findById(notificationId, permissionsFor(role)))) {
      throw new NotFoundException({
        success: false,
        error: { code: 'NOTIFICATION_NOT_FOUND', message: 'La notificación no existe.' },
      });
    }
    const read = await this.repository.markRead(notificationId, userId);
    return { success: true, notificationId, readAt: read.readAt };
  }

  async markAllRead(userId: string, role: unknown) {
    const updated = await this.repository.markAllRead(userId, permissionsFor(role));
    return { success: true, updated };
  }

  async createProductLinked(product: Product) {
    return this.create({
      type: 'PRODUCT_LINKED',
      title: 'Producto vinculado',
      message: `${product.productName} · ${product.sku}`,
      productId: product.id,
    });
  }

  createProductLinkUpdate(product: Product, changes: ProductUpdateChanges) {
    return this.createProductUpdate('PRODUCT_LINK_UPDATED', product, changes, true);
  }

  createSiigoProductUpdate(product: Product, changes: ProductUpdateChanges, syncConfirmed = false) {
    if (!changes.stock && !changes.priceCop && !changes.priceUsd && !syncConfirmed) return null;

    return this.create({
      type: 'SIIGO_PRODUCT_UPDATED',
      title: 'Producto actualizado',
      message: product.productName,
      productId: product.id,
    });
  }

  createCustomerCreated(customer: Customer, results: CustomerSyncResult[]) {
    return this.createCustomerSummary('CUSTOMER_CREATED', 'Cliente creado', customer, results);
  }

  createCustomerLocal(customer: Customer, siigoLinked: boolean) {
    return this.create({
      type: 'CUSTOMER_CREATED',
      title: 'Cliente guardado localmente',
      message: `${customer.displayName}\n${
        siigoLinked
          ? 'Vinculado con Siigo. Seratus y Pali continúan pendientes.'
          : 'Siigo, Seratus y Pali continúan pendientes.'
      }`,
      customerId: customer.id,
      requiredPermission: 'customers.read',
    });
  }

  createCustomerUpdated(customer: Customer, results: CustomerSyncResult[]) {
    return this.createCustomerSummary('CUSTOMER_UPDATED', 'Cliente actualizado', customer, results);
  }

  createCustomerUpdatedLocal(customer: Customer) {
    return this.create({
      type: 'CUSTOMER_UPDATED',
      title: 'Cliente actualizado localmente',
      message: `${customer.displayName}\nLas integraciones continúan pendientes de sincronización.`,
      customerId: customer.id,
      requiredPermission: 'customers.read',
    });
  }

  createCustomerRetry(customer: Customer, result: CustomerSyncResult) {
    const label = customerProviderLabels[result.provider];
    return this.create({
      type: result.status === 'SYNCED' ? 'CUSTOMER_RETRY_SUCCEEDED' : 'CUSTOMER_SYNC_ERROR',
      title: result.status === 'SYNCED' ? 'Sincronización recuperada' : 'Error de sincronización',
      message:
        result.status === 'SYNCED'
          ? `${customer.displayName}\n${label} volvió a estar sincronizado.`
          : `${customer.displayName}\n${label} requiere atención.`,
      customerId: customer.id,
      requiredPermission: 'customers.read',
    });
  }

  createCustomerRetrySummary(customer: Customer, results: CustomerSyncResult[]) {
    if (results.length === 1) return this.createCustomerRetry(customer, results[0]!);
    const failed = results.filter((result) => result.status === 'ERROR');
    const labels = failed.map((result) => customerProviderLabels[result.provider]).join(', ');
    return this.create({
      type:
        failed.length === 0
          ? 'CUSTOMER_RETRY_SUCCEEDED'
          : failed.length === results.length
            ? 'CUSTOMER_SYNC_ERROR'
            : 'CUSTOMER_SYNC_PARTIAL',
      title:
        failed.length === 0
          ? 'Sincronización recuperada'
          : failed.length === results.length
            ? 'Error de sincronización'
            : 'Sincronización parcial',
      message:
        failed.length === 0
          ? `${customer.displayName}\nLas integraciones pendientes volvieron a estar sincronizadas.`
          : `${customer.displayName}\n${labels} ${failed.length === 1 ? 'requiere' : 'requieren'} atención.`,
      customerId: customer.id,
      requiredPermission: 'customers.read',
    });
  }

  private createCustomerSummary(
    successType: 'CUSTOMER_CREATED' | 'CUSTOMER_UPDATED',
    successTitle: string,
    customer: Customer,
    results: CustomerSyncResult[],
  ) {
    const failed = results.filter((result) => result.status === 'ERROR');
    if (failed.length === 0) {
      return this.create({
        type: successType,
        title: successTitle,
        message: `${customer.displayName}\nSiigo, Seratus y Pali están sincronizados.`,
        customerId: customer.id,
        requiredPermission: 'customers.read',
      });
    }
    const labels = failed.map((result) => customerProviderLabels[result.provider]).join(', ');
    return this.create({
      type: failed.length === results.length ? 'CUSTOMER_SYNC_ERROR' : 'CUSTOMER_SYNC_PARTIAL',
      title:
        failed.length === results.length ? 'Error de sincronización' : 'Sincronización parcial',
      message: `${customer.displayName}\n${labels} ${failed.length === 1 ? 'requiere' : 'requieren'} atención.`,
      customerId: customer.id,
      requiredPermission: 'customers.read',
    });
  }

  private createProductUpdate(
    type: 'PRODUCT_LINK_UPDATED' | 'SIIGO_PRODUCT_UPDATED',
    product: Product,
    changes: ProductUpdateChanges,
    includeSyncStatus: boolean,
  ) {
    const details: string[] = [];
    if (changes.stock) {
      details.push(`Stock ${changes.stock.previous} ➝ ${changes.stock.current}`);
    }
    if (changes.priceCop) {
      details.push(
        `Precio COP $${compactNumber.format(changes.priceCop.previous)} ➝ $${compactNumber.format(changes.priceCop.current)}`,
      );
    }
    if (changes.priceUsd) {
      details.push(
        `Precio USD $${compactNumber.format(changes.priceUsd.previous)} ➝ $${compactNumber.format(changes.priceUsd.current)}`,
      );
    }
    if (includeSyncStatus && changes.syncStatus) {
      details.push(
        `Estado ${statusLabels[changes.syncStatus.previous]} ➝ ${statusLabels[changes.syncStatus.current]}`,
      );
    }
    if (details.length === 0) return null;

    return this.create({
      type,
      title: 'Producto actualizado',
      message: [product.productName, ...details].join('\n'),
      productId: product.id,
    });
  }

  private async create(data: {
    type: string;
    title: string;
    message: string;
    productId?: number;
    customerId?: number;
    requiredPermission?: string;
  }) {
    const notification = await this.repository.create(data);
    this.realtime.emitNotificationCreated(notification);
    return notification;
  }
}
