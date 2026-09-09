import { z } from 'zod';

const TEST_TURNSTILE_SECRETS = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
]);
const TEST_TURNSTILE_SITE_KEYS = new Set([
  '1x00000000000000000000AA',
  '1x00000000000000000000BB',
  '2x00000000000000000000AB',
  '2x00000000000000000000BB',
  '3x00000000000000000000FF',
]);

const urlSchema = z.url().refine((value) => !value.endsWith('/'), {
  message: 'no debe terminar en /',
});
const httpsUrlSchema = z
  .url({ protocol: /^https$/ })
  .refine((value) => !value.endsWith('/'), { message: 'no debe terminar en /' });
const requiredText = z.string().trim().min(1);

const baseEnvironmentSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(3000),
  TRUST_PROXY: z.enum(['true', 'false']).default('false'),
  FRONTEND_URL: urlSchema.default('http://localhost:5173'),
  BETTER_AUTH_URL: urlSchema.default('http://localhost:3000'),
  DATABASE_URL: z.string().startsWith('mysql://', 'debe usar el protocolo mysql://'),
  BETTER_AUTH_SECRET: z.string().optional(),
  TURNSTILE_SECRET_KEY: z.string().optional(),
  N8N_API_KEY: z.string().optional(),
  PRODUCT_IMPORT_ENABLED: z.enum(['true', 'false']).default('false'),
  SMTP_PORT: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.coerce.number().int().min(1).max(65535).optional(),
  ),
  SMTP_SECURE: z.enum(['true', 'false']).optional(),
});

export type RuntimeEnvironment = z.infer<typeof baseEnvironmentSchema>;

function formatIssues(error: z.ZodError): string {
  return error.issues.map((issue) => `${issue.path.join('.')}: ${issue.message}`).join('; ');
}

export function validateRuntimeEnvironment(): RuntimeEnvironment {
  const parsed = baseEnvironmentSchema.safeParse(process.env);
  if (!parsed.success) {
    throw new Error(`Configuración de entorno inválida: ${formatIssues(parsed.error)}`);
  }

  const environment = parsed.data;
  if (environment.NODE_ENV === 'production') {
    const productionChecks = z
      .object({
        FRONTEND_URL: httpsUrlSchema,
        BETTER_AUTH_URL: httpsUrlSchema,
        VITE_API_URL: z.preprocess(
          (value) => (value === '' ? undefined : value),
          httpsUrlSchema.optional(),
        ),
        DATABASE_URL: z.url({ protocol: /^mysql$/ }),
        BETTER_AUTH_SECRET: z.string().min(32),
        TURNSTILE_SECRET_KEY: requiredText,
        VITE_TURNSTILE_SITE_KEY: requiredText,
        SMTP_HOST: requiredText,
        SMTP_PORT: z.coerce.number().int().min(1).max(65535),
        SMTP_SECURE: z.enum(['true', 'false']),
        SMTP_USER: requiredText,
        SMTP_PASSWORD: requiredText,
        SMTP_FROM: requiredText,
        SIIGO_API_URL: httpsUrlSchema,
        SIIGO_USERNAME: requiredText,
        SIIGO_ACCESS_KEY: requiredText,
        SIIGO_PARTNER_ID: requiredText,
        SERATUS_API_URL: httpsUrlSchema,
        WOOCOMMERCE_SERATUS_CK: requiredText,
        WOOCOMMERCE_SERATUS_CS: requiredText,
        PALI_API_URL: httpsUrlSchema,
        WOOCOMMERCE_PALI_CK: requiredText,
        WOOCOMMERCE_PALI_CS: requiredText,
        N8N_API_KEY: z.string().min(32),
      })
      .safeParse(process.env);

    if (!productionChecks.success) {
      throw new Error(
        `Configuración de producción inválida: ${formatIssues(productionChecks.error)}`,
      );
    }
    if (!new URL(productionChecks.data.DATABASE_URL).password) {
      throw new Error('DATABASE_URL debe incluir una contraseña en producción.');
    }
    if (TEST_TURNSTILE_SECRETS.has(productionChecks.data.TURNSTILE_SECRET_KEY)) {
      throw new Error('TURNSTILE_SECRET_KEY no puede usar una credencial de prueba en producción.');
    }
    if (TEST_TURNSTILE_SITE_KEYS.has(productionChecks.data.VITE_TURNSTILE_SITE_KEY)) {
      throw new Error(
        'VITE_TURNSTILE_SITE_KEY no puede usar una credencial de prueba en producción.',
      );
    }
  }

  return environment;
}

export function getFrontendOrigin(): string {
  return process.env.FRONTEND_URL || 'http://localhost:5173';
}
