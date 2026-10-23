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

const sellerIdValueSchema = z.coerce
  .number({ error: 'Ingresa el seller id de Siigo.' })
  .int('El seller id de Siigo debe ser un número entero.')
  .min(1, 'El seller id de Siigo debe ser un número mayor que cero.')
  .max(2_147_483_647, 'El seller id de Siigo no puede superar 2147483647.');

export const sellerIdSchema = z.preprocess(
  (value) =>
    value === null || (typeof value === 'string' && value.trim() === '') ? undefined : value,
  sellerIdValueSchema,
);

export const createUserSchema = z.object({
  name: z.string().trim().min(2, 'El nombre debe tener al menos 2 caracteres.').max(191),
  email: emailSchema,
  sellerId: sellerIdSchema,
  role: roleSchema,
  active: z.boolean().default(true),
});

export const updateUserSchema = z
  .object({
    name: z.string().trim().min(2).max(191).optional(),
    role: roleSchema.optional(),
    active: z.boolean().optional(),
    sellerId: sellerIdSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'Debes enviar al menos un cambio.');

export const userListQuerySchema = z.object({
  search: z.string().trim().max(191).default(''),
  role: roleSchema.optional(),
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

/**
 * Compara sin acentos, sin mayúsculas y sin puntuación, para que «Cédula de ciudadanía» y
 * «cedula de ciudadania» sean el mismo valor. No añade vocabulario: solo tolera cómo se escribe.
 */
function normalizeDocumentTypeLabel(value: string): string {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, ' ')
    .trim();
}

/**
 * Traduce lo que trae el archivo al código que guarda el CRM. Se acepta la etiqueta tal como aparece
 * en el selector de tipo de documento y el propio código; ambos son parte de `customerDocumentTypes`,
 * así que no hay una segunda tabla que mantener sincronizada. Devuelve `null` si no lo reconoce, para
 * que quien llama pueda avisar en lugar de guardar un tipo que rompería la sincronización.
 */
export function resolveCustomerDocumentType(value: string): CustomerDocumentType | null {
  const normalized = normalizeDocumentTypeLabel(value);
  if (!normalized) return null;
  for (const { value: code, label } of customerDocumentTypes) {
    if (
      normalizeDocumentTypeLabel(code) === normalized ||
      normalizeDocumentTypeLabel(label) === normalized
    ) {
      return code;
    }
  }
  return null;
}

/** Texto para el mensaje de error: no enumera tipos, remite al selector que los define. */
export const customerDocumentTypeHints =
  'el nombre tal como aparece en el selector de tipo de documento';

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

export const customerDocumentTypeSchema = z.enum(
  customerDocumentTypes.map(({ value }) => value) as [
    (typeof customerDocumentTypes)[number]['value'],
    ...(typeof customerDocumentTypes)[number]['value'][],
  ],
  { error: 'Selecciona el tipo de documento.' },
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
  cityName: optionalText(191),
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

// Estado de sincronización tal como lo ve el panel. `OUT_OF_SYNC` no existe en la base: se deriva
// de una integración pendiente que ya se había sincronizado antes.
export const customerSyncStatusFilterSchema = z.enum([
  'all',
  'SYNCED',
  'PENDING',
  'OUT_OF_SYNC',
  'ERROR',
]);

export const customerListQuerySchema = z.object({
  search: z.string().trim().max(191, 'La búsqueda es demasiado larga.').default(''),
  country: z.string().trim().toUpperCase().length(2).optional(),
  status: customerSyncStatusFilterSchema.default('all'),
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

// Exportar es leer lo que ya se ve en el panel, pero en lote: el tope evita que una selección
// accidental intente generar un libro con toda la base.
export const customerExportSchema = z.object({
  ids: z
    .array(customerIdSchema)
    .min(1, 'Selecciona al menos un cliente.')
    .max(10_000, 'No puedes exportar más de 10.000 clientes a la vez.')
    .transform((ids) => [...new Set(ids)]),
});

export const customerSiigoLookupSchema = z.object({
  identification: z
    .string()
    .trim()
    .min(1, 'Ingresa el número de documento.')
    .max(20, 'El número de documento es demasiado largo.')
    .regex(/^[A-Za-z0-9-]+$/, 'El número de documento contiene caracteres no válidos.'),
});

// La búsqueda del cliente se define por la pareja (tipo, número), que es la identidad real del
// cliente en el CRM, en Siigo y en cada tienda; por eso el tipo es obligatorio al resolver.
export const customerResolveQuerySchema = z.object({
  identification: customerSiigoLookupSchema.shape.identification,
  documentType: customerDocumentTypeSchema,
});

export const customerIntegrationProviderSchema = z.enum(['SIIGO', 'SERATUS', 'PALI']);
export const customerSiigoLocationSchema = z
  .object({
    stateCode: z.string().trim().min(1, 'Selecciona la región de Siigo.').max(32),
    cityCode: z.string().trim().min(1, 'Selecciona la ciudad de Siigo.').max(32),
  })
  .strict();
export const customerSyncSchema = z
  .object({
    provider: customerIntegrationProviderSchema.optional(),
    siigoLocation: customerSiigoLocationSchema.optional(),
  })
  .strict()
  .superRefine((input, context) => {
    if (input.siigoLocation && input.provider && input.provider !== 'SIIGO') {
      context.addIssue({
        code: 'custom',
        path: ['siigoLocation'],
        message: 'La ubicación Siigo solo puede enviarse al sincronizar con Siigo.',
      });
    }
  })
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

export const orderSourceSchema = z.enum(['CRM', 'WOOCOMMERCE']);
export const operationStatusSchema = z.enum(['PENDING', 'COMPLETED', 'CANCELLED']);
export const orderCurrencySchema = z.enum(['COP', 'USD']);

const orderMoneySchema = z
  .union([
    z.string().trim(),
    z
      .number()
      .finite()
      .nonnegative()
      .transform((value) => value.toFixed(2)),
  ])
  .pipe(z.string().regex(/^\d{1,12}(?:\.\d{1,2})?$/, 'El valor monetario no es válido.'));

const nullableOrderText = (maximum: number) =>
  z
    .union([z.string().trim().max(maximum), z.null(), z.undefined()])
    .transform((value) => value || null);

const nullableOrderCountry = z
  .union([
    z.string().trim().toUpperCase().length(2, 'Selecciona un país válido.'),
    z.literal(''),
    z.null(),
    z.undefined(),
  ])
  .transform((value) => value || null);

export const orderBillingSchema = z
  .object({
    firstName: nullableOrderText(191),
    lastName: nullableOrderText(191),
    company: nullableOrderText(255),
    address1: nullableOrderText(255),
    address2: nullableOrderText(255),
    city: nullableOrderText(191),
    state: nullableOrderText(32),
    postcode: nullableOrderText(32),
    country: nullableOrderCountry,
    email: optionalEmail,
    phone: nullableOrderText(32),
  })
  .strict();

export const orderShippingSchema = z
  .object({
    firstName: nullableOrderText(191),
    lastName: nullableOrderText(191),
    company: nullableOrderText(255),
    address1: nullableOrderText(255),
    address2: nullableOrderText(255),
    city: nullableOrderText(191),
    state: nullableOrderText(32),
    postcode: nullableOrderText(32),
    country: nullableOrderCountry,
    phone: nullableOrderText(32),
  })
  .strict();

const orderItemInputSchema = z
  .object({
    productId: productIdSchema,
    quantity: z.number().int().min(1).max(10_000),
    unitPrice: orderMoneySchema.optional(),
  })
  .strict();

const orderOperationFieldsSchema = z
  .object({
    customerId: customerIdSchema,
    currency: orderCurrencySchema,
    paymentMethod: z.string().trim().min(1, 'Selecciona el método de pago.').max(191),
    shippingMethod: z.string().trim().min(1, 'Selecciona el método de envío.').max(191),
    customShippingTotal: z
      .union([orderMoneySchema, z.null(), z.undefined()])
      .transform((value) => value ?? null),
    couponId: z
      .union([z.number().int().positive(), z.null(), z.undefined()])
      .transform((value) => value ?? null),
    billing: orderBillingSchema,
    shipping: orderShippingSchema,
    items: z.array(orderItemInputSchema).min(1, 'Agrega al menos un producto.').max(200),
  })
  .strict();

function validateOrderCollections(
  input: z.infer<typeof orderOperationFieldsSchema>,
  context: z.RefinementCtx,
) {
  if (new Set(input.items.map(({ productId }) => productId)).size !== input.items.length) {
    context.addIssue({
      code: 'custom',
      path: ['items'],
      message: 'Cada producto solo puede aparecer una vez en la operación.',
    });
  }
}

export const createOrderOperationSchema =
  orderOperationFieldsSchema.superRefine(validateOrderCollections);
export const updateOrderOperationSchema =
  orderOperationFieldsSchema.superRefine(validateOrderCollections);

export const orderOperationIdSchema = z.coerce
  .number()
  .int('El identificador de la operación no es válido.')
  .positive('El identificador de la operación no es válido.');

export const orderIdSchema = z.coerce
  .number()
  .int('El identificador del pedido no es válido.')
  .positive('El identificador del pedido no es válido.');

export const updateShipmentSchema = z
  .object({
    carrier: z.string().trim().min(1, 'Ingresa la transportadora.').max(191),
    trackingNumber: z.string().trim().min(1, 'Ingresa el número de guía.').max(191),
    status: z.string().trim().min(1, 'Ingresa el estado del envío.').max(100),
    note: z
      .union([z.string().trim().max(2_000), z.null(), z.undefined()])
      .transform((value) => value || null),
  })
  .strict();

export const createSiigoQuotationSchema = z
  .object({
    exchangeRate: z.number().finite().positive().max(999_999_999.999999).optional(),
  })
  .strict();

export const orderListQuerySchema = z
  .object({
    search: z.string().trim().max(191, 'La búsqueda es demasiado larga.').default(''),
    status: operationStatusSchema.optional(),
    source: orderSourceSchema.optional(),
    store: storeSchema.optional(),
    customerId: customerIdSchema.optional(),
    dateFrom: z.coerce.date().optional(),
    dateTo: z.coerce.date().optional(),
    page: z.coerce.number().int().min(1).default(1),
    pageSize: z.coerce.number().int().min(1).max(100).default(20),
    sort: z.enum(['operationCode', 'status', 'source', 'total', 'createdAt']).default('createdAt'),
    order: z.enum(['asc', 'desc']).default('desc'),
  })
  .superRefine((input, context) => {
    if (input.dateFrom && input.dateTo && input.dateFrom > input.dateTo) {
      context.addIssue({
        code: 'custom',
        path: ['dateTo'],
        message: 'La fecha final no puede ser anterior a la fecha inicial.',
      });
    }
  });

/** Paginación del historial de pedidos de un cliente consultado desde su detalle. */
export const customerOrdersQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(10),
});

const couponCodeSchema = z
  .string()
  .trim()
  .toLowerCase()
  .min(2, 'El cupón debe contener al menos 2 caracteres.')
  .max(64, 'El cupón no puede superar 64 caracteres.')
  .regex(
    /^[a-z0-9][a-z0-9_-]*$/,
    'El cupón solo puede contener letras, números, guiones y guiones bajos.',
  );

const couponIsoDatePattern = /^(\d{4})-(\d{1,2})-(\d{1,2})/;

// El formulario valida con este mismo esquema antes de enviar y serializa el Date resultante
// como datetime ISO, de modo que la API recibe 'YYYY-MM-DDTHH:mm:ss.sssZ'. Se normaliza
// cualquier variante al día para que el esquema sea idempotente sobre su propia salida.
function normalizeCouponExpires(value: string): string {
  const match = couponIsoDatePattern.exec(value);
  if (!match) return value;
  const [, year, month, day] = match;
  return `${year}-${month!.padStart(2, '0')}-${day!.padStart(2, '0')}`;
}

const couponDateOnlySchema = z
  .string()
  .trim()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'Selecciona una fecha de caducidad válida.')
  .refine((value) => {
    const date = new Date(`${value}T23:59:59.000Z`);
    return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
  }, 'Selecciona una fecha de caducidad válida.');

const couponExpiresInputSchema = z
  .string()
  .transform(normalizeCouponExpires)
  .pipe(couponDateOnlySchema);

// La caducidad se maneja como fecha de calendario a las 23:59:59 UTC. Así el día es
// inequívoco y se recompone en la zona horaria del sitio al enviarla a WooCommerce.
const couponExpiresSchema = z
  .union([couponExpiresInputSchema, z.literal(''), z.null(), z.undefined()])
  .transform((value) => (value ? new Date(`${value}T23:59:59.000Z`) : null));

const couponUsageLimitSchema = z
  .union([
    z.coerce
      .number()
      .int('El límite debe ser un número entero.')
      .min(1, 'El límite debe ser al menos 1.')
      .max(1_000_000, 'El límite es demasiado alto.'),
    z.literal(''),
    z.null(),
    z.undefined(),
  ])
  .transform((value) => (value === '' || value === null || value === undefined ? null : value));

const couponFieldsSchema = z.object({
  coupon: couponCodeSchema,
  description: z
    .union([z.string().trim().max(255), z.literal(''), z.null(), z.undefined()])
    .transform((value) => value || null),
  type: z.string().trim().min(1, 'Selecciona el tipo de cupón.').max(32),
  amount: z.coerce
    .number()
    .finite()
    .gt(0, 'El valor debe ser mayor que 0.')
    .lte(100, 'El porcentaje no puede superar 100.'),
  dateExpires: couponExpiresSchema,
  individualUse: z.boolean().default(false),
  excludeSaleItems: z.boolean().default(false),
  usageLimit: couponUsageLimitSchema,
  usageLimitPerUser: couponUsageLimitSchema,
});

export const createCouponSchema = couponFieldsSchema;
export const updateCouponSchema = couponFieldsSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, 'Debes enviar al menos un cambio.');
export const couponIdSchema = z.coerce
  .number()
  .int('El identificador del cupón no es válido.')
  .positive('El identificador del cupón no es válido.');
export const couponListQuerySchema = z.object({
  search: z.string().trim().max(191, 'La búsqueda es demasiado larga.').default(''),
  // Filtro opcional: sin valor, el listado devuelve todos los estados de sincronización.
  syncStatus: z.enum(['PENDING', 'SYNCED', 'PARTIAL', 'ERROR']).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['coupon', 'amount', 'createdAt', 'updatedAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

const wooIdentifierSchema = z.union([
  z.number().int().nonnegative().transform(String),
  z.string().trim().regex(/^\d+$/, 'El identificador de WooCommerce no es válido.'),
]);

const wooMoneySchema = z
  .union([
    z.number().finite().nonnegative(),
    z
      .string()
      .trim()
      .regex(/^\d+(?:\.\d{1,6})?$/),
  ])
  .transform(String);

const wooOptionalTextSchema = (maximum: number) =>
  z
    .union([z.string().trim().max(maximum), z.null(), z.undefined()])
    .transform((value) => value || '');

const wooAddressSchema = z
  .object({
    first_name: wooOptionalTextSchema(191),
    last_name: wooOptionalTextSchema(191),
    company: wooOptionalTextSchema(255),
    address_1: wooOptionalTextSchema(255),
    address_2: wooOptionalTextSchema(255),
    city: wooOptionalTextSchema(191),
    state: wooOptionalTextSchema(32),
    postcode: wooOptionalTextSchema(32),
    country: wooOptionalTextSchema(2),
    email: wooOptionalTextSchema(191),
    phone: wooOptionalTextSchema(32),
  })
  .passthrough();

const wooMetadataSchema = z
  .object({ key: z.string().trim().min(1).max(191), value: z.unknown() })
  .passthrough();

const wooLineItemSchema = z
  .object({
    id: wooIdentifierSchema.optional(),
    product_id: wooIdentifierSchema,
    variation_id: wooIdentifierSchema.default('0'),
    name: z.string().trim().min(1).max(255),
    sku: wooOptionalTextSchema(191),
    quantity: z.coerce.number().int().min(1).max(10_000),
    price: wooMoneySchema.optional(),
    subtotal: wooMoneySchema,
    total: wooMoneySchema,
    tax_class: wooOptionalTextSchema(100),
  })
  .passthrough();

const wooCouponLineSchema = z
  .object({
    code: z.string().trim().min(1).max(191),
    discount: wooMoneySchema.default('0'),
  })
  .passthrough();

const wooShippingLineSchema = z
  .object({
    method_id: wooOptionalTextSchema(191),
    method_title: wooOptionalTextSchema(191),
    total: wooMoneySchema.default('0'),
  })
  .passthrough();

const wooInboundOrderSchema = z
  .object({
    id: wooIdentifierSchema.refine(
      (value) => value !== '0',
      'El pedido de WooCommerce no es válido.',
    ),
    status: z.string().trim().min(1).max(50),
    currency: z.string().trim().toUpperCase().length(3),
    date_created: wooOptionalTextSchema(40),
    date_modified: wooOptionalTextSchema(40),
    customer_id: wooIdentifierSchema.default('0'),
    discount_total: wooMoneySchema.default('0'),
    shipping_total: wooMoneySchema.default('0'),
    total: wooMoneySchema,
    payment_method: wooOptionalTextSchema(191),
    payment_method_title: wooOptionalTextSchema(191),
    billing: wooAddressSchema,
    shipping: wooAddressSchema.optional().default({
      first_name: '',
      last_name: '',
      company: '',
      address_1: '',
      address_2: '',
      city: '',
      state: '',
      postcode: '',
      country: '',
      email: '',
      phone: '',
    }),
    meta_data: z.array(wooMetadataSchema).max(500).default([]),
    line_items: z.array(wooLineItemSchema).min(1).max(200),
    coupon_lines: z.array(wooCouponLineSchema).max(20).default([]),
    shipping_lines: z.array(wooShippingLineSchema).max(20).default([]),
  })
  .passthrough();

export const wooOrderInboundSchema = z
  .object({
    provider: storeSchema,
    event: z.enum(['order.created', 'order.updated']),
    deliveryId: z.string().trim().min(1).max(191),
    order: wooInboundOrderSchema,
  })
  .strict();

export type ProductImportCsvInput = z.infer<typeof productImportCsvSchema>;
export type CreateOrderOperationInput = z.infer<typeof createOrderOperationSchema>;
export type UpdateOrderOperationInput = z.infer<typeof updateOrderOperationSchema>;
export type OrderListQuery = z.infer<typeof orderListQuerySchema>;
export type CustomerOrdersQuery = z.infer<typeof customerOrdersQuerySchema>;
export type UpdateShipmentInput = z.infer<typeof updateShipmentSchema>;
export type CreateSiigoQuotationInput = z.infer<typeof createSiigoQuotationSchema>;
export type WooOrderInboundInput = z.infer<typeof wooOrderInboundSchema>;

export const n8nCustomerIntegrationSchema = z.object({
  provider: z.enum(['SIIGO', 'SERATUS', 'PALI']),
  externalId: z.string().trim().min(1).max(191),
});

/** Alta o actualización de un cliente desde n8n: mismos campos del CRM más sus vínculos por tienda. */
export const n8nCustomerUpsertSchema = createCustomerSchema.extend({
  integrations: z.array(n8nCustomerIntegrationSchema).max(3).default([]),
});

export const n8nCustomerLookupSchema = z
  .object({
    documentNumber: z.string().trim().min(1).max(50),
  })
  .strict();

export type N8nCustomerIntegrationInput = z.infer<typeof n8nCustomerIntegrationSchema>;
export type N8nCustomerUpsertInput = z.infer<typeof n8nCustomerUpsertSchema>;
export type N8nCustomerLookupInput = z.infer<typeof n8nCustomerLookupSchema>;

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

// --- Convenios -------------------------------------------------------------------------------
// Un convenio puede ser de cualquier país del catálogo de Clientes. El departamento se guarda con
// su wooCode (CO-ANT) y la ciudad con el código del catálogo (05001) cuando el país lo tiene; fuera
// de Colombia la ciudad es texto libre y se guarda en `cityName`. Los nombres se resuelven al leer
// contra el mismo catálogo que usa Clientes.

export const agreementIdSchema = z.coerce
  .number()
  .int('El identificador del convenio no es válido.')
  .positive('El identificador del convenio no es válido.');

export const agreementCommentIdSchema = z.coerce
  .number()
  .int('El identificador del comentario no es válido.')
  .positive('El identificador del comentario no es válido.');

export const agreementTaskIdSchema = z.coerce
  .number()
  .int('El identificador de la tarea no es válido.')
  .positive('El identificador de la tarea no es válido.');

// Un NIT puede llevar guiones y dígito de verificación, así que se guarda como texto. Es único
// cuando existe, pero puede quedar vacío: en MySQL varios NULL no chocan en un índice único.
const agreementNitSchema = z
  .union([
    z.string().trim().max(32, 'El NIT no puede superar los 32 caracteres.'),
    z.null(),
    z.undefined(),
  ])
  .optional()
  .transform((value) => value || null);

const agreementEmailSchema = z
  .union([emailSchema, z.literal(''), z.null(), z.undefined()])
  .optional()
  .transform((value) => value || null);

// La fecha y hora de una tarea llega del navegador como ISO (con huso), o como Date cuando el
// propio formulario reutiliza este esquema antes de enviar. Se normaliza siempre a Date.
const agreementScheduledAtSchema = z
  .union([z.string().trim().min(1, 'Selecciona la fecha y hora de la tarea.'), z.date()])
  .transform((value) => (value instanceof Date ? value : new Date(value)))
  .refine(
    (date) => !Number.isNaN(date.getTime()),
    'Selecciona una fecha y hora válidas para la tarea.',
  );

const agreementOptionalUserIdSchema = z
  .union([userIdSchema, z.literal(''), z.null(), z.undefined()])
  .optional()
  .transform((value) => value || null);

const agreementCountrySchema = z
  .string()
  .trim()
  .toUpperCase()
  .regex(/^[A-Z]{2}$/, 'Selecciona un país válido.');

/**
 * La vigencia es una fecha sin hora (`YYYY-MM-DD`): se compara por día de calendario, no por
 * instante. Llega del formulario como texto y la API la convierte a fecha antes de guardarla, para
 * que el tipo que viaja por el cliente siga siendo el que el formulario maneja.
 */
const agreementValidUntilSchema = z
  .union([
    z
      .string()
      .trim()
      .regex(/^\d{4}-\d{2}-\d{2}$/, 'Selecciona una fecha de vigencia válida.'),
    z.literal(''),
    z.null(),
    z.undefined(),
  ])
  .optional()
  .transform((value) => value || null);

const agreementFieldsSchema = z.object({
  companyName: z
    .string()
    .trim()
    .min(1, 'Ingresa el nombre de la empresa.')
    .max(255, 'El nombre de la empresa no puede superar los 255 caracteres.'),
  nit: agreementNitSchema,
  country: agreementCountrySchema.optional(),
  region: optionalText(32),
  cityCode: optionalText(32),
  cityName: optionalText(191),
  postalCode: optionalText(32),
  addressLine1: optionalText(255),
  addressLine2: optionalText(255),
  contactName: optionalText(191),
  contactPosition: optionalText(191),
  contactEmail: agreementEmailSchema,
  contactPhone: optionalText(32),
  validUntil: agreementValidUntilSchema,
  // La URL pública del logo en R2. Solo se acepta https: un logo se pinta en un <img> y no debe
  // poder apuntar a http ni a esquemas como javascript:.
  logoUrl: z
    .union([
      z
        .url({ protocol: /^https$/, error: 'La URL del logo debe empezar por https://' })
        .max(2_000, 'La URL del logo es demasiado larga.')
        .refine((value) => !value.endsWith('/'), { message: 'no debe terminar en /' }),
      z.literal(''),
      z.null(),
      z.undefined(),
    ])
    .optional()
    .transform((value) => value || null),
  description: optionalText(5_000),
  // Sin default aquí: un `active` con valor por defecto haría que un PATCH vacío activara el
  // convenio sin que nadie lo pidiera. El valor inicial se define solo en el alta.
  active: z.boolean().optional(),
});

export const createAgreementSchema = agreementFieldsSchema.extend({
  // Un alta sin país sigue siendo un convenio colombiano, como antes de existir el campo.
  country: agreementCountrySchema.default('CO'),
  active: z.boolean().default(true),
});

export const updateAgreementSchema = agreementFieldsSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, 'Debes enviar al menos un cambio.');

/**
 * El archivo viaja en base64 dentro del JSON porque la API no tiene multipart y un logo de 500 KB
 * ocupa 667 KB codificado, por debajo del `bodyLimit` de 1 MB. Se declara el límite del base64 un
 * poco por encima del real para que el error de tamaño lo dé la validación del binario, con un
 * mensaje claro en lugar de un 413 del servidor.
 */
export const agreementLogoUploadSchema = z.object({
  contentType: z.enum(['image/svg+xml', 'image/webp'], {
    error: 'El logo debe ser SVG o WebP.',
  }),
  data: z
    .string()
    .min(1, 'El archivo está vacío.')
    .max(900_000, 'El logo supera el máximo de 500 KB.'),
});

/**
 * Descarta una subida que no llegó a guardarse. Solo se aceptan URLs http(s) y el servicio comprueba
 * que el objeto esté bajo el prefijo del bucket y que ningún convenio lo esté usando.
 */
export const agreementLogoDiscardSchema = z.object({
  url: z.url({ protocol: /^https$/, error: 'La URL del logo no es válida.' }).max(2_000),
});

export const agreementListQuerySchema = z.object({
  search: z.string().trim().max(191, 'La búsqueda es demasiado larga.').default(''),
  // Los inactivos no se ocultan solos: el filtro decide qué se ve.
  active: z.enum(['all', 'active', 'inactive']).default('all'),
  region: z.string().trim().max(32).optional(),
  cityCode: z.string().trim().max(32).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['companyName', 'nit', 'createdAt', 'updatedAt']).default('createdAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

export const agreementCommentsQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

// Los comentarios son el historial de lo hablado con la empresa: se crean y se leen, nunca se
// editan ni se eliminan.
export const createAgreementCommentSchema = z.object({
  comment: z
    .string()
    .trim()
    .min(1, 'Escribe un comentario.')
    .max(5_000, 'El comentario no puede superar los 5000 caracteres.'),
});

export const agreementTaskStatusSchema = z.enum(['PENDING', 'COMPLETED', 'CANCELLED']);

export const agreementTasksQuerySchema = z.object({
  status: agreementTaskStatusSchema.optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export const createAgreementTaskSchema = z.object({
  title: z
    .string()
    .trim()
    .min(1, 'Escribe el título de la tarea.')
    .max(255, 'El título no puede superar los 255 caracteres.'),
  description: optionalText(5_000),
  scheduledAt: agreementScheduledAtSchema,
  assignedUserId: agreementOptionalUserIdSchema,
});

// El estado no se edita a mano: se completa o se cancela con sus propias acciones.
export const updateAgreementTaskSchema = z
  .object({
    title: z.string().trim().min(1, 'Escribe el título de la tarea.').max(255).optional(),
    description: optionalText(5_000).optional(),
    scheduledAt: agreementScheduledAtSchema.optional(),
    assignedUserId: agreementOptionalUserIdSchema.optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'Debes enviar al menos un cambio.');

export type ExternalProductQuery = z.infer<typeof externalProductQuerySchema>;
export type CreateProductLinkInput = z.infer<typeof createProductLinkSchema>;
export type SiigoProductLookupQuery = z.infer<typeof siigoProductLookupQuerySchema>;
export type SiigoProductUpdateInput = z.infer<typeof siigoProductUpdateSchema>;
export type NotificationListQuery = z.infer<typeof notificationListQuerySchema>;

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type UserListQuery = z.infer<typeof userListQuerySchema>;
export type CreateCustomerInput = z.infer<typeof createCustomerSchema>;
export type UpdateCustomerInput = z.infer<typeof updateCustomerSchema>;
export type CustomerListQuery = z.infer<typeof customerListQuerySchema>;
export type CustomerSyncStatusFilter = z.infer<typeof customerSyncStatusFilterSchema>;
export type CustomerSiigoLookupQuery = z.infer<typeof customerSiigoLookupSchema>;
export type CustomerResolveQuery = z.infer<typeof customerResolveQuerySchema>;
export type CustomerSyncInput = z.infer<typeof customerSyncSchema>;
export type CustomerSiigoLocationInput = z.infer<typeof customerSiigoLocationSchema>;
export type CreateCouponInput = z.infer<typeof createCouponSchema>;
export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;
export type CouponListQuery = z.infer<typeof couponListQuerySchema>;
export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export type BulkProductSyncInput = z.infer<typeof bulkProductSyncSchema>;

export type CreateAgreementInput = z.infer<typeof createAgreementSchema>;
export type UpdateAgreementInput = z.infer<typeof updateAgreementSchema>;
export type AgreementListQuery = z.infer<typeof agreementListQuerySchema>;
export type AgreementCommentsQuery = z.infer<typeof agreementCommentsQuerySchema>;
export type CreateAgreementCommentInput = z.infer<typeof createAgreementCommentSchema>;
export type AgreementTasksQuery = z.infer<typeof agreementTasksQuerySchema>;
export type CreateAgreementTaskInput = z.infer<typeof createAgreementTaskSchema>;
export type UpdateAgreementTaskInput = z.infer<typeof updateAgreementTaskSchema>;
export type AgreementTaskStatusInput = z.infer<typeof agreementTaskStatusSchema>;

// --- Prospectos ------------------------------------------------------------------------------
// Un prospecto admite datos incompletos: casi todo es opcional y lo único que se exige es que el
// registro no quede vacío. Los campos replican los de Clientes para que la conversión sea un mapeo
// directo, sin renombrar nada.

export const prospectIdSchema = z.coerce
  .number()
  .int('El identificador del prospecto no es válido.')
  .positive('El identificador del prospecto no es válido.');

export const tagIdSchema = z.coerce
  .number()
  .int('El identificador de la etiqueta no es válido.')
  .positive('El identificador de la etiqueta no es válido.');

export const prospectStatusSchema = z.enum([
  'NEW',
  'IN_PROGRESS',
  'QUALIFIED',
  'CONVERTED',
  'LOST',
]);

export const prospectSourceSchema = z.enum(['MANUAL', 'WHATSAPP', 'WEB', 'REFERRAL', 'OTHER']);

const prospectOptionalUserIdSchema = z
  .union([userIdSchema, z.literal(''), z.null(), z.undefined()])
  .optional()
  .transform((value) => value || null);

const prospectOptionalAgreementIdSchema = z
  .union([
    z.coerce.number().int().positive('El identificador del convenio no es válido.'),
    z.literal(''),
    z.null(),
    z.undefined(),
  ])
  .optional()
  .transform((value) => (value === '' || value === undefined ? null : value));

const prospectFieldSchemas = {
  personType: z
    .union([customerPersonTypeSchema, z.literal(''), z.null(), z.undefined()])
    .optional()
    .transform((value) => value || null),
  firstName: optionalText(191),
  lastName: optionalText(191),
  company: optionalText(255),
  documentType: z
    .union([z.string().trim().max(20), z.null(), z.undefined()])
    .optional()
    .transform((value) => value || null),
  documentNumber: z
    .union([z.string().trim().max(20), z.null(), z.undefined()])
    .optional()
    .transform((value) => value || null),
  checkDigit: z
    .union([
      z.string().trim().regex(/^\d$/, 'El dígito de verificación debe ser un número.'),
      z.literal(''),
      z.null(),
      z.undefined(),
    ])
    .optional()
    .transform((value) => value || null),
  email: z
    .union([emailSchema, z.literal(''), z.null(), z.undefined()])
    .optional()
    .transform((value) => value || null),
  // El teléfono se valida contra el país cuando se conoce; si no, se acepta E.164 directo. La
  // normalización real la hace el backend con la utilidad de Clientes.
  phone: z
    .union([
      z
        .string()
        .trim()
        .transform((value) => value.replace(/[\s().-]/g, ''))
        .pipe(
          z
            .string()
            .regex(
              /^\+?[0-9]{7,15}$/,
              'El teléfono debe usar formato internacional, por ejemplo +573001234567.',
            ),
        ),
      z.literal(''),
      z.null(),
      z.undefined(),
    ])
    .optional()
    .transform((value) => value || null),
  country: z
    .union([
      z.string().trim().toUpperCase().length(2, 'Selecciona un país válido.'),
      z.literal(''),
      z.null(),
      z.undefined(),
    ])
    .optional()
    .transform((value) => value || null),
  region: optionalText(32),
  cityCode: optionalText(32),
  cityName: optionalText(191),
  postalCode: optionalText(32),
  addressLine1: optionalText(255),
  addressLine2: optionalText(255),
  agreementId: prospectOptionalAgreementIdSchema,
  source: prospectSourceSchema.optional(),
  status: prospectStatusSchema.optional(),
  assignedUserId: prospectOptionalUserIdSchema,
  tagIds: z
    .array(z.coerce.number().int().positive())
    .max(20, 'Un prospecto no puede tener más de 20 etiquetas.')
    .optional(),
} as const;

const prospectFieldsSchema = z.object(prospectFieldSchemas);

// Un prospecto con solo estado, origen, convenio, comercial o notas no sirve de nada: exige al
// menos un dato que permita identificarlo o contactarlo.
const prospectIdentityFields = [
  'firstName',
  'lastName',
  'company',
  'documentNumber',
  'email',
  'phone',
] as const;

function hasProspectIdentity(
  input: Record<(typeof prospectIdentityFields)[number], string | null>,
) {
  return prospectIdentityFields.some((field) => Boolean(input[field]));
}

export const createProspectSchema = prospectFieldsSchema.superRefine((input, context) => {
  if (!hasProspectIdentity(input)) {
    context.addIssue({
      code: 'custom',
      path: ['firstName'],
      message:
        'Ingresa al menos un dato del prospecto: nombre, empresa, documento, correo o teléfono.',
    });
  }
});

export const updateProspectSchema = prospectFieldsSchema
  .partial()
  .refine((data) => Object.keys(data).length > 0, 'Debes enviar al menos un cambio.');

export const prospectListQuerySchema = z.object({
  search: z.string().trim().max(191, 'La búsqueda es demasiado larga.').default(''),
  // CONVERTED no se mezcla con el trabajo diario: solo aparece si se pide explícitamente.
  status: z.union([prospectStatusSchema, z.literal('all')]).default('all'),
  source: prospectSourceSchema.optional(),
  assignedUserId: userIdSchema.optional(),
  unassigned: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((value) => value === true || value === 'true')
    .optional(),
  agreementId: z.coerce.number().int().positive().optional(),
  tagId: z.coerce.number().int().positive().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  sort: z.enum(['displayName', 'createdAt', 'updatedAt', 'status']).default('updatedAt'),
  order: z.enum(['asc', 'desc']).default('desc'),
});

// La conversión reutiliza el mismo contrato que el alta de Clientes: si Clientes cambia, la
// conversión cambia con él y no hay dos validaciones que se desincronicen.
export const prospectConvertSchema = createCustomerSchema;

/** La importación comparte el límite con la de productos: 800 KB de texto caben en un POST. */
export const prospectImportCsvSchema = z.object({
  csv: z
    .string()
    .min(1, 'El archivo CSV está vacío.')
    .max(800_000, 'El archivo CSV supera el tamaño máximo permitido.'),
});

export const prospectConvertLinkSchema = z.object({
  customerId: z.coerce
    .number()
    .int('El identificador del cliente no es válido.')
    .positive('El identificador del cliente no es válido.'),
});

/** Color de la etiqueta en hex `#RRGGBB`. Se guarda así porque es lo que devuelve el selector. */
export const tagColorSchema = z
  .string()
  .trim()
  .regex(/^#[0-9a-fA-F]{6}$/, 'El color debe ser hexadecimal, por ejemplo #2563EB.');

export const createTagSchema = z.object({
  name: z
    .string()
    .trim()
    .min(1, 'Escribe el nombre de la etiqueta.')
    .max(100, 'El nombre de la etiqueta no puede superar los 100 caracteres.'),
  color: tagColorSchema.nullish(),
  active: z.boolean().default(true),
});

export const updateTagSchema = z
  .object({
    name: z
      .string()
      .trim()
      .min(1, 'Escribe el nombre de la etiqueta.')
      .max(100, 'El nombre de la etiqueta no puede superar los 100 caracteres.')
      .optional(),
    color: tagColorSchema.nullish(),
    active: z.boolean().optional(),
  })
  .refine((data) => Object.keys(data).length > 0, 'Debes enviar al menos un cambio.');

export const tagListQuerySchema = z.object({
  // `.optional()` va al final: en Zod v4 una unión con `undefined` no marca la clave como
  // opcional, y el esquema la exigiría aunque no llegue en la query.
  active: z
    .union([z.literal('true'), z.literal('false'), z.boolean()])
    .transform((value) => value === true || value === 'true')
    .optional(),
});

export type CreateProspectInput = z.infer<typeof createProspectSchema>;
export type UpdateProspectInput = z.infer<typeof updateProspectSchema>;
export type ProspectListQuery = z.infer<typeof prospectListQuerySchema>;
export type ProspectConvertInput = z.infer<typeof prospectConvertSchema>;
export type ProspectConvertLinkInput = z.infer<typeof prospectConvertLinkSchema>;
export type ProspectImportCsvInput = z.infer<typeof prospectImportCsvSchema>;
export type CreateTagInput = z.infer<typeof createTagSchema>;
export type UpdateTagInput = z.infer<typeof updateTagSchema>;
export type TagListQuery = z.infer<typeof tagListQuerySchema>;
export type ProspectStatusInput = z.infer<typeof prospectStatusSchema>;
export type ProspectSourceInput = z.infer<typeof prospectSourceSchema>;
