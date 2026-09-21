import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import type { WooOrderInboundInput } from '@sevale/validation';
import { normalizeWooOrderInbound } from './woo-order-inbound.normalizer.js';
import { WooInboundError, WooOrderInboundRepository } from './woo-order-inbound.repository.js';
import { OrderEventPublisher } from './order-event-publisher.service.js';

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function errorDetails(error: unknown) {
  if (error instanceof WooInboundError) return { code: error.code, message: error.message };
  if (error instanceof BadRequestException) {
    const response = error.getResponse();
    if (typeof response === 'object' && response !== null && 'error' in response) {
      const detail = (response as { error?: { code?: unknown; message?: unknown } }).error;
      if (typeof detail?.code === 'string' && typeof detail.message === 'string') {
        return { code: detail.code, message: detail.message };
      }
    }
  }
  return {
    code: 'WOO_ORDER_IMPORT_FAILED',
    message: 'No pudimos importar el pedido de WooCommerce.',
  };
}

@Injectable()
export class WooOrderInboundService {
  private readonly logger = new Logger(WooOrderInboundService.name);

  constructor(
    private readonly repository: WooOrderInboundRepository,
    private readonly events: OrderEventPublisher,
  ) {}

  async receive(payload: WooOrderInboundInput) {
    const input = normalizeWooOrderInbound(payload);
    const claim = await this.repository.claim(input);
    if (claim.outcome === 'DUPLICATE') {
      return {
        success: true,
        duplicate: true,
        processing: false,
        operationId: claim.operationId,
        orderId: claim.delivery.orderId,
      };
    }
    if (claim.outcome === 'PROCESSING') {
      return {
        success: true,
        duplicate: true,
        processing: true,
        operationId: claim.operationId,
        orderId: claim.delivery.orderId,
      };
    }

    try {
      let imported;
      try {
        imported = await this.repository.import(input);
      } catch (error) {
        if (!isUniqueConstraintError(error)) throw error;
        imported = await this.repository.import(input);
      }
      if (!imported.stale) {
        await this.events.inboundImported(imported.operationId, input.store, imported.created);
      }
      return {
        success: true,
        duplicate: false,
        processing: false,
        ...imported,
      };
    } catch (error) {
      const detail = errorDetails(error);
      await this.repository.markError(input.deliveryId, detail.code, detail.message);
      if (!(error instanceof WooInboundError) && !(error instanceof BadRequestException)) {
        this.logger.error(`Woo inbound ${input.deliveryId}: ${String(error)}`);
      }
      throw new BadRequestException({ success: false, error: detail });
    }
  }
}
