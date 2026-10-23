import type { Product } from '../generated/prisma/client.js';
import { createXlsxWorkbook, type XlsxCell, type XlsxColumn } from '../common/xlsx.js';

const columns: XlsxColumn[] = [
  { header: 'SKU', width: 24 },
  { header: 'Nombre', width: 42 },
  { header: 'Tienda', width: 14 },
  { header: 'Precio COP', width: 18 },
  { header: 'Precio USD', width: 18 },
  { header: 'Stock', width: 12 },
];

function productRow(product: Product): XlsxCell[] {
  return [
    product.sku,
    product.productName,
    product.store === 'PALI' ? 'Pali' : 'Seratus',
    Number(product.siigoPriceCop),
    Number(product.siigoPriceUsd),
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
