import { Injectable } from '@nestjs/common';
import type { CustomerListQuery } from '@sevale/validation';
import type { CityMatch } from '@sevale/shared';
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
    cityMatches: CityMatch[],
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

  delete(id: number) {
    return this.prisma.$transaction(async (transaction) => {
      await transaction.notification.deleteMany({ where: { customerId: id } });
      return transaction.customer.delete({ where: { id }, include: customerInclude });
    });
  }
}
