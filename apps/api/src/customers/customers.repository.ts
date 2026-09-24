import { Injectable } from '@nestjs/common';
import type { CustomerListQuery, N8nCustomerIntegrationInput } from '@sevale/validation';
import type { CustomerCityMatch } from '@sevale/shared';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

export const customerInclude = {
  integrations: { orderBy: { provider: 'asc' as const } },
} as const;

export type CustomerWithIntegrations = Prisma.CustomerGetPayload<{
  include: typeof customerInclude;
}>;

@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(
    { search, country, page, pageSize, sort, order }: CustomerListQuery,
    cityMatches: CustomerCityMatch[],
  ) {
    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
      ...(country ? { country } : {}),
      ...(search
        ? {
            OR: [
              { displayName: { contains: search } },
              { firstName: { contains: search } },
              { lastName: { contains: search } },
              { company: { contains: search } },
              { documentNumber: { contains: search } },
              { email: { contains: search } },
              { phone: { contains: search } },
              { cityName: { contains: search } },
              ...cityMatches.map(({ country: cityCountry, cityCode }) => ({
                country: cityCountry,
                cityCode,
              })),
            ],
          }
        : {}),
    };

    return this.prisma.$transaction([
      this.prisma.customer.findMany({
        where,
        include: customerInclude,
        orderBy: [{ [sort]: order }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.customer.count({ where }),
    ]);
  }

  findById(id: number) {
    return this.prisma.customer.findFirst({
      where: { id, deletedAt: null },
      include: customerInclude,
    });
  }

  findByDocument(documentType: string, documentNumber: string) {
    return this.prisma.customer.findFirst({
      where: { documentType, documentNumber, deletedAt: null },
      select: { id: true },
    });
  }

  findByDocumentNumber(documentNumber: string) {
    return this.prisma.customer.findFirst({
      where: { documentNumber, deletedAt: null },
      select: { id: true },
    });
  }

  findIntegrationOwner(provider: N8nCustomerIntegrationInput['provider'], externalId: string) {
    return this.prisma.customerIntegration.findFirst({
      where: { provider, externalId },
      select: { customerId: true },
    });
  }

  /** Vincula los identificadores de cada tienda y los marca como sincronizados en esa tienda. */
  linkIntegrations(customerId: number, integrations: N8nCustomerIntegrationInput[]) {
    const now = new Date();
    return this.prisma.$transaction(async (transaction) => {
      for (const { provider, externalId } of integrations) {
        await transaction.customerIntegration.upsert({
          where: { customerId_provider: { customerId, provider } },
          create: {
            customerId,
            provider,
            externalId,
            status: 'SYNCED',
            lastAttemptAt: now,
            lastSyncedAt: now,
          },
          update: {
            externalId,
            status: 'SYNCED',
            lastAttemptAt: now,
            lastSyncedAt: now,
            lastErrorCode: null,
            lastErrorMessage: null,
          },
        });
      }
      return transaction.customer.findUniqueOrThrow({
        where: { id: customerId },
        include: customerInclude,
      });
    });
  }

  create(data: Prisma.CustomerCreateInput) {
    return this.prisma.customer.create({ data, include: customerInclude });
  }

  update(id: number, data: Prisma.CustomerUpdateInput) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.customer.update({ where: { id }, data });
      await transaction.customerIntegration.updateMany({
        where: { customerId: id },
        data: {
          status: 'PENDING',
          lastErrorCode: null,
          lastErrorMessage: null,
        },
      });
      return transaction.customer.findUniqueOrThrow({
        where: { id },
        include: customerInclude,
      });
    });
  }

  updateCheckDigit(id: number, checkDigit: string) {
    return this.prisma.customer.update({ where: { id }, data: { checkDigit } });
  }

  delete(id: number) {
    return this.prisma.$transaction(async (transaction) => {
      const validOperations = await transaction.orderOperation.count({
        where: { customerId: id, deletedAt: null },
      });
      if (validOperations > 0) return null;

      const legacyOrders = await transaction.order.findMany({
        where: { operation: { customerId: id } },
        select: { id: true },
      });
      const legacyOrderIds = legacyOrders.map(({ id: orderId }) => orderId);
      if (legacyOrderIds.length > 0) {
        await transaction.wooOrderDelivery.deleteMany({
          where: { orderId: { in: legacyOrderIds } },
        });
      }
      await transaction.notification.deleteMany({
        where: { OR: [{ customerId: id }, { orderOperation: { customerId: id } }] },
      });
      await transaction.orderOperation.deleteMany({ where: { customerId: id } });
      return transaction.customer.delete({ where: { id }, include: customerInclude });
    });
  }
}
