import { Injectable } from '@nestjs/common';
import type { LogListQuery } from '@sevale/validation';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class IntegrationLogsRepository {
  constructor(private readonly prisma: PrismaService) {}

  async create(data: Prisma.IntegrationLogUncheckedCreateInput) {
    try {
      await this.prisma.integrationLog.create({ data });
    } catch {
      // El registro es diagnóstico: si falla, la operación que lo generó debe seguir su curso.
    }
  }

  list(query: LogListQuery) {
    const filters: Prisma.IntegrationLogWhereInput[] = [];
    if (query.integration) filters.push({ integration: query.integration });
    if (query.outcome) filters.push({ outcome: query.outcome });
    if (query.code) filters.push({ code: query.code });
    if (query.referenceId) filters.push({ referenceId: query.referenceId });
    if (query.search) {
      filters.push({
        OR: [
          { code: { contains: query.search } },
          { message: { contains: query.search } },
          { url: { contains: query.search } },
          { operation: { contains: query.search } },
        ],
      });
    }
    const where: Prisma.IntegrationLogWhereInput = filters.length > 0 ? { AND: filters } : {};

    return this.prisma.$transaction([
      this.prisma.integrationLog.findMany({
        where,
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        select: {
          id: true,
          integration: true,
          operation: true,
          outcome: true,
          method: true,
          statusCode: true,
          code: true,
          message: true,
          durationMs: true,
          referenceType: true,
          referenceId: true,
          createdAt: true,
          user: { select: { id: true, name: true } },
        },
      }),
      this.prisma.integrationLog.count({ where }),
    ]);
  }

  find(id: number) {
    return this.prisma.integrationLog.findUnique({
      where: { id },
      include: { user: { select: { id: true, name: true, email: true } } },
    });
  }

  /** Opciones de los filtros: lo que realmente aparece en el registro, no una lista fija. */
  async facets() {
    const [integrations, codes] = await this.prisma.$transaction([
      this.prisma.integrationLog.findMany({
        distinct: ['integration'],
        select: { integration: true },
        orderBy: { integration: 'asc' },
        take: 50,
      }),
      this.prisma.integrationLog.findMany({
        where: { code: { not: null } },
        distinct: ['code'],
        select: { code: true },
        orderBy: { code: 'asc' },
        take: 100,
      }),
    ]);
    return {
      integrations: integrations.map(({ integration }) => integration),
      codes: codes.map(({ code }) => code).filter((code): code is string => code !== null),
    };
  }

  deleteCreatedBefore(cutoff: Date) {
    return this.prisma.integrationLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  }

  clear() {
    return this.prisma.integrationLog.deleteMany();
  }
}
