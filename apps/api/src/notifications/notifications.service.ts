import { Injectable, NotFoundException } from '@nestjs/common';
import type { NotificationListQuery } from '@sevale/validation';
import type { Product, SyncStatus } from '../generated/prisma/client.js';
import { RealtimeGateway, type ProductUpdateChanges } from '../realtime/realtime.gateway.js';
import { NotificationsRepository } from './notifications.repository.js';

const compactNumber = new Intl.NumberFormat('es-CO', { maximumFractionDigits: 2 });

const statusLabels: Record<SyncStatus, string> = {
  SYNCED: 'Sincronizado',
  PENDING: 'Pendiente',
  OUT_OF_SYNC: 'Desactualizado',
  ERROR: 'Con error',
};

@Injectable()
export class NotificationsService {
  constructor(
    private readonly repository: NotificationsRepository,
    private readonly realtime: RealtimeGateway,
  ) {}

  async list(userId: string, query: NotificationListQuery) {
    const [notifications, total, unreadCount] = await this.repository.list(userId, query);
    return {
      data: notifications.map((notification) => ({
        id: notification.id,
        type: notification.type,
        title: notification.title,
        message: notification.message,
        productId: notification.productId,
        product: notification.product,
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

  async markRead(notificationId: number, userId: string) {
    if (!(await this.repository.findById(notificationId))) {
      throw new NotFoundException({
        success: false,
        error: { code: 'NOTIFICATION_NOT_FOUND', message: 'La notificación no existe.' },
      });
    }
    const read = await this.repository.markRead(notificationId, userId);
    return { success: true, notificationId, readAt: read.readAt };
  }

  async markAllRead(userId: string) {
    const updated = await this.repository.markAllRead(userId);
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

  createSiigoProductUpdate(product: Product, changes: ProductUpdateChanges) {
    return this.createProductUpdate('SIIGO_PRODUCT_UPDATED', product, changes, false);
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

  private async create(data: { type: string; title: string; message: string; productId: number }) {
    const notification = await this.repository.create(data);
    this.realtime.emitNotificationCreated(notification);
    return notification;
  }
}
