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
import {
  resolveCouponType,
  resolvePaymentMethod,
  resolveShippingMethod,
  splitShippingCents,
  toShippingCents,
} from '@sevale/shared';
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

function roundMoney(value: Prisma.Decimal): Prisma.Decimal {
  return value.toDecimalPlaces(2);
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
    couponAmount: operation.couponAmount ? money(operation.couponAmount) : null,
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
    const result = await this.orders.delete(id);
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
    const paymentMethod = resolvePaymentMethod(input.paymentMethod);
    if (!paymentMethod) {
      throw businessError(
        BadRequestException,
        'ORDER_PAYMENT_METHOD_INVALID',
        'El método de pago seleccionado no es válido.',
      );
    }
    const shippingMethod = resolveShippingMethod(input.shippingMethod);
    if (!shippingMethod) {
      throw businessError(
        BadRequestException,
        'ORDER_SHIPPING_METHOD_INVALID',
        'El método de envío seleccionado no es válido.',
      );
    }

    const [customer, products, coupon] = await Promise.all([
      this.orders.findCustomer(input.customerId),
      this.orders.findProducts(input.items.map(({ productId }) => productId)),
      input.couponId ? this.orders.findCoupon(input.couponId) : Promise.resolve(null),
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
    if (input.couponId && !coupon) {
      throw businessError(
        BadRequestException,
        'ORDER_COUPON_NOT_AVAILABLE',
        'El cupón seleccionado no existe.',
      );
    }
    if (coupon && !resolveCouponType(coupon.type)) {
      throw businessError(
        BadRequestException,
        'ORDER_COUPON_TYPE_INVALID',
        'El tipo del cupón seleccionado no está permitido.',
      );
    }
    if (coupon && (coupon.amount.lessThanOrEqualTo(0) || coupon.amount.greaterThan(100))) {
      throw businessError(
        BadRequestException,
        'ORDER_COUPON_AMOUNT_INVALID',
        'El porcentaje del cupón seleccionado no es válido.',
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

    // El subtotal de la operación alimenta las reglas de envío (mínimos y umbrales) igual que antes.
    const subtotal = sum(
      [...itemsByStore.values()].flatMap((items) => items.map((item) => item.subtotal)),
    );
    const shippingTotal = this.shippingTotal(
      shippingMethod,
      input.currency,
      subtotal,
      input.customShippingTotal,
    );
    const shippingShares = splitShippingCents(
      toShippingCents(shippingTotal.toNumber()),
      itemsByStore.size,
    );

    const storeOrders: PreparedStoreOrder[] = [...itemsByStore.entries()].map(
      ([store, items], index) => {
        const storeSubtotal = sum(items.map((item) => item.subtotal));
        const couponEligibleSubtotal = sum(
          items
            .filter((item) => !item.unitPrice.lessThan(item.originalPrice))
            .map((item) => item.subtotal),
        );
        const discountTotal = coupon
          ? roundMoney(couponEligibleSubtotal.times(coupon.amount).dividedBy(100))
          : zero();
        const coupons: PreparedOrderCoupon[] = coupon
          ? [{ code: coupon.coupon, discountTotal }]
          : [];
        const shippingShare = decimal(shippingShares[index] ?? 0).dividedBy(100);
        return {
          store,
          items,
          coupons,
          subtotal: storeSubtotal,
          discountTotal,
          shippingTotal: shippingShare,
          total: storeSubtotal.minus(discountTotal).plus(shippingShare),
        };
      },
    );

    const discountTotal = sum(storeOrders.map((order) => order.discountTotal));

    return {
      customerId: input.customerId,
      currency: input.currency,
      paymentMethod: paymentMethod.payment_method,
      paymentMethodTitle: paymentMethod.payment_method_title,
      shippingMethod: shippingMethod.shipping_method,
      shippingMethodTitle: shippingMethod.shipping_method_title,
      couponId: coupon?.id ?? null,
      couponCode: coupon?.coupon ?? null,
      couponType: coupon?.type ?? null,
      couponAmount: coupon?.amount ?? null,
      subtotal,
      discountTotal,
      shippingTotal,
      total: subtotal.minus(discountTotal).plus(shippingTotal),
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

  private shippingTotal(
    method: NonNullable<ReturnType<typeof resolveShippingMethod>>,
    currency: OperationInput['currency'],
    subtotal: Prisma.Decimal,
    customShippingTotal: OperationInput['customShippingTotal'],
  ): Prisma.Decimal {
    if (method.shipping_method === 'custom') {
      if (customShippingTotal === null) {
        throw businessError(
          BadRequestException,
          'ORDER_CUSTOM_SHIPPING_REQUIRED',
          'Ingresa el valor del envío personalizado.',
        );
      }
      return decimal(customShippingTotal);
    }

    const rule = method.rules[currency];
    if (!rule) {
      throw businessError(
        BadRequestException,
        'ORDER_SHIPPING_RULE_NOT_FOUND',
        'No existe una regla de envío para la moneda seleccionada.',
      );
    }
    if (method.shipping_method === 'free_shipping') {
      const minimum = 'minimum_order_total' in rule ? rule.minimum_order_total : undefined;
      if (typeof minimum !== 'number' || subtotal.lessThan(minimum)) {
        throw businessError(
          BadRequestException,
          'ORDER_FREE_SHIPPING_NOT_AVAILABLE',
          'El subtotal de la operación no alcanza el mínimo para envío gratis.',
        );
      }
      return decimal(rule.shipping_total);
    }
    const maximum = 'maximum_order_total' in rule ? rule.maximum_order_total : undefined;
    if (typeof maximum !== 'number' || !subtotal.lessThan(maximum)) {
      throw businessError(
        BadRequestException,
        'ORDER_FLAT_RATE_NOT_AVAILABLE',
        'El subtotal de la operación corresponde a envío gratis.',
      );
    }
    return decimal(rule.shipping_total);
  }

  private prepareItem(
    product: Product,
    input: OperationInput['items'][number],
    currency: OperationInput['currency'],
  ): PreparedOrderItem {
    const originalPrice = currency === 'COP' ? product.wooPriceCop : product.wooPriceUsd;
    const unitPrice = input.unitPrice === undefined ? originalPrice : decimal(input.unitPrice);
    if (unitPrice.greaterThan(originalPrice)) {
      throw businessError(
        BadRequestException,
        'ORDER_ITEM_PRICE_EXCEEDS_ORIGINAL',
        `El precio de ${product.productName} no puede superar su valor original de ${money(originalPrice)}.`,
      );
    }
    const subtotal = unitPrice.times(input.quantity);
    const discountTotal = zero();
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
