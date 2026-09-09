import {
  BadRequestException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { Store, SyncStatus, type Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../database/prisma.service.js';

const EXPECTED_HEADERS = [
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

const MAX_REPORTED_ISSUES = 50;
const QUERY_CHUNK_SIZE = 500;
const INSERT_CHUNK_SIZE = 250;

type CsvRow = Record<(typeof EXPECTED_HEADERS)[number], string>;

type ImportProduct = {
  row: number;
  data: Prisma.ProductUncheckedCreateInput;
};

type ImportIssue = {
  row: number;
  field: string;
  message: string;
};

export type ProductImportPreview = {
  totalRows: number;
  validRows: number;
  newProducts: number;
  existingProducts: number;
  errorCount: number;
  conflictCount: number;
  errors: ImportIssue[];
  conflicts: ImportIssue[];
  canImport: boolean;
};

function parseCsv(csv: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < csv.length; index += 1) {
    const character = csv[index];
    if (quoted) {
      if (character === '"') {
        if (csv[index + 1] === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"' && field.length === 0) quoted = true;
    else if (character === ',') {
      row.push(field);
      field = '';
    } else if (character === '\n') {
      row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
      rows.push(row);
      row = [];
      field = '';
    } else field += character;
  }

  if (quoted) throw new Error('Hay un campo entre comillas que no fue cerrado.');
  if (field.length > 0 || row.length > 0) {
    row.push(field.endsWith('\r') ? field.slice(0, -1) : field);
    rows.push(row);
  }
  return rows;
}

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

function calculateSyncStatus(row: CsvRow): SyncStatus {
  return Number(row.siigo_price_cop) === Number(row.woo_price_cop) &&
    Number(row.siigo_price_usd) === Number(row.woo_price_usd) &&
    Number(row.siigo_stock) === Number(row.woo_stock)
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
    const parsed = this.parse(csv);
    return this.compareWithDatabase(parsed.products, parsed.errors, parsed.totalRows);
  }

  async import(csv: string) {
    this.assertEnabled();
    const parsed = this.parse(csv);
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
      totalRows: parsed.totalRows,
      imported: newProducts.length,
      skipped: parsed.products.length - newProducts.length,
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

  private parse(csv: string) {
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
    if (
      headers.length !== EXPECTED_HEADERS.length ||
      EXPECTED_HEADERS.some((header, index) => headers[index] !== header)
    ) {
      throw new BadRequestException({
        success: false,
        error: {
          code: 'INVALID_CSV_HEADERS',
          message: `Las columnas deben estar en este orden: ${EXPECTED_HEADERS.join(', ')}.`,
        },
      });
    }

    const products: ImportProduct[] = [];
    const errors: ImportIssue[] = [];
    const seenSiigoIds = new Map<string, number>();
    const seenSkus = new Map<string, number>();
    const dataRows = rows.slice(1).filter((values) => values.some((value) => value.trim()));

    dataRows.forEach((values, index) => {
      const rowNumber = index + 2;
      if (values.length !== EXPECTED_HEADERS.length) {
        errors.push({
          row: rowNumber,
          field: 'fila',
          message: `Se esperaban ${EXPECTED_HEADERS.length} columnas y se encontraron ${values.length}.`,
        });
        return;
      }
      const row = Object.fromEntries(
        headers.map((header, column) => [header, values[column]]),
      ) as CsvRow;
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
      totalRows,
      validRows: products.length,
      newProducts: products.length - existingProducts - conflicts.length,
      existingProducts,
      errorCount: errors.length,
      conflictCount: conflicts.length,
      errors: errors.slice(0, MAX_REPORTED_ISSUES),
      conflicts: conflicts.slice(0, MAX_REPORTED_ISSUES),
      canImport: errors.length === 0 && conflicts.length === 0 && products.length > 0,
    };
  }
}
