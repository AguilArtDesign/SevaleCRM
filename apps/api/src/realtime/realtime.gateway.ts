import { Injectable } from '@nestjs/common';
import {
  WebSocketGateway,
  WebSocketServer,
  type OnGatewayConnection,
  type OnGatewayInit,
} from '@nestjs/websockets';
import { rolePermissions, roles, type Permission, type Role } from '@sevale/permissions';
import type { IncomingHttpHeaders } from 'node:http';
import type { Server, Socket } from 'socket.io';
import { AuthService } from '../auth/auth.service.js';
import { getFrontendOrigin } from '../config/environment.js';
import { PrismaService } from '../database/prisma.service.js';
import type { SyncStatus } from '../generated/prisma/client.js';

export type RealtimeChange<T> = { previous: T; current: T } | null;

export type ProductUpdateChanges = {
  priceCop: RealtimeChange<number>;
  priceUsd: RealtimeChange<number>;
  stock: RealtimeChange<number>;
  syncStatus: RealtimeChange<SyncStatus>;
};

type ProductEventBase = {
  productId: number;
  sku: string;
  occurredAt: string;
};

type CustomerEventBase = {
  customerId: number;
  displayName: string;
  occurredAt: string;
};

const permissionRoom = (permission: Permission) => `permission:${permission}`;

function isRole(value: unknown): value is Role {
  return typeof value === 'string' && roles.some((role) => role === value);
}

@Injectable()
@WebSocketGateway({
  cors: {
    origin: (origin, callback) => callback(null, !origin || origin === getFrontendOrigin()),
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayInit, OnGatewayConnection {
  @WebSocketServer()
  private server!: Server;
  private readonly socketPermissions = new WeakMap<Socket, Permission[]>();

  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(server: Server) {
    server.use((socket, next) => {
      void this.authenticate(socket.handshake.headers).then(
        (permissions) => {
          this.socketPermissions.set(socket, permissions);
          next();
        },
        () => next(new Error('UNAUTHORIZED')),
      );
    });
  }

  handleConnection(socket: Socket) {
    const permissions = this.socketPermissions.get(socket) ?? [];
    for (const permission of permissions) void socket.join(permissionRoom(permission));
  }

  private async authenticate(headers: IncomingHttpHeaders) {
    const session = await this.authService.getSession(headers);
    if (!session) throw new Error('UNAUTHORIZED');
    const user = await this.prisma.user.findUnique({
      where: { id: session.user.id },
      select: { active: true },
    });
    if (!user?.active || !isRole(session.user.role)) throw new Error('UNAUTHORIZED');
    return [...rolePermissions[session.user.role]] as Permission[];
  }

  emitProductCreated(product: { id: number; sku: string }) {
    this.server.emit('product.created', this.productEvent(product));
  }

  emitProductUpdated(product: { id: number; sku: string }, changes: ProductUpdateChanges) {
    const base = this.productEvent(product);
    this.server.emit('product.updated', {
      ...base,
      changedFields: Object.entries(changes)
        .filter(([, change]) => change !== null)
        .map(([field]) => field),
    });
    if (changes.stock) {
      this.server.emit('product.stock.updated', { ...base, change: changes.stock });
    }
    if (changes.priceCop || changes.priceUsd) {
      this.server.emit('product.price.updated', {
        ...base,
        priceCop: changes.priceCop,
        priceUsd: changes.priceUsd,
      });
    }
    if (changes.syncStatus) {
      this.server.emit('product.sync.status_changed', {
        ...base,
        change: changes.syncStatus,
      });
    }
  }

  emitProductDeleted(product: { id: number; sku: string }) {
    this.server.emit('product.deleted', this.productEvent(product));
  }

  emitProductsUpdated(count: number) {
    this.server.emit('products.updated', {
      count,
      occurredAt: new Date().toISOString(),
    });
  }

  emitCustomerCreated(customer: { id: number; displayName: string }) {
    this.customerAudience().emit('customer.created', this.customerEvent(customer));
  }

  emitCustomerUpdated(customer: { id: number; displayName: string }) {
    this.customerAudience().emit('customer.updated', this.customerEvent(customer));
  }

  emitCustomerDeleted(customer: { id: number; displayName: string }) {
    this.customerAudience().emit('customer.deleted', this.customerEvent(customer));
  }

  emitCustomerIntegrationUpdated(
    customer: { id: number; displayName: string },
    integration: { provider: string; status: string },
  ) {
    this.customerAudience().emit('customer.integration.updated', {
      ...this.customerEvent(customer),
      provider: integration.provider,
      status: integration.status,
    });
  }

  emitNotificationCreated(notification: {
    id: number;
    type: string;
    title: string;
    message: string;
    productId: number | null;
    customerId: number | null;
    requiredPermission: string | null;
    createdAt: Date;
  }) {
    const audience =
      notification.requiredPermission === 'customers.read' ? this.customerAudience() : this.server;
    audience.emit('notification.created', {
      notificationId: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      productId: notification.productId,
      customerId: notification.customerId,
      occurredAt: notification.createdAt.toISOString(),
    });
  }

  private productEvent(product: { id: number; sku: string }): ProductEventBase {
    return { productId: product.id, sku: product.sku, occurredAt: new Date().toISOString() };
  }

  private customerEvent(customer: { id: number; displayName: string }): CustomerEventBase {
    return {
      customerId: customer.id,
      displayName: customer.displayName,
      occurredAt: new Date().toISOString(),
    };
  }

  private customerAudience() {
    return this.server.to(permissionRoom('customers.read'));
  }
}
