import {
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleDestroy,
  type OnModuleInit,
} from '@nestjs/common';
import type { LogListQuery } from '@sevale/validation';
import { setIntegrationLogSink } from '../integrations/integration-http.js';
import { IntegrationLogsRepository } from './integration-logs.repository.js';
import { logData, type IntegrationLogEntry } from './integration-log.types.js';

/** El log es diagnóstico, no historial de negocio: 30 días bastan para investigar un incidente. */
const RETENTION_DAYS = 30;
const CLEANUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

@Injectable()
export class IntegrationLogsService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(IntegrationLogsService.name);
  private cleanupTimer: NodeJS.Timeout | undefined;

  constructor(private readonly repository: IntegrationLogsRepository) {}

  /**
   * Se engancha al cliente HTTP de integraciones: así toda llamada a una API externa queda
   * registrada sin que cada servicio tenga que acordarse de escribirla.
   */
  onModuleInit() {
    setIntegrationLogSink((entry) => {
      void this.repository.create(logData(entry));
    });
    void this.tryRemoveExpired();
    this.scheduleNextCleanup();
  }

  onModuleDestroy() {
    if (this.cleanupTimer) clearTimeout(this.cleanupTimer);
    setIntegrationLogSink(null);
  }

  /** Entrada explícita para los flujos que quieren dejar contexto de negocio (operación, etc.). */
  record(entry: IntegrationLogEntry) {
    return this.repository.create(logData(entry));
  }

  async list(query: LogListQuery) {
    const [logs, total] = await this.repository.list(query);
    return {
      data: logs,
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async detail(id: number) {
    const log = await this.repository.find(id);
    if (!log) {
      throw new NotFoundException({
        success: false,
        error: { code: 'LOG_NOT_FOUND', message: 'El registro no existe.' },
      });
    }
    return log;
  }

  facets() {
    return this.repository.facets();
  }

  async clear() {
    const result = await this.repository.clear();
    return { success: true, deleted: result.count };
  }

  async removeExpired(now = new Date()) {
    const cutoff = new Date(now.getTime() - RETENTION_DAYS * 24 * 60 * 60 * 1000);
    const result = await this.repository.deleteCreatedBefore(cutoff);
    if (result.count > 0) {
      this.logger.log(`Se eliminaron ${result.count} registros de integración con más de 30 días.`);
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
        'No se pudo completar la limpieza de registros de integración.',
        error instanceof Error ? error.stack : undefined,
      );
    }
  }
}
