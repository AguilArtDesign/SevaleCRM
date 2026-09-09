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
} from '@nestjs/common';
import {
  bulkProductSyncSchema,
  createProductLinkSchema,
  externalProductQuerySchema,
  productIdSchema,
  productListQuerySchema,
  productSyncJobIdSchema,
} from '@sevale/validation';
import type { ZodType } from 'zod';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { ProductLinkService } from './product-link.service.js';
import { BulkProductSyncService } from './bulk-product-sync.service.js';
import { ProductsService } from './products.service.js';

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

  @Post(':id/sync')
  @RequirePermissions('inventory.update')
  sync(@Param('id') id: string) {
    return this.productsService.sync(parseInput(productIdSchema, id));
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
