import { BadRequestException, Controller, Get, Param, Query } from '@nestjs/common';
import { externalProductQuerySchema, storeSchema } from '@sevale/validation';
import type { ZodType } from 'zod';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { SiigoService } from './siigo/siigo.service.js';
import { WooCommerceService } from './woocommerce/woocommerce.service.js';

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

@Controller('integrations')
@RequirePermissions('inventory.read')
export class IntegrationsController {
  constructor(
    private readonly siigoService: SiigoService,
    private readonly wooCommerceService: WooCommerceService,
  ) {}

  @Get('siigo/products')
  searchSiigo(@Query() query: unknown) {
    const { sku } = parseInput(externalProductQuerySchema, query);
    return this.siigoService.searchProductBySku(sku);
  }

  @Get('woocommerce/:store/products')
  searchWooCommerce(@Param('store') store: string, @Query() query: unknown) {
    const validatedStore = parseInput(storeSchema, store.toUpperCase());
    const { sku } = parseInput(externalProductQuerySchema, query);
    return this.wooCommerceService.searchProductBySku(validatedStore, sku);
  }
}
