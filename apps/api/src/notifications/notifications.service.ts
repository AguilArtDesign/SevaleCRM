import { Injectable, NotFoundException } from '@nestjs/common';
import { rolePermissions, roles, type Permission } from '@sevale/permissions';
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
        orderOperationId: notification.orderOperationId,
        orderOperation: notification.orderOperation,
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

  /**
   * Un cliente nuevo. Solo se avisa el alta: la sincronización con las tiendas y con Siigo ya queda
   * en la actividad de la ficha, que es donde se consulta.
   */
  async createCustomerCreated(
    customer: { id: number; displayName: string },
    actorUserId: string | null,
  ) {
    return this.create({
      type: 'CUSTOMER_CREATED',
      title: 'Nuevo Cliente',
      message: `${await this.actorName(actorUserId)} ha creado un nuevo cliente ➝ ${customer.displayName}`,
      customerId: customer.id,
      requiredPermission: 'customers.read',
    });
  }

  /**
   * Un pedido nuevo, y nada más: completar, sincronizar o cotizar no avisa aquí. Esos movimientos
   * viven en la actividad del pedido, donde están todos juntos y con su autor.
   */
  async createOrderOperation(
    operation: { id: number; operationCode: string },
    source: 'CRM' | 'WOOCOMMERCE',
    actorUserId: string | null,
  ) {
    return this.create({
      type: 'ORDER_OPERATION_CREATED',
      title: 'Nuevo Pedido',
      // Un pedido de la tienda no lo creó nadie del CRM: lo trajo WooCommerce, y decirlo así evita
      // atribuírselo a quien lo está viendo.
      message:
        source === 'WOOCOMMERCE'
          ? `WooCommerce ha enviado un nuevo pedido ${operation.operationCode}`
          : `${await this.actorName(actorUserId)} ha creado un nuevo pedido ${operation.operationCode}`,
      orderOperationId: operation.id,
      requiredPermission: 'orders.read',
    });
  }

  /** Quién hizo la acción. Sin usuario —lo hizo una integración— el aviso lo atribuye al sistema. */
  private async actorName(userId: string | null): Promise<string> {
    if (!userId) return 'Sistema';
    const user = await this.repository.userName(userId);
    return user?.name ?? 'Sistema';
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
    orderOperationId?: number;
    requiredPermission?: string;
  }) {
    const notification = await this.repository.create(data);
    this.realtime.emitNotificationCreated(notification);
    return notification;
  }
}
