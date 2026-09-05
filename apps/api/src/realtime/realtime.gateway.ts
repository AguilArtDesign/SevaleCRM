import { Injectable } from '@nestjs/common';
import { WebSocketGateway, WebSocketServer, type OnGatewayInit } from '@nestjs/websockets';
import type { IncomingHttpHeaders } from 'node:http';
import type { Server } from 'socket.io';
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

@Injectable()
@WebSocketGateway({
  cors: {
    origin: (origin, callback) => callback(null, !origin || origin === getFrontendOrigin()),
    credentials: true,
  },
})
export class RealtimeGateway implements OnGatewayInit {
  @WebSocketServer()
  private server!: Server;

  constructor(
    private readonly authService: AuthService,
    private readonly prisma: PrismaService,
  ) {}

  afterInit(server: Server) {
    server.use((socket, next) => {
      void this.authenticate(socket.handshake.headers).then(
        () => next(),
        () => next(new Error('UNAUTHORIZED')),
      );
    });
  }

  private async authenticate(headers: IncomingHttpHeaders) {
    const session = await this.authService.getSession(headers);
    if (!session) throw new Error('UNAUTHORIZED');
    const user = await this.prisma.user.findUnique({
      where: { id: session.user.id },
      select: { active: true },
    });
    if (!user?.active) throw new Error('UNAUTHORIZED');
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

  emitNotificationCreated(notification: {
    id: number;
    type: string;
    title: string;
    message: string;
    productId: number | null;
    createdAt: Date;
  }) {
    this.server.emit('notification.created', {
      notificationId: notification.id,
      type: notification.type,
      title: notification.title,
      message: notification.message,
      productId: notification.productId,
      occurredAt: notification.createdAt.toISOString(),
    });
  }

  private productEvent(product: { id: number; sku: string }): ProductEventBase {
    return { productId: product.id, sku: product.sku, occurredAt: new Date().toISOString() };
  }
}
