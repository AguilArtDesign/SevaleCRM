import { Injectable } from '@nestjs/common';
import type { CustomerIntegrationProvider } from '../generated/prisma/client.js';
import type { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class CustomerIntegrationsRepository {
  constructor(private readonly prisma: PrismaService) {}

  markPending(customerId: number, provider: CustomerIntegrationProvider, attemptedAt: Date) {
    return this.prisma.customerIntegration.upsert({
      where: { customerId_provider: { customerId, provider } },
      create: { customerId, provider, status: 'PENDING', lastAttemptAt: attemptedAt },
      update: {
        status: 'PENDING',
        lastAttemptAt: attemptedAt,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
  }

  rememberExternalId(
    customerId: number,
    provider: CustomerIntegrationProvider,
    externalId: string,
  ) {
    return this.prisma.customerIntegration.update({
      where: { customerId_provider: { customerId, provider } },
      data: { externalId },
    });
  }

  mergeExternalData(
    customerId: number,
    provider: CustomerIntegrationProvider,
    patch: Prisma.JsonObject,
  ) {
    return this.prisma.$transaction(async (transaction) => {
      const integration = await transaction.customerIntegration.findUniqueOrThrow({
        where: { customerId_provider: { customerId, provider } },
        select: { externalData: true },
      });
      const current = integration.externalData;
      const base: Prisma.JsonObject =
        typeof current === 'object' && current !== null && !Array.isArray(current)
          ? current
          : current === null
            ? {}
            : { legacy: current };
      return transaction.customerIntegration.update({
        where: { customerId_provider: { customerId, provider } },
        data: { externalData: { ...base, ...patch } },
      });
    });
  }

  markSynced(
    customerId: number,
    provider: CustomerIntegrationProvider,
    externalId: string,
    syncedAt: Date,
  ) {
    return this.prisma.customerIntegration.update({
      where: { customerId_provider: { customerId, provider } },
      data: {
        externalId,
        status: 'SYNCED',
        lastAttemptAt: syncedAt,
        lastSyncedAt: syncedAt,
        lastErrorCode: null,
        lastErrorMessage: null,
      },
    });
  }

  markError(
    customerId: number,
    provider: CustomerIntegrationProvider,
    attemptedAt: Date,
    code: string,
    message: string,
  ) {
    return this.prisma.customerIntegration.update({
      where: { customerId_provider: { customerId, provider } },
      data: {
        status: 'ERROR',
        lastAttemptAt: attemptedAt,
        lastErrorCode: code,
        lastErrorMessage: message,
      },
    });
  }
}
