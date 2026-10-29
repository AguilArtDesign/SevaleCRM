import { Injectable } from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';

@Injectable()
export class IntegrationTokenRepository {
  constructor(private readonly prisma: PrismaService) {}

  find(provider: string) {
    return this.prisma.integrationToken.findUnique({ where: { provider } });
  }

  save(provider: string, accessToken: string, expiresAt: Date) {
    return this.prisma.integrationToken.upsert({
      where: { provider },
      create: { provider, accessToken, expiresAt },
      update: { accessToken, expiresAt },
    });
  }
}
