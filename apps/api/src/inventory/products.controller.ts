import { BadRequestException, Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import {
  createProductLinkSchema,
  externalProductQuerySchema,
  productIdSchema,
  productListQuerySchema,
} from '@sevale/validation';
import type { ZodType } from 'zod';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { ProductLinkService } from './product-link.service.js';
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

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.productsService.detail(parseInput(productIdSchema, id));
  }
}
