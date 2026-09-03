import { BadRequestException, Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { siigoProductUpdateSchema } from '@sevale/validation';
import { Public } from '../../auth/public.decorator.js';
import { N8nApiKeyGuard } from './n8n-api-key.guard.js';
import { SiigoWebhookService } from './siigo-webhook.service.js';

@Controller('integrations/siigo')
export class SiigoWebhookController {
  constructor(private readonly webhookService: SiigoWebhookService) {}

  @Post('product')
  @HttpCode(200)
  @Public()
  @UseGuards(N8nApiKeyGuard)
  updateProduct(@Body() body: unknown) {
    const result = siigoProductUpdateSchema.safeParse(body);
    if (!result.success) {
      throw new BadRequestException({
        success: false,
        error: {
          code: 'VALIDATION_ERROR',
          message: result.error.issues[0]?.message || 'El payload de n8n no es válido.',
        },
      });
    }
    return this.webhookService.updateProduct(result.data);
  }
}
