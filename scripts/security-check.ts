import '../apps/api/src/config/load-environment.js';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { validateRuntimeEnvironment } from '../apps/api/src/config/environment.js';

const workspaceRoot = resolve(import.meta.dirname, '..');
const frontendSource = resolve(workspaceRoot, 'apps/web/src');
const frontendBundle = resolve(workspaceRoot, 'apps/web/dist');
const secretNames = [
  'DATABASE_URL',
  'BETTER_AUTH_SECRET',
  'TURNSTILE_SECRET_KEY',
  'INITIAL_ADMIN_PASSWORD',
  'SIIGO_USERNAME',
  'SIIGO_ACCESS_KEY',
  'SIIGO_PARTNER_ID',
  'WOOCOMMERCE_SERATUS_CK',
  'WOOCOMMERCE_SERATUS_CS',
  'WOOCOMMERCE_PALI_CK',
  'WOOCOMMERCE_PALI_CS',
  'SMTP_PASSWORD',
  'N8N_API_KEY',
  'REDIS_PASSWORD',
] as const;
const publicTestValues = new Set([
  '1x0000000000000000000000000000000AA',
  '2x0000000000000000000000000000000AA',
  '3x0000000000000000000000000000000AA',
]);

async function filesUnder(directory: string): Promise<string[]> {
  const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
  const nested = await Promise.all(
    entries.map((entry) => {
      const path = resolve(directory, entry.name);
      return entry.isDirectory() ? filesUnder(path) : Promise.resolve([path]);
    }),
  );
  return nested.flat();
}

async function assertNoSecretReferences(): Promise<void> {
  const sourceFiles = await filesUnder(frontendSource);
  for (const file of sourceFiles) {
    const contents = await readFile(file, 'utf8');
    const forbiddenName = secretNames.find((name) => contents.includes(name));
    if (forbiddenName) {
      throw new Error(`El frontend referencia una variable privada: ${forbiddenName}.`);
    }
  }

  const configuredSecrets = secretNames
    .map((name) => ({ name, value: process.env[name]?.trim() }))
    .filter((secret): secret is { name: (typeof secretNames)[number]; value: string } =>
      Boolean(
        secret.value &&
        secret.value.length >= 8 &&
        !publicTestValues.has(secret.value) &&
        !secret.value.startsWith('ci-only-') &&
        !isSafeLocalDatabaseUrl(secret.name, secret.value),
      ),
    );
  const bundleFiles = await filesUnder(frontendBundle);
  for (const file of bundleFiles) {
    const contents = await readFile(file, 'utf8');
    const leaked = configuredSecrets.find((secret) => contents.includes(secret.value));
    if (leaked) {
      throw new Error(`El bundle frontend contiene el valor de ${leaked.name}.`);
    }
  }

  const repositoryFiles = committableFiles();
  for (const relativePath of repositoryFiles) {
    const contents = await readFile(resolve(workspaceRoot, relativePath), 'utf8');
    const leaked = configuredSecrets.find((secret) => contents.includes(secret.value));
    if (leaked) {
      throw new Error(`Un archivo publicable contiene el valor de ${leaked.name}.`);
    }
  }
}

function isSafeLocalDatabaseUrl(name: string, value: string): boolean {
  if (name !== 'DATABASE_URL') return false;
  try {
    const url = new URL(value);
    return (
      ['127.0.0.1', 'localhost'].includes(url.hostname) &&
      (!url.password || process.env.NODE_ENV === 'test')
    );
  } catch {
    return false;
  }
}

function committableFiles(): string[] {
  const result = spawnSync(
    'git',
    ['ls-files', '--cached', '--others', '--exclude-standard', '-z'],
    { cwd: workspaceRoot, encoding: 'utf8', shell: false, maxBuffer: 5 * 1024 * 1024 },
  );
  if (result.status !== 0) throw new Error('No fue posible enumerar los archivos publicables.');
  return result.stdout.split('\0').filter(Boolean);
}

function assertEnvironmentFileIgnored(): void {
  const result = spawnSync('git', ['check-ignore', '--quiet', '.env'], {
    cwd: workspaceRoot,
    shell: false,
  });
  if (result.status !== 0) throw new Error('El archivo .env no está protegido por .gitignore.');
}

function assertProductionConfiguration(): void {
  const original = { ...process.env };
  Object.assign(process.env, {
    NODE_ENV: 'production',
    FRONTEND_URL: 'https://crm.example.com',
    BETTER_AUTH_URL: 'https://api.example.com',
    VITE_API_URL: 'https://api.example.com',
    DATABASE_URL: 'mysql://crm:production-smoke@db.example.com:3306/sevale_crm',
    BETTER_AUTH_SECRET: 'a'.repeat(32),
    TURNSTILE_SECRET_KEY: 'production-smoke-turnstile-secret',
    VITE_TURNSTILE_SITE_KEY: 'production-smoke-turnstile-site-key',
    SMTP_HOST: 'smtp.example.com',
    SMTP_PORT: '465',
    SMTP_SECURE: 'true',
    SMTP_USER: 'mailer',
    SMTP_PASSWORD: 'not-a-real-password',
    SMTP_FROM: 'crm@example.com',
    SIIGO_API_URL: 'https://siigo.example.com/v1',
    SIIGO_USERNAME: 'production-smoke-user',
    SIIGO_ACCESS_KEY: 'production-smoke-access-key',
    SIIGO_PARTNER_ID: 'production-smoke-partner',
    SERATUS_API_URL: 'https://seratus.example.com/wp-json/wc/v3',
    WOOCOMMERCE_SERATUS_CK: 'production-smoke-seratus-key',
    WOOCOMMERCE_SERATUS_CS: 'production-smoke-seratus-secret',
    PALI_API_URL: 'https://pali.example.com/wp-json/wc/v3',
    WOOCOMMERCE_PALI_CK: 'production-smoke-pali-key',
    WOOCOMMERCE_PALI_CS: 'production-smoke-pali-secret',
    N8N_API_KEY: 'production-smoke-n8n-key-at-least-32-characters',
  });
  let secretRejected = false;
  let siteKeyRejected = false;
  try {
    validateRuntimeEnvironment();
    process.env.TURNSTILE_SECRET_KEY = '1x0000000000000000000000000000000AA';
    try {
      validateRuntimeEnvironment();
    } catch {
      secretRejected = true;
    }
    process.env.TURNSTILE_SECRET_KEY = 'production-smoke-turnstile-secret';
    process.env.VITE_TURNSTILE_SITE_KEY = '1x00000000000000000000AA';
    try {
      validateRuntimeEnvironment();
    } catch {
      siteKeyRejected = true;
    }
  } finally {
    for (const key of Object.keys(process.env)) {
      if (!(key in original)) delete process.env[key];
    }
    Object.assign(process.env, original);
  }
  if (!secretRejected || !siteKeyRejected) {
    throw new Error('Producción aceptó una credencial de prueba de Turnstile.');
  }
}

validateRuntimeEnvironment();
assertEnvironmentFileIgnored();
assertProductionConfiguration();
await assertNoSecretReferences();
console.info('Security check OK: entorno, .env y bundle frontend verificados.');
