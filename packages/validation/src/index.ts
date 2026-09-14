import { z } from 'zod';

export const emailSchema = z.string().trim().toLowerCase().email('Ingresa un correo válido.');

export const passwordSchema = z
  .string()
  .min(8, 'La contraseña debe tener al menos 8 caracteres.')
  .max(128, 'La contraseña no puede superar los 128 caracteres.');

export const otpSchema = z.string().regex(/^\d{6}$/, 'Ingresa el código de 6 dígitos.');

export const requestOtpSchema = z.object({
  email: emailSchema,
  type: z.literal('sign-in'),
});

export const passwordLoginSchema = z.object({
  email: emailSchema,
  password: passwordSchema,
});

export const otpLoginSchema = z.object({
  email: emailSchema,
  otp: otpSchema,
});

export const roleSchema = z.enum(['ADMIN', 'COMMERCIAL', 'LOGISTICS']);

export const createUserSchema = z.object({
  name: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres.').max(191),
  email: emailSchema,
  role: roleSchema,
  active: z.boolean().default(true),
});

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(191).optional(),
    role: roleSchema.optional(),
    active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'Debes enviar al menos un cambio.');

export const userListQuerySchema = z.object({
  search: z.string().trim().max(191).default(''),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const userIdSchema = z.string().uuid('El identificador del usuario no es válido.');

export const customerPersonTypeSchema = z.enum(['PERSON', 'COMPANY']);

export const customerDocumentTypes = [
  { value: '13', label: 'Cédula de ciudadanía' },
  { value: '31', label: 'NIT' },
  { value: '22', label: 'Cédula de extranjería' },
  { value: '42', label: 'Documento de identificación extranjero' },
  { value: '50', label: 'NIT de otro país' },
  { value: 'R-00-PN', label: 'No obligado a registrarse en el RUT PN' },
  { value: '91', label: 'NUIP' },
  { value: '41', label: 'Pasaporte' },
  { value: '47', label: 'Permiso especial de permanencia PEP' },
  { value: '11', label: 'Registro civil' },
  { value: '43', label: 'Sin identificación del exterior' },
  { value: '21', label: 'Tarjeta de extranjería' },
  { value: '12', label: 'Tarjeta de identidad' },
  { value: '89', label: 'Salvoconducto de permanencia' },
  { value: '48', label: 'Permiso protección temporal PPT' },
] as const;

export type CustomerDocumentType = (typeof customerDocumentTypes)[number]['value'];

export const customerDocumentRules: Record<
  CustomerDocumentType,
  { format: 'numeric' | 'alphanumeric'; minimum: number; maximum: number }
> = {
  '13': { format: 'numeric', minimum: 3, maximum: 13 },
  '31': { format: 'numeric', minimum: 3, maximum: 13 },
  '11': { format: 'numeric', minimum: 3, maximum: 13 },
  '22': { format: 'alphanumeric', minimum: 1, maximum: 20 },
  '42': { format: 'alphanumeric', minimum: 1, maximum: 20 },
  '50': { format: 'alphanumeric', minimum: 1, maximum: 20 },
  'R-00-PN': { format: 'alphanumeric', minimum: 1, maximum: 13 },
  '91': { format: 'alphanumeric', minimum: 1, maximum: 20 },
  '41': { format: 'alphanumeric', minimum: 1, maximum: 20 },
  '47': { format: 'alphanumeric', minimum: 1, maximum: 20 },
  '43': { format: 'alphanumeric', minimum: 1, maximum: 20 },
  '21': { format: 'alphanumeric', minimum: 1, maximum: 20 },
  '12': { format: 'alphanumeric', minimum: 1, maximum: 20 },
  '89': { format: 'alphanumeric', minimum: 1, maximum: 20 },
  '48': { format: 'alphanumeric', minimum: 1, maximum: 20 },
};

export function customerDocumentError(
  documentType: CustomerDocumentType,
  documentNumber: string,
): string | null {
  const rule = customerDocumentRules[documentType];
  const formatValid =
    rule.format === 'numeric' ? /^\d+$/.test(documentNumber) : /^[\p{L}\d]+$/u.test(documentNumber);
  if (
    formatValid &&
    documentNumber.length >= rule.minimum &&
    documentNumber.length <= rule.maximum
  ) {
    return null;
  }
  return rule.format === 'numeric'
    ? `El documento debe contener entre ${rule.minimum} y ${rule.maximum} dígitos.`
    : `El documento debe ser alfanumérico y contener entre ${rule.minimum} y ${rule.maximum} caracteres.`;
}

export const customerFiscalResponsibilities = [
  { value: 'R-99-PN', label: 'No Aplica - Otros' },
  { value: 'O-13', label: 'Gran contribuyente' },
  { value: 'O-15', label: 'Autorretenedor' },
  { value: 'O-23', label: 'Agente de retención IVA' },
  { value: 'O-47', label: 'Régimen simple de tributación' },
] as const;

const customerDocumentTypeSchema = z.enum(
  customerDocumentTypes.map(({ value }) => value) as [
    (typeof customerDocumentTypes)[number]['value'],
    ...(typeof customerDocumentTypes)[number]['value'][],
  ],
);
const fiscalResponsibilitySchema = z.enum(
  customerFiscalResponsibilities.map(({ value }) => value) as [
    (typeof customerFiscalResponsibilities)[number]['value'],
    ...(typeof customerFiscalResponsibilities)[number]['value'][],
  ],
);
const optionalText = (maximum: number) =>
  z
    .string()
    .trim()
    .max(maximum)
    .nullable()
    .optional()
    .transform((value) => value || null);

const optionalEmail = z
  .union([emailSchema, z.literal(''), z.null(), z.undefined()])
  .transform((value) => value || null);

const optionalCountry = z
  .union([
    z.string().trim().toUpperCase().length(2, 'Selecciona un país válido.'),
    z.literal(''),
    z.null(),
    z.undefined(),
  ])
  .transform((value) => value || null);

const customerFieldsSchema = z.object({
  personType: customerPersonTypeSchema,
  firstName: optionalText(191),
  lastName: optionalText(191),
  displayName: z
    .union([z.string().trim().max(255), z.null(), z.undefined()])
    .transform((value) => value || ''),
  company: optionalText(255),
  documentType: customerDocumentTypeSchema,
  documentNumber: z.string().trim().min(1, 'Ingresa el número de documento.').max(20),
  checkDigit: z
    .string()
    .trim()
    .regex(/^\d$/, 'El dígito de verificación debe ser un número entre 0 y 9.')
    .nullable()
    .optional()
    .transform((value) => value || null),
  email: optionalEmail,
  phone: z
    .string()
    .trim()
    .transform((value) => value.replace(/[\s().-]/g, ''))
    .pipe(
      z
        .string()
        .regex(
          /^\+[1-9]\d{6,14}$/,
          'El teléfono debe usar formato internacional, por ejemplo +573001234567.',
        ),
    )
    .nullable()
    .optional()
    .transform((value) => value || null),
  country: optionalCountry,
  region: optionalText(32),
  cityCode: optionalText(32),
  postalCode: optionalText(32),
  addressLine1: optionalText(255),
  addressLine2: optionalText(255),
  vatResponsible: z.boolean().default(false),
  fiscalResponsibilities: z
    .array(fiscalResponsibilitySchema)
    .max(1, 'Selecciona una sola responsabilidad fiscal.')
    .default([])
    .transform((values) => [...new Set(values)]),
});

function validateCustomerIdentity(
  input: z.infer<typeof customerFieldsSchema>,
  context: z.RefinementCtx,
) {
  if (!input.firstName) {
    context.addIssue({ code: 'custom', path: ['firstName'], message: 'Ingresa los nombres.' });
  }
  if (!input.lastName) {
    context.addIssue({ code: 'custom', path: ['lastName'], message: 'Ingresa los apellidos.' });
  }
  if (input.personType === 'COMPANY' && !input.company) {
    context.addIssue({
      code: 'custom',
      path: ['company'],
      message: 'Ingresa la empresa o razón social.',
    });
  }

  const documentError = customerDocumentError(input.documentType, input.documentNumber);
  if (documentError) {
    context.addIssue({
      code: 'custom',
      path: ['documentNumber'],
      message: documentError,
    });
  }
}

export const createCustomerSchema = customerFieldsSchema.superRefine(validateCustomerIdentity);
export const updateCustomerSchema = customerFieldsSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, 'Debes enviar al menos un cambio.');

export const customerListQuerySchema = z.object({
  search: z.string().trim().max(191, 'La búsqueda es demasiado larga.').default(''),
  country: z.string().trim().toUpperCase().length(2).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z
    .enum(['displayName', 'documentNumber', 'email', 'country', 'createdAt'])
    .default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const customerIdSchema = z.coerce
  .number()
  .int('El identificador del cliente no es válido.')
  .positive('El identificador del cliente no es válido.');

export const customerSiigoLookupSchema = z.object({
  identification: z
    .string()
    .trim()
    .min(1, 'Ingresa el número de documento.')
    .max(20, 'El número de documento es demasiado largo.')
    .regex(/^[A-Za-z0-9-]+$/, 'El número de documento contiene caracteres no válidos.'),
});

export const customerIntegrationProviderSchema = z.enum(['SIIGO', 'SERATUS', 'PALI']);
export const customerSyncSchema = z
  .object({ provider: customerIntegrationProviderSchema.optional() })
  .strict()
  .default({});

export const storeSchema = z.enum(['SERATUS', 'PALI']);
export const syncStatusSchema = z.enum(['PENDING', 'SYNCED', 'OUT_OF_SYNC', 'ERROR']);
export const productStatusFilterSchema = z.enum([
  'PENDING',
  'SYNCED',
  'OUT_OF_SYNC',
  'ERROR',
  'OUT_OF_STOCK',
]);
export const productStockSortSchema = z.enum(['asc', 'desc']);

export const productListQuerySchema = z.object({
  search: z.string().trim().max(191, 'La búsqueda es demasiado larga.').default(''),
  store: storeSchema.optional(),
  syncStatus: productStatusFilterSchema.optional(),
  stockSort: productStockSortSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
});

export const productIdSchema = z.coerce
  .number()
  .int('El identificador del producto no es válido.')
  .positive('El identificador del producto no es válido.');

export const bulkProductSyncSchema = z.object({
  ids: z
    .array(productIdSchema)
    .min(1, 'Selecciona al menos un producto.')
    .max(10_000, 'No puedes sincronizar más de 10.000 productos en un solo trabajo.')
    .transform((ids) => [...new Set(ids)]),
});

export const productExportSchema = z.object({
  ids: z
    .array(productIdSchema)
    .min(1, 'Selecciona al menos un producto.')
    .max(10_000, 'No puedes exportar más de 10.000 productos a la vez.')
    .transform((ids) => [...new Set(ids)]),
});

export const productSyncJobIdSchema = z.string().uuid('La sincronización no es válida.');

export const skuSchema = z
  .string()
  .trim()
  .min(1, 'Debes ingresar un SKU.')
  .transform((value) => value.normalize('NFC'))
  .pipe(
    z
      .string()
      .max(191, 'El SKU no puede superar los 191 caracteres.')
      .regex(/^[A-Za-zÁÉÍÓÚáéíóú0-9_-]+$/, 'El SKU contiene caracteres no válidos.'),
  );

export const externalProductQuerySchema = z.object({
  sku: skuSchema,
});

export const createProductLinkSchema = z.object({
  sku: skuSchema,
});

export const productImportCsvSchema = z.object({
  csv: z
    .string()
    .min(1, 'El archivo CSV está vacío.')
    .max(800_000, 'El archivo CSV supera el tamaño máximo permitido.'),
});

export type ProductImportCsvInput = z.infer<typeof productImportCsvSchema>;

export const siigoProductLookupQuerySchema = z.object({
  siigo_id: z.string().trim().min(1).max(191),
});

const wooSyncResultSchema = z.discriminatedUnion('success', [
  z
    .object({
      success: z.literal(true),
      store: storeSchema,
      price_cop: z.number().finite().nonnegative(),
      price_usd: z.number().finite().nonnegative(),
      stock: z.number().int().nonnegative(),
    })
    .strict(),
  z
    .object({
      success: z.literal(false),
      store: storeSchema,
      error: z.string().trim().min(1).max(500),
    })
    .strict(),
]);

export const siigoProductUpdateSchema = z
  .object({
    siigo_id: z.string().trim().min(1).max(191),
    sku: skuSchema,
    siigo_price_cop: z.number().finite().nonnegative(),
    siigo_price_usd: z.number().finite().nonnegative(),
    siigo_stock: z.number().int().nonnegative(),
    woo_sync: wooSyncResultSchema.optional(),
  })
  .strict();

export const notificationListQuerySchema = z.object({
  status: z.enum(['all', 'unread', 'read']).default('all'),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(50).default(20),
});

export const notificationIdSchema = z.coerce
  .number()
  .int('El identificador de la notificación no es válido.')
  .positive('El identificador de la notificación no es válido.');

export type ExternalProductQuery = z.infer<typeof externalProductQuerySchema>;
export type CreateProductLinkInput = z.infer<typeof createProductLinkSchema>;
export type SiigoProductLookupQuery = z.infer<typeof siigoProductLookupQuerySchema>;
export type SiigoProductUpdateInput = z.infer<typeof siigoProductUpdateSchema>;
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;
export type CustomerSiigoLookupQuery = z.infer<typeof customerSiigoLookupSchema>;
export type CustomerSyncInput = z.infer<typeof customerSyncSchema>;
export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export type BulkProductSyncInput = z.infer<typeof bulkProductSyncSchema>;
