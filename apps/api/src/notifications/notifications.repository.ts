import { Injectable } from '@nestjs/common';
import type { NotificationListQuery } from '@sevale/validation';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  private visibleTo(requiredPermissions: readonly string[]): Prisma.NotificationWhereInput {
    return {
      OR: [{ requiredPermission: null }, { requiredPermission: { in: [...requiredPermissions] } }],
    };
  }

  list(userId: string, query: NotificationListQuery, requiredPermissions: readonly string[]) {
    const statusFilter: Prisma.NotificationWhereInput =
      query.status === 'unread'
        ? { reads: { none: { userId } } }
        : query.status === 'read'
          ? { reads: { some: { userId } } }
          : {};
    const where: Prisma.NotificationWhereInput = {
      AND: [this.visibleTo(requiredPermissions), statusFilter],
    };

    return this.prisma.$transaction([
      this.prisma.notification.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          product: { select: { sku: true, productName: true, imageUrl: true, store: true } },
          customer: {
            select: {
              personType: true,
              firstName: true,
              lastName: true,
              displayName: true,
              email: true,
            },
          },
          reads: { where: { userId }, select: { readAt: true } },
        },
      }),
      this.prisma.notification.count({ where }),
      this.prisma.notification.count({
        where: {
          AND: [this.visibleTo(requiredPermissions), { reads: { none: { userId } } }],
        },
      }),
    ]);
  }

  findById(id: number, requiredPermissions: readonly string[]) {
    return this.prisma.notification.findFirst({
      where: { id, ...this.visibleTo(requiredPermissions) },
      select: { id: true },
    });
  }

  markRead(notificationId: number, userId: string) {
    return this.prisma.notificationRead.upsert({
      where: { notificationId_userId: { notificationId, userId } },
      create: { notificationId, userId },
      update: {},
    });
  }

  async markAllRead(userId: string, requiredPermissions: readonly string[]) {
    const unread = await this.prisma.notification.findMany({
      where: {
        AND: [this.visibleTo(requiredPermissions), { reads: { none: { userId } } }],
      },
      select: { id: true },
    });
    if (unread.length === 0) return 0;
    const result = await this.prisma.notificationRead.createMany({
      data: unread.map(({ id }) => ({ notificationId: id, userId })),
      skipDuplicates: true,
    });
    return result.count;
  }

  create(data: Prisma.NotificationUncheckedCreateInput) {
    return this.prisma.notification.create({ data });
  }

  deleteCreatedBefore(cutoff: Date) {
    return this.prisma.notification.deleteMany({ where: { createdAt: { lt: cutoff } } });
  }
}
