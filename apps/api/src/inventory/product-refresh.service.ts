import {
  ConflictException,
  Injectable,
  NotFoundException,
  type OnApplicationBootstrap,
} from '@nestjs/common';
import { PrismaService } from '../database/prisma.service.js';
import {
  ProductRefreshJobStatus,
  SyncStatus,
  type ProductRefreshJob,
} from '../generated/prisma/client.js';
import { SiigoService } from '../integrations/siigo/siigo.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { buildSiigoRefresh } from './product-siigo-refresh.js';

const PAGE_SIZE = 100;
/**
 * El techo de Siigo es de 100 solicitudes por minuto. Ochenta centésimas entre páginas deja un
 * cuarto del cupo para las demás integraciones (facturas, cotizaciones, clientes, n8n).
 */
const PAGE_INTERVAL_MS = 800;

function delay(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'Siigo no pudo completar la actualización.';
}

@Injectable()
export class ProductRefreshService implements OnApplicationBootstrap {
  private processing = false;
  /** Un `schedule` que llega mientras el drenaje termina no debe perder el trabajo nuevo. */
  private drainRequested = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly siigo: SiigoService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async onApplicationBootstrap() {
    // El barrido es manual e idempotente: si el proceso murió a mitad, se informa y se puede
    // volver a lanzar. Reanudar por número de página arriesgaría saltarse productos si el orden
    // del catálogo de Siigo cambió entre ambos procesos.
    await this.prisma.productRefreshJob.updateMany({
      where: { status: ProductRefreshJobStatus.RUNNING },
      data: {
        status: ProductRefreshJobStatus.FAILED,
        errorMessage: 'La actualización se interrumpió porque el servidor se reinició.',
        completedAt: new Date(),
      },
    });
    this.schedule();
  }

  /**
   * Encola un barrido completo. Solo puede haber uno activo: dos barridos en paralelo consumirían
   * el doble del cupo de Siigo y competirían por las mismas filas.
   */
  async create(requestedById: string) {
    const active = await this.prisma.productRefreshJob.findFirst({
      where: {
        status: { in: [ProductRefreshJobStatus.PENDING, ProductRefreshJobStatus.RUNNING] },
      },
      select: { id: true },
    });
    if (active) {
      throw new ConflictException({
        success: false,
        error: {
          code: 'PRODUCT_REFRESH_IN_PROGRESS',
          message: 'Ya hay una actualización de inventario desde Siigo en curso.',
        },
      });
    }

    const job = await this.prisma.productRefreshJob.create({ data: { requestedById } });
    this.schedule();
    return this.summary(job);
  }

  async find(jobId: string) {
    const job = await this.prisma.productRefreshJob.findUnique({ where: { id: jobId } });
    if (!job) {
      throw new NotFoundException({
        success: false,
        error: {
          code: 'PRODUCT_REFRESH_JOB_NOT_FOUND',
          message: 'La actualización no existe.',
        },
      });
    }
    return this.summary(job);
  }

  private schedule() {
    queueMicrotask(() => void this.drain());
  }

  private async drain() {
    if (this.processing) {
      this.drainRequested = true;
      return;
    }
    this.processing = true;
    try {
      while (true) {
        const job = await this.prisma.productRefreshJob.findFirst({
          where: { status: ProductRefreshJobStatus.PENDING },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (!job) break;
        await this.processJob(job.id);
      }
    } finally {
      this.processing = false;
      if (this.drainRequested) {
        this.drainRequested = false;
        this.schedule();
      }
    }
  }

  private async processJob(jobId: string) {
    const claimed = await this.prisma.productRefreshJob.updateMany({
      where: { id: jobId, status: ProductRefreshJobStatus.PENDING },
      data: { status: ProductRefreshJobStatus.RUNNING, startedAt: new Date() },
    });
    if (claimed.count !== 1) return;

    const counters = {
      pagesProcessed: 0,
      scanned: 0,
      matched: 0,
      updated: 0,
      synced: 0,
      outOfSync: 0,
      discarded: 0,
      failed: 0,
    };
    let firstFailure: string | null = null;

    try {
      for (let page = 1; ; page += 1) {
        const result = await this.siigo.listProductsPage(page, PAGE_SIZE);
        counters.pagesProcessed = page;
        counters.scanned += result.received;
        // Los que Siigo devolvió con una forma inesperada tampoco tienen vínculo posible.
        counters.discarded += result.received - result.products.length;

        if (result.products.length > 0) {
          const existing = await this.prisma.product.findMany({
            where: { siigoId: { in: result.products.map((product) => product.id) } },
          });
          const bySiigoId = new Map(existing.map((product) => [product.siigoId, product]));

          for (const siigo of result.products) {
            const product = bySiigoId.get(siigo.id);
            if (!product) {
              counters.discarded += 1;
              continue;
            }
            counters.matched += 1;

            const refresh = buildSiigoRefresh(product, siigo, new Date());
            if (!refresh.success) {
              counters.failed += 1;
              firstFailure ??= `${product.sku}: ${refresh.message}`;
              continue;
            }

            try {
              await this.prisma.product.update({
                where: { id: product.id },
                data: {
                  ...refresh.data,
                  // Un barrido no debe reordenar el inventario: el listado ordena por `updatedAt`
                  // y dos mil filas con la misma hora perderían el orden. `lastCheckAt` ya deja
                  // constancia de la consulta.
                  updatedAt: product.updatedAt,
                },
              });
              counters.updated += 1;
              if (refresh.syncStatus === SyncStatus.SYNCED) counters.synced += 1;
              else counters.outOfSync += 1;
            } catch (error) {
              counters.failed += 1;
              firstFailure ??= `${product.sku}: ${readableError(error)}`;
            }
          }
        }

        await this.prisma.productRefreshJob.update({ where: { id: jobId }, data: counters });

        if (result.received === 0) break;
        if (result.total !== null && page * PAGE_SIZE >= result.total) break;
        if (result.total === null && result.received < PAGE_SIZE) break;
        await delay(PAGE_INTERVAL_MS);
      }

      await this.prisma.productRefreshJob.update({
        where: { id: jobId },
        data: {
          status:
            counters.failed === 0
              ? ProductRefreshJobStatus.COMPLETED
              : ProductRefreshJobStatus.COMPLETED_WITH_ERRORS,
          ...(firstFailure !== null ? { errorMessage: firstFailure } : {}),
          completedAt: new Date(),
        },
      });
      if (counters.updated > 0) this.realtime.emitProductsUpdated(counters.updated);
    } catch (error) {
      await this.prisma.productRefreshJob.update({
        where: { id: jobId },
        data: {
          status: ProductRefreshJobStatus.FAILED,
          errorMessage: readableError(error),
          completedAt: new Date(),
        },
      });
    }
  }

  private summary(job: ProductRefreshJob) {
    return {
      id: job.id,
      status: job.status,
      pagesProcessed: job.pagesProcessed,
      scanned: job.scanned,
      matched: job.matched,
      updated: job.updated,
      synced: job.synced,
      outOfSync: job.outOfSync,
      discarded: job.discarded,
      failed: job.failed,
      errorMessage: job.errorMessage,
      createdAt: job.createdAt,
      startedAt: job.startedAt,
      completedAt: job.completedAt,
    };
  }
}
