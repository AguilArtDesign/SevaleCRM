import {
  BadRequestException,
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Put,
  Query,
  Req,
  StreamableFile,
} from '@nestjs/common';
import {
  bulkProductSyncSchema,
  createProductLinkSchema,
  externalProductQuerySchema,
  productIdSchema,
  productExportSchema,
  productImportCsvSchema,
  productListQuerySchema,
  productRefreshJobIdSchema,
  productSyncJobIdSchema,
} from '@sevale/validation';
import type { ZodType } from 'zod';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { ProductLinkService } from './product-link.service.js';
import { BulkProductSyncService } from './bulk-product-sync.service.js';
import { ProductRefreshService } from './product-refresh.service.js';
import { ProductsService } from './products.service.js';
import { ProductImportService } from './product-import.service.js';

function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new BadRequestException({
    success: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: result.error.issues[0]?.message || 'Los datos enviados no son válidos.',
    },
  });
}

@Controller('products')
@RequirePermissions('inventory.read')
export class ProductsController {
  constructor(
    private readonly productsService: ProductsService,
    private readonly productLinkService: ProductLinkService,
    private readonly bulkProductSyncService: BulkProductSyncService,
    private readonly productRefreshService: ProductRefreshService,
    private readonly productImportService: ProductImportService,
  ) {}

  @Get()
  list(@Query() query: unknown) {
    return this.productsService.list(parseInput(productListQuerySchema, query));
  }

  @Get('link-preview')
  linkPreview(@Query() query: unknown) {
    const { sku } = parseInput(externalProductQuerySchema, query);
    return this.productLinkService.preview(sku);
  }

  @Get('import/status')
  @RequirePermissions('inventory.create')
  importStatus() {
    return this.productImportService.status();
  }

  @Post('import/preview')
  @RequirePermissions('inventory.create')
  importPreview(@Body() body: unknown) {
    const { csv } = parseInput(productImportCsvSchema, body);
    return this.productImportService.preview(csv);
  }

  @Post('import')
  @RequirePermissions('inventory.create')
  importProducts(@Body() body: unknown) {
    const { csv } = parseInput(productImportCsvSchema, body);
    return this.productImportService.import(csv);
  }

  @Post()
  @RequirePermissions('inventory.create')
  createLink(@Body() body: unknown) {
    return this.productLinkService.create(parseInput(createProductLinkSchema, body));
  }

  @Put()
  @RequirePermissions('inventory.update')
  updateLink(@Body() body: unknown) {
    return this.productLinkService.update(parseInput(createProductLinkSchema, body));
  }

  @Post('export')
  @HttpCode(HttpStatus.OK)
  async export(@Body() body: unknown) {
    const { ids } = parseInput(productExportSchema, body);
    const exported = await this.productsService.export(ids);
    return new StreamableFile(exported.buffer, {
      type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      disposition: `attachment; filename="${exported.filename}"`,
      length: exported.buffer.length,
    });
  }

  @Post(':id/sync')
  @RequirePermissions('inventory.update')
  sync(@Param('id') id: string) {
    return this.productsService.sync(parseInput(productIdSchema, id));
  }

  @Post(':id/refresh-from-siigo')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('inventory.update')
  refreshFromSiigo(@Param('id') id: string) {
    return this.productsService.refreshFromSiigo(parseInput(productIdSchema, id));
  }

  // Es un refresco informativo del snapshot de bodegas, no una mutación de negocio: por eso
  // alcanza con `inventory.read` y lo pueden usar los roles que ya ven el inventario.
  @Post(':id/warehouses/refresh')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('inventory.read')
  refreshWarehouses(@Param('id') id: string) {
    return this.productsService.refreshWarehouses(parseInput(productIdSchema, id));
  }

  @Post('sync-jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('inventory.update')
  createSyncJob(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.bulkProductSyncService.create(
      parseInput(bulkProductSyncSchema, body),
      request.auth.user.id,
    );
  }

  @Get('sync-jobs/:jobId')
  @RequirePermissions('inventory.update')
  syncJob(@Param('jobId') jobId: string, @Req() request: AuthenticatedRequest) {
    return this.bulkProductSyncService.find(
      parseInput(productSyncJobIdSchema, jobId),
      request.auth.user.id,
    );
  }

  // Un barrido completo del catálogo de Siigo es una lectura: se actualiza el espejo local y no
  // se envía nada a Siigo ni a WooCommerce.
  @Post('refresh-jobs')
  @HttpCode(HttpStatus.ACCEPTED)
  @RequirePermissions('inventory.update')
  createRefreshJob(@Req() request: AuthenticatedRequest) {
    return this.productRefreshService.create(request.auth.user.id);
  }

  @Get('refresh-jobs/:jobId')
  @RequirePermissions('inventory.update')
  refreshJob(@Param('jobId') jobId: string) {
    return this.productRefreshService.find(parseInput(productRefreshJobIdSchema, jobId));
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.productsService.detail(parseInput(productIdSchema, id));
  }

  @Delete(':id')
  @RequirePermissions('inventory.delete')
  remove(@Param('id') id: string) {
    return this.productsService.remove(parseInput(productIdSchema, id));
  }
}
