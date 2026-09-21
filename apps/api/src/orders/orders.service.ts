import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomInt } from 'node:crypto';
import type {
  CreateSiigoQuotationInput,
  CreateOrderOperationInput,
  OrderListQuery,
  UpdateShipmentInput,
  UpdateOrderOperationInput,
} from '@sevale/validation';
import { Prisma, type Product, type Store } from '../generated/prisma/client.js';
import { OrdersRepository, type OrderOperationDetail } from './orders.repository.js';
import type {
  PreparedOperation,
  PreparedOrderCoupon,
  PreparedOrderItem,
  PreparedStoreOrder,
} from './orders.types.js';
import { WooOrderOutboundService } from './woo-order-outbound.service.js';
import { ShipmentSyncService } from './shipment-sync.service.js';
import { SiigoQuotationService } from './siigo-quotation.service.js';
import { OrderEventPublisher } from './order-event-publisher.service.js';

type OperationInput = CreateOrderOperationInput;

function businessError(
  Exception: typeof BadRequestException | typeof ConflictException | typeof NotFoundException,
  code: string,
  message: string,
) {
  return new Exception({ success: false, error: { code, message } });
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function decimal(value: string | number | Prisma.Decimal): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function zero(): Prisma.Decimal {
  return decimal(0);
}

function sum(values: Prisma.Decimal[]): Prisma.Decimal {
  return values.reduce((total, value) => total.plus(value), zero());
}

function operationCode(date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Bogota',
    year: '2-digit',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(date)
    .reduce<Record<string, string>>((result, part) => {
      if (part.type !== 'literal') result[part.type] = part.value;
      return result;
    }, {});
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
  const random = Array.from({ length: 4 }, () => alphabet[randomInt(alphabet.length)]).join('');
  return `OP${parts.year}${parts.month}${parts.day}${parts.hour}${parts.minute}${parts.second}${random}`;
}

function money(value: Prisma.Decimal): string {
  return value.toFixed(2);
}

function serializeItem(item: OrderOperationDetail['orders'][number]['items'][number]) {
  return {
    ...item,
    originalPrice: item.originalPrice ? money(item.originalPrice) : null,
    unitPrice: money(item.unitPrice),
    subtotal: money(item.subtotal),
    discountTotal: money(item.discountTotal),
    total: money(item.total),
  };
}

function serializeDetail(operation: OrderOperationDetail) {
  return {
    ...operation,
    subtotal: money(operation.subtotal),
    discountTotal: money(operation.discountTotal),
    shippingTotal: money(operation.shippingTotal),
    total: money(operation.total),
    orders: operation.orders.map((order) => ({
      ...order,
      wooOrderId: order.wooOrderId?.toString() ?? null,
      subtotal: money(order.subtotal),
      discountTotal: money(order.discountTotal),
      shippingTotal: money(order.shippingTotal),
      total: money(order.total),
      items: order.items.map(serializeItem),
      coupons: order.coupons.map((coupon) => ({
        ...coupon,
        discountTotal: money(coupon.discountTotal),
      })),
    })),
    siigoQuotation: operation.siigoQuotation
      ? {
          ...operation.siigoQuotation,
          exchangeRate: operation.siigoQuotation.exchangeRate
            ? operation.siigoQuotation.exchangeRate.toFixed(6)
            : null,
        }
      : null,
  };
}

@Injectable()
export class OrdersService {
  constructor(
    private readonly orders: OrdersRepository,
    private readonly outbound: WooOrderOutboundService,
    private readonly shipmentSync: ShipmentSyncService,
    private readonly siigoQuotation: SiigoQuotationService,
    private readonly events: OrderEventPublisher,
  ) {}

  async list(query: OrderListQuery) {
    const [orders, total] = await this.orders.list(query);
    return {
      data: orders.map(({ operation, ...order }) => ({
        ...order,
        operationId: operation.id,
        operationCode: operation.operationCode,
        source: operation.source,
        status: operation.status,
        currency: operation.currency,
        createdAt: operation.createdAt,
        updatedAt: operation.updatedAt,
        customer: operation.customer,
        wooOrderId: order.wooOrderId?.toString() ?? null,
        subtotal: money(order.subtotal),
        discountTotal: money(order.discountTotal),
        shippingTotal: money(order.shippingTotal),
        total: money(order.total),
      })),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async detail(id: number) {
    const operation = await this.orders.detail(id);
    if (!operation) {
      throw businessError(NotFoundException, 'ORDER_NOT_FOUND', 'La operación no existe.');
    }
    return serializeDetail(operation);
  }

  async create(input: CreateOrderOperationInput, createdByUserId: string) {
    const prepared = await this.prepare(input);
    for (let attempt = 0; attempt < 5; attempt += 1) {
      try {
        const operation = await this.orders.create(operationCode(), createdByUserId, prepared);
        await this.events.operationCreated(operation);
        return serializeDetail(operation);
      } catch (error) {
        if (isUniqueConstraintError(error) && attempt < 4) continue;
        throw error;
      }
    }
    throw businessError(
      ConflictException,
      'ORDER_CODE_CONFLICT',
      'No fue posible generar un código único para la operación.',
    );
  }

  async update(id: number, input: UpdateOrderOperationInput) {
    const prepared = await this.prepare(input);
    const result = await this.orders.updatePending(id, prepared);
    if (result.outcome === 'NOT_FOUND') {
      throw businessError(NotFoundException, 'ORDER_NOT_FOUND', 'La operación no existe.');
    }
    if (result.outcome === 'NOT_EDITABLE') {
      throw businessError(
        ConflictException,
        'ORDER_NOT_EDITABLE',
        'Solo las operaciones pendientes pueden editarse.',
      );
    }
    this.events.operationUpdated(result.operation);
    return serializeDetail(result.operation);
  }

  async retryShipmentSync(id: number) {
    const operation = await this.orders.detail(id);
    if (!operation) {
      throw businessError(NotFoundException, 'ORDER_NOT_FOUND', 'La operación no existe.');
    }
    if (!operation.shipment) {
      throw businessError(
        ConflictException,
        'SHIPMENT_NOT_FOUND',
        'La operación todavía no tiene información de envío.',
      );
    }
    const synchronized = await this.shipmentSync.synchronize(operation.shipment.id, true);
    if (!synchronized) {
      throw businessError(
        ConflictException,
        'SHIPMENT_SYNC_NOT_REQUIRED',
        'El envío no tiene integraciones con error pendientes de reintento.',
      );
    }
    const updated = await this.orders.detail(id);
    if (!updated)
      throw businessError(NotFoundException, 'ORDER_NOT_FOUND', 'La operación no existe.');
    await this.events.shipmentUpdated(updated, false);
    return serializeDetail(updated);
  }

  async createSiigoQuotation(id: number, input: CreateSiigoQuotationInput) {
    const claim = await this.orders.claimSiigoQuotation(id, input.exchangeRate);
    if (claim.outcome === 'NOT_FOUND') {
      throw businessError(NotFoundException, 'ORDER_NOT_FOUND', 'La operación no existe.');
    }
    if (claim.outcome === 'NOT_ALLOWED') {
      throw businessError(
        ConflictException,
        'SIIGO_QUOTATION_NOT_ALLOWED',
        'No puedes crear una cotización para una operación cancelada.',
      );
    }
    if (claim.outcome === 'IN_PROGRESS') {
      throw businessError(
        ConflictException,
        'SIIGO_QUOTATION_IN_PROGRESS',
        'La cotización ya se está creando en Siigo.',
      );
    }
    if (claim.outcome === 'CLAIMED') {
      await this.siigoQuotation.synchronize(claim.quotationId);
      const updated = await this.orders.detail(id);
      if (!updated) {
        throw businessError(NotFoundException, 'ORDER_NOT_FOUND', 'La operación no existe.');
      }
      await this.events.siigoQuotationUpdated(updated);
      return serializeDetail(updated);
    }
    return this.detail(id);
  }

  async remove(id: number) {
    const result = await this.orders.softDelete(id);
    if (result.outcome === 'NOT_FOUND') {
      throw businessError(NotFoundException, 'ORDER_NOT_FOUND', 'La operación no existe.');
    }
    this.events.operationUpdated(result.operation);
    return serializeDetail(result.operation);
  }

  async complete(id: number) {
    const claim = await this.orders.claimCompletion(id);
    if (claim.outcome === 'NOT_FOUND') {
      throw businessError(NotFoundException, 'ORDER_NOT_FOUND', 'La operación no existe.');
    }
    if (claim.outcome === 'NOT_COMPLETABLE') {
      throw businessError(
        ConflictException,
        'ORDER_NOT_COMPLETABLE',
        'Solo una operación pendiente creada en el CRM puede completarse.',
      );
    }
    if (claim.outcome === 'CLAIMED') {
      await this.outbound.synchronize(claim.orderIds);
      const updated = await this.orders.detail(id);
      if (!updated) {
        throw businessError(NotFoundException, 'ORDER_NOT_FOUND', 'La operación no existe.');
      }
      await this.events.operationCompleted(updated);
      return serializeDetail(updated);
    }
    return this.detail(id);
  }

  async retrySync(id: number) {
    const claim = await this.orders.claimRetry(id);
    if (claim.outcome === 'NOT_FOUND') {
      throw businessError(NotFoundException, 'ORDER_NOT_FOUND', 'La operación no existe.');
    }
    if (claim.outcome === 'NOT_RETRYABLE') {
      throw businessError(
        ConflictException,
        'ORDER_SYNC_NOT_RETRYABLE',
        'Solo las operaciones completadas desde el CRM pueden reintentar la sincronización.',
      );
    }
    if (claim.outcome === 'NOTHING_TO_RETRY') {
      throw businessError(
        ConflictException,
        'ORDER_SYNC_NOT_REQUIRED',
        'La operación no tiene pedidos con error pendientes de reintento.',
      );
    }
    await this.outbound.synchronize(claim.orderIds);
    const updated = await this.orders.detail(id);
    if (!updated)
      throw businessError(NotFoundException, 'ORDER_NOT_FOUND', 'La operación no existe.');
    await this.events.syncUpdated(updated, claim.orderIds);
    return serializeDetail(updated);
  }

  async retryOrderSync(id: number) {
    const claim = await this.orders.claimOrderRetry(id);
    if (claim.outcome === 'NOT_FOUND') {
      throw businessError(NotFoundException, 'ORDER_NOT_FOUND', 'El pedido no existe.');
    }
    if (claim.outcome === 'NOT_RETRYABLE') {
      throw businessError(
        ConflictException,
        'ORDER_SYNC_NOT_RETRYABLE',
        'Solo los pedidos de operaciones completadas desde el CRM pueden reintentarse.',
      );
    }
    if (claim.outcome === 'NOTHING_TO_RETRY') {
      throw businessError(
        ConflictException,
        'ORDER_SYNC_NOT_REQUIRED',
        'Este pedido no tiene un error de sincronización pendiente.',
      );
    }
    await this.outbound.synchronize(claim.orderIds);
    const updated = await this.orders.detail(claim.operationId);
    if (!updated)
      throw businessError(NotFoundException, 'ORDER_NOT_FOUND', 'La operación no existe.');
    await this.events.syncUpdated(updated, claim.orderIds);
    return serializeDetail(updated);
  }

  async updateShipment(id: number, input: UpdateShipmentInput, actorId: string) {
    const result = await this.orders.updateShipment(id, input, actorId);
    if (result.outcome === 'NOT_FOUND') {
      throw businessError(NotFoundException, 'ORDER_NOT_FOUND', 'La operación no existe.');
    }
    if (result.outcome === 'NOT_ALLOWED') {
      throw businessError(
        ConflictException,
        'SHIPMENT_NOT_ALLOWED',
        'La operación todavía no permite asignar información de envío.',
      );
    }
    const shipmentId = result.operation.shipment?.id;
    if (shipmentId) await this.shipmentSync.synchronize(shipmentId);
    const updated = await this.orders.detail(id);
    if (!updated)
      throw businessError(NotFoundException, 'ORDER_NOT_FOUND', 'La operación no existe.');
    await this.events.shipmentUpdated(updated, true);
    return serializeDetail(updated);
  }

  private async prepare(input: OperationInput): Promise<PreparedOperation> {
    const [customer, products] = await Promise.all([
      this.orders.findCustomer(input.customerId),
      this.orders.findProducts(input.items.map(({ productId }) => productId)),
    ]);
    if (!customer) {
      throw businessError(NotFoundException, 'CUSTOMER_NOT_FOUND', 'El cliente no existe.');
    }
    if (products.length !== input.items.length) {
      throw businessError(
        NotFoundException,
        'PRODUCT_NOT_FOUND',
        'Uno o más productos no existen.',
      );
    }

    const productsById = new Map(products.map((product) => [product.id, product]));
    const itemsByStore = new Map<Store, PreparedOrderItem[]>();
    for (const item of input.items) {
      const product = productsById.get(item.productId);
      if (!product) continue;
      const preparedItem = this.prepareItem(product, item, input.currency);
      const current = itemsByStore.get(product.store) ?? [];
      current.push(preparedItem);
      itemsByStore.set(product.store, current);
    }

    const couponsByStore = new Map<Store, PreparedOrderCoupon[]>();
    for (const coupon of input.coupons) {
      if (!itemsByStore.has(coupon.store)) {
        throw businessError(
          BadRequestException,
          'ORDER_STORE_WITHOUT_ITEMS',
          `No puedes aplicar un cupón a ${coupon.store} porque no tiene productos.`,
        );
      }
      const current = couponsByStore.get(coupon.store) ?? [];
      current.push({ code: coupon.code, discountTotal: decimal(coupon.discountTotal) });
      couponsByStore.set(coupon.store, current);
    }

    const shippingByStore = new Map<Store, Prisma.Decimal>();
    for (const shipping of input.shippingTotals) {
      if (!itemsByStore.has(shipping.store)) {
        throw businessError(
          BadRequestException,
          'ORDER_STORE_WITHOUT_ITEMS',
          `No puedes asignar envío a ${shipping.store} porque no tiene productos.`,
        );
      }
      shippingByStore.set(shipping.store, decimal(shipping.total));
    }

    const storeOrders: PreparedStoreOrder[] = [...itemsByStore.entries()].map(([store, items]) => {
      const coupons = couponsByStore.get(store) ?? [];
      const subtotal = sum(items.map((item) => item.subtotal));
      const itemDiscount = sum(items.map((item) => item.discountTotal));
      const couponDiscount = sum(coupons.map((coupon) => coupon.discountTotal));
      if (!itemDiscount.equals(couponDiscount)) {
        throw businessError(
          BadRequestException,
          'ORDER_DISCOUNT_MISMATCH',
          `Los descuentos de los productos y cupones de ${store} no coinciden.`,
        );
      }
      const shippingTotal = shippingByStore.get(store) ?? zero();
      return {
        store,
        items,
        coupons,
        subtotal,
        discountTotal: itemDiscount,
        shippingTotal,
        total: subtotal.minus(itemDiscount).plus(shippingTotal),
      };
    });

    return {
      customerId: input.customerId,
      currency: input.currency,
      paymentMethod: input.paymentMethod,
      paymentMethodTitle: input.paymentMethodTitle,
      shippingMethod: input.shippingMethod,
      shippingMethodTitle: input.shippingMethodTitle,
      subtotal: sum(storeOrders.map((order) => order.subtotal)),
      discountTotal: sum(storeOrders.map((order) => order.discountTotal)),
      shippingTotal: sum(storeOrders.map((order) => order.shippingTotal)),
      total: sum(storeOrders.map((order) => order.total)),
      billingFirstName: input.billing.firstName,
      billingLastName: input.billing.lastName,
      billingCompany: input.billing.company,
      billingAddress1: input.billing.address1,
      billingAddress2: input.billing.address2,
      billingCity: input.billing.city,
      billingState: input.billing.state,
      billingPostcode: input.billing.postcode,
      billingCountry: input.billing.country?.toUpperCase() ?? null,
      billingEmail: input.billing.email,
      billingPhone: input.billing.phone,
      shippingFirstName: input.shipping.firstName,
      shippingLastName: input.shipping.lastName,
      shippingCompany: input.shipping.company,
      shippingAddress1: input.shipping.address1,
      shippingAddress2: input.shipping.address2,
      shippingCity: input.shipping.city,
      shippingState: input.shipping.state,
      shippingPostcode: input.shipping.postcode,
      shippingCountry: input.shipping.country?.toUpperCase() ?? null,
      shippingPhone: input.shipping.phone,
      orders: storeOrders,
    };
  }

  private prepareItem(
    product: Product,
    input: OperationInput['items'][number],
    currency: OperationInput['currency'],
  ): PreparedOrderItem {
    const originalPrice = currency === 'COP' ? product.wooPriceCop : product.wooPriceUsd;
    const unitPrice = input.unitPrice === undefined ? originalPrice : decimal(input.unitPrice);
    const subtotal = unitPrice.times(input.quantity);
    const discountTotal = decimal(input.discountTotal);
    if (discountTotal.greaterThan(subtotal)) {
      throw businessError(
        BadRequestException,
        'ORDER_DISCOUNT_EXCEEDS_SUBTOTAL',
        `El descuento de ${product.sku} supera el subtotal del producto.`,
      );
    }
    return {
      productId: product.id,
      skuSnapshot: product.sku,
      nameSnapshot: product.productName,
      storeSnapshot: product.store,
      quantity: input.quantity,
      originalPrice,
      unitPrice,
      priceModified: !unitPrice.equals(originalPrice),
      subtotal,
      discountTotal,
      total: subtotal.minus(discountTotal),
    };
  }
}
