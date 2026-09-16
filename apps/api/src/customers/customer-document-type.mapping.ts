import type { customerDocumentTypes } from '@sevale/validation';

export type CustomerDocumentType = (typeof customerDocumentTypes)[number]['value'];

type CustomerDocumentTypeMapping = {
  label: string;
  wooValues: readonly string[];
};

// Solo contiene valores confirmados en las tiendas. Agregar equivalencias nuevas
// únicamente después de observar el valor real que guarda el plugin.
export const customerDocumentTypeMappings: Partial<
  Record<CustomerDocumentType, CustomerDocumentTypeMapping>
> = {
  '22': {
    label: 'Cédula de extranjería',
    wooValues: ['Documento Extranjero'],
  },
};

function normalized(value: string): string {
  return value.trim().toLocaleLowerCase('es');
}

export function documentTypeFromWoo(value: string | null | undefined): CustomerDocumentType | null {
  if (!value?.trim()) return null;
  const candidate = normalized(value);
  for (const [documentType, mapping] of Object.entries(customerDocumentTypeMappings)) {
    if (mapping.wooValues.some((wooValue) => normalized(wooValue) === candidate)) {
      return documentType as CustomerDocumentType;
    }
  }
  return null;
}

export function documentTypeToWoo(value: string | null | undefined): string | null {
  if (!value) return null;
  const mapping = customerDocumentTypeMappings[value as CustomerDocumentType];
  return mapping?.wooValues[0] ?? null;
}
