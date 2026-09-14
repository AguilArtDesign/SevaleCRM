import { Injectable } from '@nestjs/common';
import type { CustomerIntegrationProvider } from '../generated/prisma/client.js';
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
