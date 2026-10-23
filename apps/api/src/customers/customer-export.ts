import { customerDocumentTypes } from '@sevale/validation';
import {
  resolveCustomerCityName,
  resolveCustomerCountryName,
  resolveCustomerRegionName,
} from '@sevale/shared';
import { createXlsxWorkbook, type XlsxCell, type XlsxColumn } from '../common/xlsx.js';
import type { CustomerWithIntegrations } from '../customers/customers.repository.js';

const columns: XlsxColumn[] = [
  { header: 'Nombres', width: 28 },
  { header: 'Apellidos', width: 28 },
  { header: 'Tipo de documento', width: 26 },
  { header: 'Número de documento', width: 22 },
  { header: 'Teléfono', width: 20 },
  { header: 'Correo electrónico', width: 34 },
  { header: 'País', width: 22 },
  { header: 'Región / Provincia', width: 26 },
  { header: 'Ciudad', width: 24 },
  { header: 'Código postal', width: 16 },
  { header: 'Dirección 1', width: 38 },
  { header: 'Dirección 2', width: 30 },
];

const documentTypeLabels = new Map<string, string>(
  customerDocumentTypes.map(({ value, label }) => [value, label] as const),
);

/**
 * El archivo se lee en Excel, no en otra integración, así que todo va como texto legible: los
 * nombres de país, región y ciudad se resuelven con el mismo catálogo que usa la interfaz en lugar
 * de exportar los códigos internos. El teléfono ya está en E.164 en la base.
 */
function customerRow(customer: CustomerWithIntegrations): XlsxCell[] {
  return [
    customer.firstName ?? '',
    customer.lastName ?? '',
    documentTypeLabels.get(customer.documentType) ?? customer.documentType,
    customer.documentNumber,
    customer.phone ?? '',
    customer.email ?? '',
    resolveCustomerCountryName(customer.country) ?? '',
    resolveCustomerRegionName(customer.country, customer.region) ?? '',
    resolveCustomerCityName(
      customer.country,
      customer.region,
      customer.cityCode,
      customer.cityName,
    ) ?? '',
    customer.postalCode ?? '',
    customer.addressLine1 ?? '',
    customer.addressLine2 ?? '',
  ];
}

export function createCustomersWorkbook(customers: CustomerWithIntegrations[]) {
  return createXlsxWorkbook({
    sheetName: 'Clientes',
    columns,
    rows: customers.map(customerRow),
  });
}
