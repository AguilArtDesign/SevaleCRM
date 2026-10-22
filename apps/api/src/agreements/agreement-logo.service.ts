import { Injectable } from '@nestjs/common';
import { AwsClient } from 'aws4fetch';
import { randomUUID } from 'node:crypto';

/** Los formatos que se aceptan. Se validan por extensión y por tipo MIME a la vez. */
export const AGREEMENT_LOGO_TYPES = {
  'image/svg+xml': 'svg',
  'image/webp': 'webp',
} as const;

export const AGREEMENT_LOGO_MAX_BYTES = 500_000;

type LogoType = keyof typeof AGREEMENT_LOGO_TYPES;

export type LogoUploadResult = { url: string; key: string };

export function isAgreementLogoType(value: string): value is LogoType {
  return value in AGREEMENT_LOGO_TYPES;
}

/**
 * Un SVG es texto y puede llevar `<script>`, manejadores `on*` o referencias externas. El CRM lo
 * pinta dentro de un `<img>`, donde el navegador no ejecuta scripts, pero la URL del bucket es
 * pública y alguien puede abrirla directamente. Se rechazan los vectores evidentes para no alojar
 * contenido activo en un dominio propio.
 */
function unsafeSvg(svg: string): string | null {
  const lower = svg.toLowerCase();
  if (lower.includes('<script')) return 'El SVG contiene scripts.';
  if (lower.includes('javascript:')) return 'El SVG contiene enlaces javascript:.';
  if (/<foreignobject/.test(lower)) return 'El SVG contiene un objeto externo incrustado.';
  if (/\son[a-z]+\s*=/.test(lower)) return 'El SVG contiene manejadores de eventos.';
  if (/(href|xlink:href)\s*=\s*["']\s*(?!#)/.test(lower)) {
    return 'El SVG referencia recursos externos.';
  }
  return null;
}

export type LogoValidationError = { code: string; message: string };

@Injectable()
export class AgreementLogoService {
  private configuration() {
    const {
      R2_ACCOUNT_ID: accountId,
      R2_ACCESS_KEY_ID: accessKeyId,
      R2_SECRET_ACCESS_KEY: secretAccessKey,
      R2_BUCKET: bucket,
      R2_PUBLIC_URL: publicUrl,
    } = process.env;
    if (!accountId || !accessKeyId || !secretAccessKey || !bucket || !publicUrl) return null;
    return {
      accountId,
      accessKeyId,
      secretAccessKey,
      bucket,
      publicUrl: publicUrl.replace(/\/$/, ''),
    };
  }

  isEnabled(): boolean {
    return this.configuration() !== null;
  }

  status() {
    const configuration = this.configuration();
    return { enabled: configuration !== null, maxBytes: AGREEMENT_LOGO_MAX_BYTES };
  }

  /** Decodifica el archivo y aplica las reglas de tipo, tamaño y contenido. */
  validate(data: Buffer, contentType: string): LogoValidationError | null {
    if (!data.length) return { code: 'LOGO_EMPTY', message: 'El archivo está vacío.' };
    if (data.length > AGREEMENT_LOGO_MAX_BYTES) {
      return {
        code: 'LOGO_TOO_LARGE',
        message: `El logo supera el máximo de ${AGREEMENT_LOGO_MAX_BYTES / 1000} KB.`,
      };
    }
    if (!isAgreementLogoType(contentType)) {
      return { code: 'LOGO_TYPE_NOT_ALLOWED', message: 'El logo debe ser SVG o WebP.' };
    }
    if (contentType === 'image/svg+xml') {
      const problem = unsafeSvg(data.toString('utf8'));
      if (problem) return { code: 'LOGO_SVG_UNSAFE', message: problem };
    }
    return null;
  }

  /**
   * Sube el archivo a R2 con una clave nueva. Nunca se reutiliza la clave de un logo anterior: al
   * ser el bucket público, un nombre estable se cachearía y mostraría el logo viejo.
   */
  async upload(data: Buffer, contentType: LogoType): Promise<LogoUploadResult> {
    const configuration = this.configuration();
    if (!configuration) {
      throw new Error('La subida de logos no está configurada.');
    }

    const key = `agreements/${randomUUID()}.${AGREEMENT_LOGO_TYPES[contentType]}`;
    const client = new AwsClient({
      accessKeyId: configuration.accessKeyId,
      secretAccessKey: configuration.secretAccessKey,
      service: 's3',
      region: 'auto',
    });
    const endpoint = `https://${configuration.accountId}.r2.cloudflarestorage.com/${configuration.bucket}/${key}`;
    const response = await client.fetch(endpoint, {
      method: 'PUT',
      headers: { 'content-type': contentType },
      // `Buffer` no encaja en `BodyInit` según los tipos de DOM; se envía la vista de bytes.
      body: new Uint8Array(data),
    });
    if (!response.ok) {
      throw new Error(`R2 rechazó la subida (${response.status}).`);
    }
    return { url: `${configuration.publicUrl}/${key}`, key };
  }

  /** Borra un logo anterior. Un fallo aquí no debe impedir guardar el convenio. */
  async remove(url: string | null | undefined): Promise<void> {
    const configuration = this.configuration();
    if (!configuration || !url) return;
    const prefix = `${configuration.publicUrl}/`;
    if (!url.startsWith(prefix)) return;
    const key = url.slice(prefix.length);
    if (!key || key.includes('..')) return;

    const client = new AwsClient({
      accessKeyId: configuration.accessKeyId,
      secretAccessKey: configuration.secretAccessKey,
      service: 's3',
      region: 'auto',
    });
    const endpoint = `https://${configuration.accountId}.r2.cloudflarestorage.com/${configuration.bucket}/${key}`;
    await client.fetch(endpoint, { method: 'DELETE' });
  }

  /**
   * Indica si la URL pertenece al bucket configurado y a la carpeta de logos. Es la puerta que evita
   * usar el descarte para borrar objetos ajenos al CRM.
   */
  ownsLogoUrl(url: string): boolean {
    const configuration = this.configuration();
    if (!configuration) return false;
    const prefix = `${configuration.publicUrl}/agreements/`;
    if (!url.startsWith(prefix)) return false;
    const key = url.slice(prefix.length);
    return Boolean(key) && !key.includes('/') && !key.includes('..');
  }
}
