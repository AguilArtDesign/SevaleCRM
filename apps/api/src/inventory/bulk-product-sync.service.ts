import {
  BadRequestException,
  Injectable,
  type OnApplicationBootstrap,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { BulkProductSyncInput } from '@sevale/validation';
import { PrismaService } from '../database/prisma.service.js';
import {
  ProductSyncJobItemStatus,
  ProductSyncJobStatus,
  SyncStatus,
  type ProductSyncJobItem,
} from '../generated/prisma/client.js';
import { WooCommerceService } from '../integrations/woocommerce/woocommerce.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';

const BATCH_SIZE = 25;
const BATCH_CONCURRENCY = 2;

function chunks<T>(items: T[], size: number): T[][] {
  return Array.from({ length: Math.ceil(items.length / size) }, (_, index) =>
    items.slice(index * size, (index + 1) * size),
  );
}

function readableError(error: unknown): string {
  if (error instanceof Error) return error.message;
  return 'WooCommerce no pudo completar la sincronización.';
}

async function runWithConcurrency(tasks: Array<() => Promise<void>>, concurrency: number) {
  let cursor = 0;
  async function worker() {
    while (cursor < tasks.length) {
      const task = tasks[cursor];
      cursor += 1;
      if (task) await task();
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, tasks.length) }, () => worker()));
}

@Injectable()
export class BulkProductSyncService implements OnApplicationBootstrap {
  private processing = false;

  constructor(
    private readonly prisma: PrismaService,
    private readonly wooCommerce: WooCommerceService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async onApplicationBootstrap() {
    await this.prisma.productSyncJob.updateMany({
      where: { status: ProductSyncJobStatus.RUNNING },
      data: { status: ProductSyncJobStatus.PENDING, startedAt: null },
    });
    this.schedule();
  }

  async create(input: BulkProductSyncInput, requestedById: string) {
    const products = await this.prisma.product.findMany({ where: { id: { in: input.ids } } });
    if (products.length !== input.ids.length) {
      throw new BadRequestException({
        success: false,
        error: { code: 'PRODUCT_NOT_FOUND', message: 'Uno o más productos ya no existen.' },
      });
    }
    if (products.some((product) => !product.wooVariationId)) {
      throw new UnprocessableEntityException({
        success: false,
        error: {
          code: 'WOOCOMMERCE_PRODUCT_ID_MISSING',
          message: 'Uno o más productos no tienen un identificador válido de WooCommerce.',
        },
      });
    }

    const job = await this.prisma.$transaction(async (transaction) => {
      const created = await transaction.productSyncJob.create({
        data: { requestedById, total: products.length },
      });
      for (const productChunk of chunks(products, 500)) {
        await transaction.productSyncJobItem.createMany({
          data: productChunk.map((product) => ({
            jobId: created.id,
            productId: product.id,
            sku: product.sku,
            productName: product.productName,
            store: product.store,
            wooParentId: product.wooParentId,
            wooProductId: product.wooVariationId!,
            priceCop: product.siigoPriceCop,
            priceUsd: product.siigoPriceUsd,
            stock: product.siigoStock,
          })),
        });
      }
      return created;
    });
    this.schedule();
    return this.summary(job);
  }

  async find(id: string, requestedById: string) {
    const job = await this.prisma.productSyncJob.findFirst({ where: { id, requestedById } });
    if (!job) {
      throw new BadRequestException({
        success: false,
        error: { code: 'SYNC_JOB_NOT_FOUND', message: 'La sincronización no existe.' },
      });
    }
    const failedProductIds =
      job.status === ProductSyncJobStatus.COMPLETED_WITH_ERRORS
        ? (
            await this.prisma.productSyncJobItem.findMany({
              where: { jobId: id, status: ProductSyncJobItemStatus.ERROR },
              select: { productId: true },
            })
          ).map((item) => item.productId)
        : [];
    return { ...this.summary(job), failedProductIds };
  }

  private schedule() {
    queueMicrotask(() => void this.drain());
  }

  private async drain() {
    if (this.processing) return;
    this.processing = true;
    try {
      while (true) {
        const job = await this.prisma.productSyncJob.findFirst({
          where: { status: ProductSyncJobStatus.PENDING },
          orderBy: { createdAt: 'asc' },
          select: { id: true },
        });
        if (!job) break;
        await this.processJob(job.id);
      }
    } finally {
      this.processing = false;
    }
  }

  private async processJob(jobId: string) {
    const claimed = await this.prisma.productSyncJob.updateMany({
      where: { id: jobId, status: ProductSyncJobStatus.PENDING },
      data: { status: ProductSyncJobStatus.RUNNING, startedAt: new Date() },
    });
    if (claimed.count !== 1) return;

    try {
      const items = await this.prisma.productSyncJobItem.findMany({
        where: { jobId, status: ProductSyncJobItemStatus.PENDING },
      });
      const groups = new Map<string, ProductSyncJobItem[]>();
      for (const item of items) {
        const key = `${item.store}:${item.wooParentId?.toString() ?? 'simple'}`;
        groups.set(key, [...(groups.get(key) ?? []), item]);
      }
      const tasks = [...groups.values()].flatMap((group) =>
        chunks(group, BATCH_SIZE).map((batch) => () => this.processBatch(jobId, batch)),
      );
      await runWithConcurrency(tasks, BATCH_CONCURRENCY);

      const current = await this.prisma.productSyncJob.findUniqueOrThrow({ where: { id: jobId } });
      await this.prisma.productSyncJob.update({
        where: { id: jobId },
        data: {
          status:
            current.failed === 0
              ? ProductSyncJobStatus.COMPLETED
              : ProductSyncJobStatus.COMPLETED_WITH_ERRORS,
          completedAt: new Date(),
        },
      });
    } catch (error) {
      await this.prisma.productSyncJob.update({
        where: { id: jobId },
        data: {
          status: ProductSyncJobStatus.FAILED,
          errorMessage: readableError(error),
          completedAt: new Date(),
        },
      });
    }
  }

  private async processBatch(jobId: string, batch: ProductSyncJobItem[]) {
    const first = batch[0];
    if (!first) return;
    try {
      const results = await this.wooCommerce.updateProductsBatch({
        store: first.store,
        parentId: first.wooParentId?.toString() ?? null,
        updates: batch.map((item) => ({
          productId: item.wooProductId.toString(),
          priceCop: Number(item.priceCop),
          priceUsd: Number(item.priceUsd),
          stock: item.stock,
        })),
      });
      for (const item of batch) {
        const result = results.find(
          (candidate) => candidate.productId === item.wooProductId.toString(),
        );
        if (result?.success) await this.completeItem(jobId, item);
        else await this.failItem(jobId, item, result?.error ?? 'WooCommerce rechazó el producto.');
      }
    } catch (error) {
      const message = readableError(error);
      for (const item of batch) await this.failItem(jobId, item, message);
    }
  }

  private async completeItem(jobId: string, item: ProductSyncJobItem) {
    const product = await this.prisma.product.update({
      where: { id: item.productId },
      data: {
        wooPriceCop: item.priceCop,
        wooPriceUsd: item.priceUsd,
        wooStock: item.stock,
        syncStatus: SyncStatus.SYNCED,
        lastSyncAt: new Date(),
      },
    });
    await this.prisma.$transaction([
      this.prisma.productSyncJobItem.update({
        where: { id: item.id },
        data: {
          status: ProductSyncJobItemStatus.SYNCED,
          attempts: { increment: 1 },
          processedAt: new Date(),
        },
      }),
      this.prisma.productSyncJob.update({
        where: { id: jobId },
        data: { processed: { increment: 1 }, succeeded: { increment: 1 } },
      }),
    ]);
    this.realtime.emitProductUpdated(product, {
      priceCop: null,
      priceUsd: null,
      stock: null,
      syncStatus: null,
    });
  }

  private async failItem(jobId: string, item: ProductSyncJobItem, errorMessage: string) {
    const product = await this.prisma.product.update({
      where: { id: item.productId },
      data: { syncStatus: SyncStatus.ERROR },
    });
    await this.prisma.$transaction([
      this.prisma.productSyncJobItem.update({
        where: { id: item.id },
        data: {
          status: ProductSyncJobItemStatus.ERROR,
          attempts: { increment: 1 },
          errorMessage,
          processedAt: new Date(),
        },
      }),
      this.prisma.productSyncJob.update({
        where: { id: jobId },
        data: { processed: { increment: 1 }, failed: { increment: 1 } },
      }),
    ]);
    this.realtime.emitProductUpdated(product, {
      priceCop: null,
      priceUsd: null,
      stock: null,
      syncStatus: null,
    });
  }

  private summary(job: {
    id: string;
    status: ProductSyncJobStatus;
    total: number;
    processed: number;
    succeeded: number;
    failed: number;
    errorMessage: string | null;
    createdAt: Date;
    startedAt: Date | null;
    completedAt: Date | null;
  }) {
    return job;
  }
}
