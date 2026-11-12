import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Store, SyncStatus, type Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';
import { parseCsv } from '../common/csv.js';
import { pricesAndStockMatch, decimalOrNull } from './product-prices.js';

/** El CSV completo del inventario: la unión de Siigo y WooCommerce, con catorce columnas fijas. */
const INVENTORY_HEADERS = [
  'siigo_id',
  'sku',
  'siigo_price_cop',
  'siigo_price_usd',
  'siigo_stock',
  'store',
  'woo_parent_id',
  'woo_variation_id',
  'woo_sku',
  'woo_price_cop',
  'woo_price_usd',
  'woo_stock',
  'product_name',
  'image_url',
] as const;

/**
 * El CSV de monedas nuevas: solo lo que falta por cargar. COP y USD ya se sincronizan por n8n, así
 * que este archivo no los lleva y nunca los toca.
 */
const CURRENCY_HEADERS = ['sku', 'siigo_price_mxn', 'siigo_price_eur'] as const;

const MAX_REPORTED_ISSUES = 50;
const QUERY_CHUNK_SIZE = 500;
const INSERT_CHUNK_SIZE = 250;
const UPDATE_CHUNK_SIZE = 250;

type InventoryCsvRow = Record<(typeof INVENTORY_HEADERS)[number], string>;
type CurrencyCsvRow = Record<(typeof CURRENCY_HEADERS)[number], string>;

type ImportProduct = {
  row: number;
  data: Prisma.ProductUncheckedCreateInput;
};

type CurrencyPrice = {
  row: number;
  sku: string;
  siigoPriceMxn: number;
  siigoPriceEur: number;
};

type ImportIssue = {
  row: number;
  field: string;
  message: string;
};

export type ProductImportMode = 'INVENTORY' | 'CURRENCIES';

export type ProductImportPreview = {
  /** El modo lo decide la cabecera del archivo; el formulario rotula las cifras con él. */
  mode: ProductImportMode;
  totalRows: number;
  validRows: number;
  newProducts: number;
  existingProducts: number;
  /** Solo en el modo CURRENCIES: filas cuyo SKU no existe en el CRM y se omiten. */
  skippedUnknown: number;
  errorCount: number;
  conflictCount: number;
  errors: ImportIssue[];
  conflicts: ImportIssue[];
  canImport: boolean;
};

function numberValue(value: string, field: string, integer = false): number {
  if (!value.trim()) throw new Error(`${field} es obligatorio.`);
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed < 0 || (integer && !Number.isInteger(parsed))) {
    throw new Error(`${field} debe ser un número ${integer ? 'entero ' : ''}no negativo.`);
  }
  return parsed;
}

function idValue(value: string, field: string, required: true): bigint;
function idValue(value: string, field: string, required: false): bigint | null;
function idValue(value: string, field: string, required: boolean): bigint | null {
  const normalized = value.trim();
  if (!normalized && !required) return null;
  if (!/^\d+$/.test(normalized) || BigInt(normalized) <= 0n) {
    throw new Error(`${field} debe ser un identificador entero positivo.`);
  }
  return BigInt(normalized);
}

function requiredText(value: string, field: string, maxLength: number): string {
  const normalized = value.trim();
  if (!normalized) throw new Error(`${field} es obligatorio.`);
  if (normalized.length > maxLength) {
    throw new Error(`${field} supera el máximo de ${maxLength} caracteres.`);
  }
  return normalized;
}

function nullableUrl(value: string): string | null {
  const normalized = value.trim();
  if (!normalized) return null;
  const url = new URL(normalized);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('image_url no es una URL web.');
  return url.toString();
}

function calculateSyncStatus(row: InventoryCsvRow): SyncStatus {
  // El CSV de inventario no trae MXN ni EUR, así que ambos lados quedan nulos y no alteran el estado.
  return pricesAndStockMatch(
    {
      priceCop: Number(row.siigo_price_cop),
      priceUsd: Number(row.siigo_price_usd),
      priceMxn: null,
      priceEur: null,
    },
    {
      priceCop: Number(row.woo_price_cop),
      priceUsd: Number(row.woo_price_usd),
      priceMxn: null,
      priceEur: null,
    },
    Number(row.siigo_stock),
    Number(row.woo_stock),
  )
    ? SyncStatus.SYNCED
    : SyncStatus.OUT_OF_SYNC;
}

function chunks<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

@Injectable()
export class ProductImportService {
  constructor(private readonly prisma: PrismaService) {}

  status() {
    return { enabled: this.isEnabled() };
  }

  async preview(csv: string): Promise<ProductImportPreview> {
    this.assertEnabled();
    const file = this.read(csv);
    if (file.mode === 'CURRENCIES') {
      const currencies = this.parseCurrencies(file.rows);
      return this.compareCurrenciesWithDatabase(
        currencies.prices,
        currencies.errors,
        currencies.totalRows,
      );
    }
    const inventory = this.parseInventory(file.rows);
    return this.compareWithDatabase(inventory.products, inventory.errors, inventory.totalRows);
  }

  async import(csv: string) {
    this.assertEnabled();
    const file = this.read(csv);
    if (file.mode === 'CURRENCIES') return this.importCurrencies(file.rows);

    const parsed = this.parseInventory(file.rows);
    const preview = await this.compareWithDatabase(
      parsed.products,
      parsed.errors,
      parsed.totalRows,
    );
    if (!preview.canImport) {
      throw new UnprocessableEntityException({
        success: false,
        error: {
          code: 'PRODUCT_IMPORT_INVALID',
          message: 'El archivo cambió o contiene conflictos. Ejecuta nuevamente la vista previa.',
          preview,
        },
      });
    }

    const existingIds = await this.findExisting(parsed.products);
    const newProducts = parsed.products.filter(
      ({ data }) => !existingIds.siigoIds.has(String(data.siigoId)),
    );
    await this.prisma.$transaction(
      async (transaction) => {
        for (const group of chunks(newProducts, INSERT_CHUNK_SIZE)) {
          await transaction.product.createMany({ data: group.map(({ data }) => data) });
        }
      },
      { maxWait: 5_000, timeout: 30_000 },
    );
    return {
      success: true,
      mode: 'INVENTORY' as const,
      totalRows: parsed.totalRows,
      imported: newProducts.length,
      updated: 0,
      skipped: parsed.products.length - newProducts.length,
    };
  }

  /**
   * El CSV de monedas solo actualiza: los SKU que no existen se omiten en lugar de crear el
   * producto, porque sin los datos de las tiendas la fila quedaría incompleta. El estado no se
   * fuerza: la comparación de las cuatro monedas lo deja en desactualizado mientras WooCommerce no
   * tenga MXN y EUR, y vuelve a sincronizado cuando n8n los confirme.
   */
  private async importCurrencies(rows: string[][]) {
    const parsed = this.parseCurrencies(rows);
    const preview = await this.compareCurrenciesWithDatabase(
      parsed.prices,
      parsed.errors,
      parsed.totalRows,
    );
    if (!preview.canImport) {
      throw new UnprocessableEntityException({
        success: false,
        error: {
          code: 'PRODUCT_IMPORT_INVALID',
          message: 'El archivo cambió o no tiene SKU por actualizar. Repite la vista previa.',
          preview,
        },
      });
    }

    const targets = await this.findCurrencyTargets(parsed.prices);
    await this.prisma.$transaction(
      async (transaction) => {
        for (const group of chunks(targets, UPDATE_CHUNK_SIZE)) {
          await transaction.$transaction(
            group.map((target) =>
              transaction.product.update({
                where: { id: target.id },
                data: {
                  siigoPriceMxn: target.siigoPriceMxn,
                  siigoPriceEur: target.siigoPriceEur,
                  syncStatus: target.syncStatus,
                },
              }),
            ),
          );
        }
      },
      { maxWait: 5_000, timeout: 30_000 },
    );
    return {
      success: true,
      mode: 'CURRENCIES' as const,
      totalRows: parsed.totalRows,
      imported: 0,
      updated: targets.length,
      skipped: parsed.prices.length - targets.length,
    };
  }

  private isEnabled(): boolean {
    return process.env.PRODUCT_IMPORT_ENABLED?.trim().toLowerCase() === 'true';
  }

  private assertEnabled() {
    if (!this.isEnabled()) {
      throw new NotFoundException({
        success: false,
        error: { code: 'PRODUCT_IMPORT_DISABLED', message: 'La importación no está habilitada.' },
      });
    }
  }

  /**
   * Lee el archivo y decide el formato por su cabecera. Las dos son fijas y no se solapan, así que
   * no hay ambigüedad posible; un archivo con otra cabecera se rechaza diciendo cuáles se aceptan.
   */
  private read(csv: string): { mode: ProductImportMode; rows: string[][] } {
    let rows: string[][];
    try {
      rows = parseCsv(csv);
    } catch (error) {
      throw new BadRequestException({
        success: false,
        error: {
          code: 'INVALID_CSV',
          message: error instanceof Error ? error.message : 'El CSV no se pudo leer.',
        },
      });
    }
    if (rows.length < 2) {
      throw new BadRequestException({
        success: false,
        error: { code: 'EMPTY_CSV', message: 'El archivo no contiene productos.' },
      });
    }

    const headerRow = rows[0] as string[];
    const headers = headerRow.map((header, index) =>
      index === 0 ? header.replace(/^\uFEFF/, '').trim() : header.trim(),
    );
    const mode = importMode(headers);
    if (!mode) {
      throw new BadRequestException({
        success: false,
        error: {
          code: 'INVALID_CSV_HEADERS',
          message:
            'Las columnas no coinciden con ninguno de los formatos aceptados. ' +
            `Inventario: ${INVENTORY_HEADERS.join(', ')}. ` +
            `Monedas: ${CURRENCY_HEADERS.join(', ')}.`,
        },
      });
    }
    return { mode, rows: rows.slice(1).filter((values) => values.some((value) => value.trim())) };
  }

  private parseCurrencies(dataRows: string[][]) {
    const prices: CurrencyPrice[] = [];
    const errors: ImportIssue[] = [];
    const seenSkus = new Map<string, number>();

    dataRows.forEach((values, index) => {
      const rowNumber = index + 2;
      if (values.length !== CURRENCY_HEADERS.length) {
        errors.push({
          row: rowNumber,
          field: 'fila',
          message: `Se esperaban ${CURRENCY_HEADERS.length} columnas y se encontraron ${values.length}.`,
        });
        return;
      }
      const row = Object.fromEntries(
        CURRENCY_HEADERS.map((header, column) => [header, values[column]]),
      ) as CurrencyCsvRow;
      try {
        const sku = requiredText(row.sku, 'sku', 191);
        const skuKey = sku.toLocaleUpperCase('es-CO');
        const previousRow = seenSkus.get(skuKey);
        if (previousRow) throw new Error(`sku está repetido desde la fila ${previousRow}.`);
        seenSkus.set(skuKey, rowNumber);
        prices.push({
          row: rowNumber,
          sku,
          siigoPriceMxn: numberValue(row.siigo_price_mxn, 'siigo_price_mxn'),
          siigoPriceEur: numberValue(row.siigo_price_eur, 'siigo_price_eur'),
        });
      } catch (error) {
        errors.push({
          row: rowNumber,
          field: 'datos',
          message: error instanceof Error ? error.message : 'La fila no es válida.',
        });
      }
    });
    return { prices, errors, totalRows: dataRows.length };
  }

  private parseInventory(dataRows: string[][]) {
    const products: ImportProduct[] = [];
    const errors: ImportIssue[] = [];
    const seenSiigoIds = new Map<string, number>();
    const seenSkus = new Map<string, number>();

    dataRows.forEach((values, index) => {
      const rowNumber = index + 2;
      if (values.length !== INVENTORY_HEADERS.length) {
        errors.push({
          row: rowNumber,
          field: 'fila',
          message: `Se esperaban ${INVENTORY_HEADERS.length} columnas y se encontraron ${values.length}.`,
        });
        return;
      }
      const row = Object.fromEntries(
        INVENTORY_HEADERS.map((header, column) => [header, values[column]]),
      ) as InventoryCsvRow;
      try {
        const siigoId = requiredText(row.siigo_id, 'siigo_id', 191);
        const sku = requiredText(row.sku, 'sku', 191);
        const skuKey = sku.toLocaleUpperCase('es-CO');
        const previousSiigoRow = seenSiigoIds.get(siigoId);
        const previousSkuRow = seenSkus.get(skuKey);
        if (previousSiigoRow)
          throw new Error(`siigo_id está repetido desde la fila ${previousSiigoRow}.`);
        if (previousSkuRow) throw new Error(`sku está repetido desde la fila ${previousSkuRow}.`);
        seenSiigoIds.set(siigoId, rowNumber);
        seenSkus.set(skuKey, rowNumber);

        const normalizedStore = row.store.trim().toUpperCase();
        if (normalizedStore !== Store.PALI && normalizedStore !== Store.SERATUS) {
          throw new Error('store debe ser PALI o SERATUS.');
        }
        const sourceParentId = idValue(row.woo_parent_id, 'woo_parent_id', true);
        const sourceVariationId = row.woo_variation_id.trim();
        const isSimpleProduct = sourceVariationId === '0';
        const wooVariationId = isSimpleProduct
          ? sourceParentId
          : idValue(sourceVariationId, 'woo_variation_id', true);
        products.push({
          row: rowNumber,
          data: {
            siigoId,
            sku,
            siigoPriceCop: numberValue(row.siigo_price_cop, 'siigo_price_cop'),
            siigoPriceUsd: numberValue(row.siigo_price_usd, 'siigo_price_usd'),
            siigoStock: numberValue(row.siigo_stock, 'siigo_stock', true),
            store: normalizedStore,
            wooParentId: isSimpleProduct ? null : sourceParentId,
            wooVariationId,
            wooSku: requiredText(row.woo_sku, 'woo_sku', 191),
            wooPriceCop: numberValue(row.woo_price_cop, 'woo_price_cop'),
            wooPriceUsd: numberValue(row.woo_price_usd, 'woo_price_usd'),
            wooStock: numberValue(row.woo_stock, 'woo_stock', true),
            syncStatus: calculateSyncStatus(row),
            productName: requiredText(row.product_name, 'product_name', 255),
            imageUrl: nullableUrl(row.image_url),
            lastCheckAt: null,
            lastSyncAt: null,
          },
        });
      } catch (error) {
        errors.push({
          row: rowNumber,
          field: 'datos',
          message: error instanceof Error ? error.message : 'La fila no es válida.',
        });
      }
    });
    return { products, errors, totalRows: dataRows.length };
  }

  private async findExisting(products: ImportProduct[]) {
    const records: { siigoId: string; sku: string }[] = [];
    for (const group of chunks(products, QUERY_CHUNK_SIZE)) {
      records.push(
        ...(await this.prisma.product.findMany({
          where: {
            OR: [
              { siigoId: { in: group.map(({ data }) => String(data.siigoId)) } },
              { sku: { in: group.map(({ data }) => String(data.sku)) } },
            ],
          },
          select: { siigoId: true, sku: true },
        })),
      );
    }
    return {
      records,
      siigoIds: new Set(records.map((record) => record.siigoId)),
    };
  }

  private async compareWithDatabase(
    products: ImportProduct[],
    errors: ImportIssue[],
    totalRows: number,
  ): Promise<ProductImportPreview> {
    const { records } = await this.findExisting(products);
    const bySiigoId = new Map(records.map((record) => [record.siigoId, record]));
    const bySku = new Map(records.map((record) => [record.sku.toLocaleUpperCase('es-CO'), record]));
    const conflicts: ImportIssue[] = [];
    let existingProducts = 0;

    for (const product of products) {
      const siigoId = String(product.data.siigoId);
      const sku = String(product.data.sku);
      const byId = bySiigoId.get(siigoId);
      const byProductSku = bySku.get(sku.toLocaleUpperCase('es-CO'));
      if (!byId && !byProductSku) continue;
      if (byId?.sku.toLocaleUpperCase('es-CO') === sku.toLocaleUpperCase('es-CO')) {
        existingProducts += 1;
        continue;
      }
      conflicts.push({
        row: product.row,
        field: byId ? 'siigo_id' : 'sku',
        message: byId
          ? `El ID de Siigo ya pertenece al SKU ${byId.sku}.`
          : `El SKU ya pertenece al ID de Siigo ${byProductSku?.siigoId}.`,
      });
    }

    return {
      mode: 'INVENTORY',
      totalRows,
      validRows: products.length,
      newProducts: products.length - existingProducts - conflicts.length,
      existingProducts,
      skippedUnknown: 0,
      errorCount: errors.length,
      conflictCount: conflicts.length,
      errors: errors.slice(0, MAX_REPORTED_ISSUES),
      conflicts: conflicts.slice(0, MAX_REPORTED_ISSUES),
      canImport: errors.length === 0 && conflicts.length === 0 && products.length > 0,
    };
  }

  /** Lee los productos que el archivo de monedas va a actualizar, con lo necesario para el estado. */
  private async findCurrencyTargets(prices: CurrencyPrice[]) {
    const records = [];
    for (const group of chunks(prices, QUERY_CHUNK_SIZE)) {
      records.push(
        ...(await this.prisma.product.findMany({
          where: { sku: { in: group.map(({ sku }) => sku) } },
          select: {
            id: true,
            sku: true,
            siigoPriceCop: true,
            siigoPriceUsd: true,
            wooPriceCop: true,
            wooPriceUsd: true,
            wooPriceMxn: true,
            wooPriceEur: true,
            siigoStock: true,
            wooStock: true,
          },
        })),
      );
    }
    const bySku = new Map(records.map((record) => [record.sku.toLocaleUpperCase('es-CO'), record]));
    return prices.flatMap((price) => {
      const record = bySku.get(price.sku.toLocaleUpperCase('es-CO'));
      if (!record) return [];
      const siigo = {
        priceCop: Number(record.siigoPriceCop),
        priceUsd: Number(record.siigoPriceUsd),
        priceMxn: price.siigoPriceMxn,
        priceEur: price.siigoPriceEur,
      };
      const store = {
        priceCop: Number(record.wooPriceCop),
        priceUsd: Number(record.wooPriceUsd),
        priceMxn: decimalOrNull(record.wooPriceMxn),
        priceEur: decimalOrNull(record.wooPriceEur),
      };
      return [
        {
          id: record.id,
          siigoPriceMxn: price.siigoPriceMxn,
          siigoPriceEur: price.siigoPriceEur,
          syncStatus: pricesAndStockMatch(siigo, store, record.siigoStock, record.wooStock)
            ? SyncStatus.SYNCED
            : SyncStatus.OUT_OF_SYNC,
        },
      ];
    });
  }

  private async compareCurrenciesWithDatabase(
    prices: CurrencyPrice[],
    errors: ImportIssue[],
    totalRows: number,
  ): Promise<ProductImportPreview> {
    const targets = await this.findCurrencyTargets(prices);
    return {
      mode: 'CURRENCIES',
      totalRows,
      validRows: prices.length,
      newProducts: 0,
      existingProducts: targets.length,
      skippedUnknown: prices.length - targets.length,
      errorCount: errors.length,
      conflictCount: 0,
      errors: errors.slice(0, MAX_REPORTED_ISSUES),
      conflicts: [],
      canImport: errors.length === 0 && targets.length > 0,
    };
  }
}

/** La cabecera del archivo decide el modo; una cabecera desconocida no coincide con ninguna. */
function importMode(headers: string[]): ProductImportMode | null {
  const matches = (expected: readonly string[]) =>
    headers.length === expected.length &&
    expected.every((header, index) => headers[index] === header);
  if (matches(INVENTORY_HEADERS)) return 'INVENTORY';
  if (matches(CURRENCY_HEADERS)) return 'CURRENCIES';
  return null;
}
