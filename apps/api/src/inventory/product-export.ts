import type { Prisma, Product } from '../generated/prisma/client.js';
import { createXlsxWorkbook, type XlsxCell, type XlsxColumn } from '../common/xlsx.js';

const columns: XlsxColumn[] = [
  { header: 'SKU', width: 24 },
  { header: 'Nombre', width: 42 },
  { header: 'Tienda', width: 14 },
  { header: 'Precio COP', width: 18 },
  { header: 'Precio USD', width: 18 },
  { header: 'Precio MXN', width: 18 },
  { header: 'Precio EUR', width: 18 },
  { header: 'Stock', width: 12 },
];

function priceCell(value: Prisma.Decimal | null): XlsxCell {
  return value === null ? '' : Number(value);
}

function productRow(product: Product): XlsxCell[] {
  return [
    product.sku,
    product.productName,
    product.store === 'PALI' ? 'Pali' : 'Seratus',
    Number(product.siigoPriceCop),
    Number(product.siigoPriceUsd),
    priceCell(product.siigoPriceMxn),
    priceCell(product.siigoPriceEur),
    product.siigoStock,
  ];
}

export function createInventoryWorkbook(products: Product[]) {
  return createXlsxWorkbook({
    sheetName: 'Inventario',
    columns,
    rows: products.map(productRow),
  });
}
