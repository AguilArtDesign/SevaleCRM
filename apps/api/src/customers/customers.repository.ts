import { Injectable } from '@nestjs/common';
import type {
  CustomerListQuery,
  CustomerSyncStatusFilter,
  N8nCustomerIntegrationInput,
} from '@sevale/validation';
import type { CustomerCityMatch } from '@sevale/shared';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

export const customerInclude = {
  integrations: { orderBy: { provider: 'asc' as const } },
} as const;

export type CustomerWithIntegrations = Prisma.CustomerGetPayload<{
  include: typeof customerInclude;
}>;

/**
 * Filtro por estado de sincronización. El estado es una deducción de las tres integraciones, con la
 * misma prioridad que muestra el panel (error > sincronizado > desactualizado > pendiente), así que
 * se resuelve en SQL: filtrar en memoria rompería la paginación y el contador.
 */
function customerStatusWhere(status: CustomerSyncStatusFilter): Prisma.CustomerWhereInput {
  if (status === 'all') return {};

  const hasError: Prisma.CustomerWhereInput = { integrations: { some: { status: 'ERROR' } } };
  // «Todas sincronizadas» exige al menos una: `every` sola también es cierta sin integraciones.
  const allSynced: Prisma.CustomerWhereInput = {
    integrations: { some: { status: 'SYNCED' }, every: { status: 'SYNCED' } },
  };
  // Pendiente que ya estuvo sincronizado: el CRM tiene cambios sin enviar.
  const stalePending: Prisma.CustomerWhereInput['integrations'] = {
    some: { status: 'PENDING', lastSyncedAt: { not: null } },
  };

  if (status === 'ERROR') return hasError;
  if (status === 'SYNCED') return allSynced;
  if (status === 'OUT_OF_SYNC') {
    return { NOT: [hasError, allSynced], integrations: stalePending };
  }
  return {
    NOT: [hasError, allSynced],
    integrations: { none: { status: 'PENDING', lastSyncedAt: { not: null } } },
  };
}

@Injectable()
export class CustomersRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(
    { search, country, status, page, pageSize, sort, order }: CustomerListQuery,
    cityMatches: CustomerCityMatch[],
  ) {
    const where: Prisma.CustomerWhereInput = {
      deletedAt: null,
      ...(country ? { country } : {}),
      ...customerStatusWhere(status),
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

  /** Exportación: mismo `include` que el detalle, para resolver país, región y ciudad al leer. */
  findByIds(ids: number[]) {
    return this.prisma.customer.findMany({
      where: { id: { in: ids }, deletedAt: null },
      include: customerInclude,
      orderBy: [{ displayName: 'asc' }, { id: 'asc' }],
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

  /**
   * Operaciones que impiden borrar al cliente. Se consulta antes de borrarlo en las tiendas: el
   * borrado local puede rechazarse por tener pedidos, y en ese caso no debe haberse borrado nada en
   * remoto.
   */
  blockingOperations(customerId: number) {
    return this.prisma.orderOperation.count({ where: { customerId, deletedAt: null } });
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
