import {
  Injectable,
  Logger,
  type OnApplicationBootstrap,
  type OnModuleDestroy,
} from '@nestjs/common';
import { NotificationsRepository } from './notifications.repository.js';

const NOTIFICATION_RETENTION_DAYS = 90;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;
const RETENTION_MS = NOTIFICATION_RETENTION_DAYS * CLEANUP_INTERVAL_MS;

@Injectable()
export class NotificationRetentionService implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(NotificationRetentionService.name);
  private cleanupTimer: NodeJS.Timeout | undefined;

  constructor(private readonly repository: NotificationsRepository) {}

  async onApplicationBootstrap() {
    await this.tryRemoveExpired();
    this.scheduleNextCleanup();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
  }

  async removeExpired(now = new Date()) {
    const cutoff = new Date(now.getTime() - RETENTION_MS);
    const result = await this.repository.deleteCreatedBefore(cutoff);
    if (result.count > 0) {
      this.logger.log(`Se eliminaron ${result.count} notificaciones con más de 90 días.`);
    }
    return result.count;
  }

  private scheduleNextCleanup() {
    this.cleanupTimer = setTimeout(() => void this.runScheduledCleanup(), CLEANUP_INTERVAL_MS);
    this.cleanupTimer.unref();
  }

  private async runScheduledCleanup() {
    await this.tryRemoveExpired();
    this.scheduleNextCleanup();
  }

  private async tryRemoveExpired() {
    try {
      await this.removeExpired();
    } catch (error) {
      this.logger.error(
        'No se pudo completar la limpieza de notificaciones.',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
