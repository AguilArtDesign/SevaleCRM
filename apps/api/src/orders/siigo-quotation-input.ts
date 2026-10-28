import { customerDocumentTypes } from '@sevale/validation';
import type { SiigoQuotationCreateInput } from '../integrations/siigo/siigo.service.js';
import type { QuotationOperation, QuotationSeller } from './orders.repository.js';

/**
 * Tipo de cotización de Siigo. Es fijo para la cuenta, por eso no se descubre en cada envío.
 * Se lee del entorno al cotizar y no al importar el módulo, para que el arranque cargue antes el
 * archivo de variables.
 */
export function quotationDocumentId(): number {
  return positiveEnv('SIIGO_QUOTATION_DOCUMENT_ID', 8652);
}

/** Centro de costo que exige el comprobante de cotización. */
export function quotationCostCenter(): number {
  return positiveEnv('SIIGO_COST_CENTER_ID', 1388);
}

function positiveEnv(name: string, fallback: number): number {
  const value = Number(process.env[name]);
  return Number.isSafeInteger(value) && value > 0 ? value : fallback;
}

/** El envío viaja como un producto más, con este código ya creado en Siigo. */
export const quotationShippingCode = 'FLETES';

/**
 * Los precios del pedido ya traen el IVA incluido, pero el comprobante de Siigo espera el valor sin
 * impuestos y lo suma aparte, así que se divide para que el total de la cotización coincida con el
 * del pedido. Una cotización en dólares es de exportación: no lleva IVA y el precio pasa tal cual.
 */
const taxRules = {
  COP: { id: 4651, label: 'IVA 19%', divisor: 1.19 },
  USD: { id: 13882, label: 'Sin IVA (exportación)', divisor: 1 },
} as const;

/**
 * El flete es un servicio exento (producto FLETES en Siigo), así que su valor no se separa: se envía
 * tal como se cobró en el pedido, con el impuesto de 0 %.
 */
const shippingTaxId = 13882;

export type QuotationCurrency = keyof typeof taxRules;

export type QuotationIssue = { code: string; message: string };

export type QuotationPreviewItem = {
  kind: 'PRODUCT' | 'SHIPPING';
  code: string;
  description: string;
  quantity: number;
  /** Precio unitario del pedido, con IVA cuando la moneda es COP. */
  grossPrice: number;
  /** Precio unitario que recibe Siigo, sin IVA cuando la moneda es COP. */
  price: number;
  /** Descuento en porcentaje, como lo espera el comprobante. */
  discount: number;
  taxId: number;
  store: 'SERATUS' | 'PALI' | null;
};

export type QuotationPreview = {
  operationCode: string;
  currency: string;
  customer: {
    id: number;
    displayName: string;
    documentType: string;
    documentTypeLabel: string;
    documentNumber: string;
  };
  seller: { id: number | null; name: string; email: string };
  documentId: number;
  costCenter: number;
  tax: { id: number; label: string };
  exchangeRate: { required: boolean; value: number | null; validFrom: string | null };
  items: QuotationPreviewItem[];
  issues: QuotationIssue[];
};

export type QuotationDraft = {
  preview: QuotationPreview;
  input: SiigoQuotationCreateInput | null;
};

const documentTypeLabels = new Map<string, string>(
  customerDocumentTypes.map(({ value, label }) => [value, label] as const),
);

function round(value: number, decimals = 6): number {
  const factor = 10 ** decimals;
  return Math.round((value + Number.EPSILON) * factor) / factor;
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

function currencyRule(currency: string): (typeof taxRules)[QuotationCurrency] | null {
  return currency === 'COP' || currency === 'USD' ? taxRules[currency] : null;
}

/**
 * Estados de WooCommerce con el pedido todavía abierto. Completado, cancelado, reembolsado y fallido
 * ya cerraron el pedido, así que cotizarlos sería ofrecer algo que ya se vendió o se perdió.
 */
const quotableWooStatuses = new Set(['pending', 'processing', 'on-hold']);

/**
 * Un pedido del CRM que todavía no existe en WooCommerce no tiene estado de tienda: sigue pendiente
 * y la cotización se arma con los datos del CRM, así que no depende de la tienda.
 */
function hasOpenOrder(operation: QuotationOperation): boolean {
  return operation.orders.some((order) => {
    const wooStatus = order.wooStatus?.trim().toLocaleLowerCase('en') ?? '';
    if (!wooStatus) return operation.status === 'PENDING';
    return quotableWooStatuses.has(wooStatus);
  });
}

/**
 * Traduce la operación del CRM al documento que espera Siigo. El cupón del CRM es un porcentaje y
 * Siigo lo aplica por producto, así que se envía el mismo porcentaje a cada ítem. Un producto con
 * precio cambiado a mano queda fuera del cupón: viaja con su precio y sin descuento.
 */
export function buildQuotation(
  operation: QuotationOperation,
  options: {
    seller: QuotationSeller;
    exchangeRate: number | null;
    exchangeRateDate: string | null;
  },
): QuotationDraft {
  const issues: QuotationIssue[] = [];
  const rule = currencyRule(operation.currency);
  if (!rule) {
    issues.push({
      code: 'SIIGO_CURRENCY_NOT_SUPPORTED',
      message: `Siigo no admite la moneda ${operation.currency} para esta cotización.`,
    });
  }

  const integration = operation.customer.integrations.find(({ provider }) => provider === 'SIIGO');
  if (!integration?.externalId) {
    issues.push({
      code: 'SIIGO_CUSTOMER_NOT_LINKED',
      message: 'El cliente todavía no está vinculado con Siigo.',
    });
  }
  if (options.seller.id === null) {
    issues.push({
      code: 'SIIGO_SELLER_NOT_CONFIGURED',
      message: 'Tu usuario no tiene Seller ID de Siigo configurado.',
    });
  }
  const exchangeRate = operation.currency === 'USD' ? options.exchangeRate : null;
  if (operation.currency === 'USD' && (!exchangeRate || exchangeRate <= 0)) {
    issues.push({
      code: 'SIIGO_EXCHANGE_RATE_REQUIRED',
      message: 'No hay una TRM válida para crear la cotización en dólares.',
    });
  }

  const lines = operation.orders.flatMap((order) =>
    order.items.map((item) => ({ item, store: order.store })),
  );
  if (lines.length === 0) {
    issues.push({
      code: 'SIIGO_QUOTATION_WITHOUT_ITEMS',
      message: 'La operación no contiene productos para cotizar.',
    });
  }

  // La cotización solo tiene sentido mientras el pedido sigue abierto en la tienda. El panel aplica
  // la misma regla para esconder la acción; aquí se vuelve a comprobar porque la ruta se puede
  // llamar directamente. Basta con que un pedido de la operación siga abierto.
  if (!hasOpenOrder(operation)) {
    issues.push({
      code: 'SIIGO_QUOTATION_ORDER_CLOSED',
      message:
        'El pedido ya está cerrado en WooCommerce (completado, cancelado, reembolsado o fallido) y no se puede cotizar.',
    });
  }
  for (const { item } of lines) {
    if (!item.product?.sku) {
      issues.push({
        code: 'SIIGO_PRODUCT_NOT_LINKED',
        message: `El producto ${item.skuSnapshot} no tiene un vínculo válido con Siigo.`,
      });
    }
  }

  const divisor = rule?.divisor ?? 1;
  const tax = { id: rule?.id ?? 0, label: rule?.label ?? '' };
  const shippingTotal = operation.shippingTotal.toNumber();
  // El único tipo de cupón del CRM es porcentaje, así que el valor de la operación ya es el
  // porcentaje que se repite en cada producto.
  const couponPercent =
    operation.couponId !== null && operation.couponAmount
      ? round(operation.couponAmount.toNumber(), 2)
      : null;

  const previewItems: QuotationPreviewItem[] = lines.map((line) => {
    const gross = line.item.unitPrice.toNumber() * line.item.quantity;
    return {
      kind: 'PRODUCT',
      code: line.item.product?.sku ?? line.item.skuSnapshot,
      description: line.item.product?.productName ?? line.item.nameSnapshot,
      quantity: line.item.quantity,
      grossPrice: round(line.item.unitPrice.toNumber(), 2),
      price: round(line.item.unitPrice.toNumber() / divisor, 6),
      // Un pedido de WooCommerce puede traer un descuento por ítem sin cupón: en ese caso se
      // recupera el porcentaje que representa sobre su propio valor.
      discount: line.item.priceModified
        ? 0
        : (couponPercent ??
          (gross > 0 ? round((line.item.discountTotal.toNumber() / gross) * 100, 2) : 0)),
      taxId: rule?.id ?? 0,
      store: line.store,
    };
  });
  if (shippingTotal > 0) {
    previewItems.push({
      kind: 'SHIPPING',
      code: quotationShippingCode,
      description: 'Fletes',
      quantity: 1,
      grossPrice: round(shippingTotal, 2),
      // El flete no se descompone: el producto FLETES de Siigo es un servicio exento.
      price: round(shippingTotal, 2),
      discount: 0,
      taxId: shippingTaxId,
      store: null,
    });
  }

  const preview: QuotationPreview = {
    operationCode: operation.operationCode,
    currency: operation.currency,
    customer: {
      id: operation.customer.id,
      displayName: operation.customer.displayName,
      documentType: operation.customer.documentType,
      documentTypeLabel:
        documentTypeLabels.get(operation.customer.documentType) ?? operation.customer.documentType,
      documentNumber: operation.customer.documentNumber,
    },
    seller: options.seller,
    documentId: quotationDocumentId(),
    costCenter: quotationCostCenter(),
    tax,
    exchangeRate: {
      required: operation.currency === 'USD',
      value: exchangeRate,
      validFrom: operation.currency === 'USD' ? options.exchangeRateDate : null,
    },
    items: previewItems,
    issues,
  };

  if (issues.length > 0 || !rule || !integration?.externalId || options.seller.id === null) {
    return { preview, input: null };
  }
  return {
    preview,
    input: {
      documentId: quotationDocumentId(),
      costCenter: quotationCostCenter(),
      customerExternalId: integration.externalId,
      customerIdentification: operation.customer.documentNumber,
      sellerId: options.seller.id,
      currency: operation.currency as QuotationCurrency,
      ...(exchangeRate ? { exchangeRate } : {}),
      date: bogotaDate(),
      items: previewItems.map((item) => ({
        code: item.code,
        description: item.description,
        quantity: item.quantity,
        price: item.price,
        discountPercent: item.discount,
        taxId: item.taxId,
      })),
    },
  };
}
