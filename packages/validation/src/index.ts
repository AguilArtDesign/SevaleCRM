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
export type UpdateShipmentInput = z.infer<typeof updateShipmentSchema>;
export type CreateSiigoQuotationInput = z.infer<typeof createSiigoQuotationSchema>;
export type WooOrderInboundInput = z.infer<typeof wooOrderInboundSchema>;

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
export type CustomerSiigoLocationInput = z.infer<typeof customerSiigoLocationSchema>;
export type CreateCouponInput = z.infer<typeof createCouponSchema>;
export type UpdateCouponInput = z.infer<typeof updateCouponSchema>;
export type CouponListQuery = z.infer<typeof couponListQuerySchema>;
export type ProductListQuery = z.infer<typeof productListQuerySchema>;
export type BulkProductSyncInput = z.infer<typeof bulkProductSyncSchema>;
