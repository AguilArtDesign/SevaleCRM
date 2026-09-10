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
export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export type BulkProductSyncInput = z.infer<typeof bulkProductSyncSchema>;
