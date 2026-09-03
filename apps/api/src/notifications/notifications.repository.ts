import { Injectable } from '@nestjs/common';
import type { NotificationListQuery } from '@sevale/validation';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class NotificationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(userId: string, query: NotificationListQuery) {
    const statusFilter: Prisma.NotificationWhereInput =
      query.status === 'unread'
        ? { reads: { none: { userId } } }
        : query.status === 'read'
          ? { reads: { some: { userId } } }
          : {};

    return this.prisma.$transaction([
      this.prisma.notification.findMany({
        where: statusFilter,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: {
          product: { select: { sku: true, productName: true } },
          reads: { where: { userId }, select: { readAt: true } },
        },
      }),
      this.prisma.notification.count({ where: statusFilter }),
      this.prisma.notification.count({ where: { reads: { none: { userId } } } }),
    ]);
  }

  findById(id: number) {
    return this.prisma.notification.findUnique({ where: { id }, select: { id: true } });
  }

  markRead(notificationId: number, userId: string) {
    return this.prisma.notificationRead.upsert({
      where: { notificationId_userId: { notificationId, userId } },
      create: { notificationId, userId },
      update: {},
    });
  }

  async markAllRead(userId: string) {
    const unread = await this.prisma.notification.findMany({
      where: { reads: { none: { userId } } },
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
}
