import { HttpException, Injectable } from '@nestjs/common';
import { SiigoService } from '../integrations/siigo/siigo.service.js';
import { OrdersRepository, type SiigoQuotationJob } from './orders.repository.js';

class SiigoQuotationError extends Error {
  constructor(
    readonly code: string,
    message: string,
  ) {
    super(message);
  }
}

function bogotaDate(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((result, part) => {
      if (part.type !== 'literal') result[part.type] = part.value;
      return result;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function safeMessage(error: unknown): string {
  if (error instanceof SiigoQuotationError) return error.message;
  if (error instanceof HttpException) {
    const response: unknown = error.getResponse();
    if (typeof response === 'object' && response !== null && 'error' in response) {
      const detail = (response as { error?: unknown }).error;
      if (typeof detail === 'object' && detail !== null && 'message' in detail) {
        const message = (detail as { message?: unknown }).message;
        if (typeof message === 'string' && message.length <= 500) return message;
      }
    }
  }
  return 'Siigo no pudo crear la cotización.';
}

function errorCode(error: unknown): string {
  return error instanceof SiigoQuotationError ? error.code : 'SIIGO_QUOTATION_CREATE_FAILED';
}

function quotationInput(job: SiigoQuotationJob) {
  const operation = job.operation;
  const integration = operation.customer.integrations.find(({ provider }) => provider === 'SIIGO');
  if (!integration?.externalId) {
    throw new SiigoQuotationError(
      'SIIGO_CUSTOMER_NOT_LINKED',
      'El cliente todavía no está vinculado con Siigo.',
    );
  }
  const currency = operation.currency;
  if (currency !== 'COP' && currency !== 'USD') {
    throw new SiigoQuotationError(
      'SIIGO_CURRENCY_NOT_SUPPORTED',
      `Siigo no admite la moneda ${currency} para esta cotización.`,
    );
  }
  const supportedCurrency: 'COP' | 'USD' = currency;
  const exchangeRate = job.exchangeRate?.toNumber();
  if (currency === 'USD' && (!exchangeRate || exchangeRate <= 0)) {
    throw new SiigoQuotationError(
      'SIIGO_EXCHANGE_RATE_REQUIRED',
      'Indica una tasa de cambio válida para crear la cotización en dólares.',
    );
  }

  const items = operation.orders.flatMap((order) =>
    order.items.map((item) => {
      if (!item.product?.siigoId) {
        throw new SiigoQuotationError(
          'SIIGO_PRODUCT_NOT_LINKED',
          `El producto ${item.skuSnapshot} no tiene un vínculo válido con Siigo.`,
        );
      }
      return {
        productExternalId: item.product.siigoId,
        description: item.nameSnapshot,
        quantity: item.quantity,
        price: item.unitPrice.toNumber(),
        discountValue: item.discountTotal.toNumber(),
      };
    }),
  );
  if (items.length === 0) {
    throw new SiigoQuotationError(
      'SIIGO_QUOTATION_WITHOUT_ITEMS',
      'La operación no contiene productos para cotizar.',
    );
  }
  return {
    customerExternalId: integration.externalId,
    customerIdentification: operation.customer.documentNumber,
    currency: supportedCurrency,
    ...(exchangeRate ? { exchangeRate } : {}),
    date: bogotaDate(),
    items,
  };
}

@Injectable()
export class SiigoQuotationService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly siigo: SiigoService,
  ) {}

  async synchronize(quotationId: number): Promise<void> {
    const job = await this.orders.siigoQuotationJob(quotationId);
    if (!job) return;
    try {
      const result = await this.siigo.createQuotation(quotationInput(job));
      const confirmed = await this.orders.markSiigoQuotationSynced(job.id, result);
      if (confirmed.count !== 1) {
        await this.orders.markSiigoQuotationError(
          job.id,
          'SIIGO_QUOTATION_CONFIRMATION_FAILED',
          'Siigo creó la cotización, pero el CRM no pudo guardar su identificador.',
        );
      }
    } catch (error) {
      await this.orders.markSiigoQuotationError(job.id, errorCode(error), safeMessage(error));
    }
  }
}
