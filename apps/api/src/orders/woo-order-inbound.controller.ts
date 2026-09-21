import { BadRequestException, Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { wooOrderInboundSchema } from '@sevale/validation';
import { Public } from '../auth/public.decorator.js';
import { N8nApiKeyGuard } from '../integrations/n8n/n8n-api-key.guard.js';
import { WooOrderInboundService } from './woo-order-inbound.service.js';

@Controller('integrations/woocommerce/orders')
export class WooOrderInboundController {
  constructor(private readonly inbound: WooOrderInboundService) {}

  @Post()
  @HttpCode(200)
  @Public()
  @UseGuards(N8nApiKeyGuard)
  receive(@Body() body: unknown) {
    const result = wooOrderInboundSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: result.error.issues[0]?.message || 'El pedido de WooCommerce no es válido.',
        },
      });
    }
    return this.inbound.receive(result.data);
  }
}
