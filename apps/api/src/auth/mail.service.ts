import { Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { mkdir, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import nodemailer, { type Transporter } from 'nodemailer';

const DEVELOPMENT_OTP_PATH = fileURLToPath(
  new URL('../../../../.tmp/latest-otp.txt', import.meta.url),
);

@Injectable()
export class MailService {
  private readonly logger = new Logger(MailService.name);
  private readonly transporter: Transporter | null;
  private readonly from: string | null;

  constructor() {
    const host = process.env.SMTP_HOST;
    const port = Number(process.env.SMTP_PORT);
    const secure = process.env.SMTP_SECURE ? process.env.SMTP_SECURE === 'true' : port === 465;
    const user = process.env.SMTP_USER;
    const password = process.env.SMTP_PASSWORD;
    this.from = process.env.SMTP_FROM || null;

    this.transporter =
      host && Number.isInteger(port) && port > 0 && user && password && this.from
        ? nodemailer.createTransport({
            host,
            port,
            secure,
            requireTLS: !secure && process.env.NODE_ENV === 'production',
            auth: { user, pass: password },
            connectionTimeout: 10_000,
            greetingTimeout: 10_000,
            socketTimeout: 15_000,
            tls: { minVersion: 'TLSv1.2' },
            disableFileAccess: true,
            disableUrlAccess: true,
          })
        : null;
  }

  async sendSignInCode(email: string, otp: string): Promise<void> {
    if (!this.transporter || !this.from) {
      if (process.env.NODE_ENV !== 'production') {
        await mkdir(dirname(DEVELOPMENT_OTP_PATH), { recursive: true });
        await writeFile(
          DEVELOPMENT_OTP_PATH,
          [
            'SEVALE CRM - OTP DE DESARROLLO',
            `Código: ${otp}`,
            `Correo: ${email}`,
            `Generado: ${new Date().toLocaleString('es-CO')}`,
            'Expira en 5 minutos. Cada reenvío invalida el código anterior.',
            '',
          ].join('\n'),
          { encoding: 'utf8', mode: 0o600 },
        );
        this.logger.warn('[SOLO DESARROLLO] Código OTP guardado en .tmp/latest-otp.txt');
        return;
      }
      throw new ServiceUnavailableException('El servicio de correo no está configurado.');
    }

    await this.transporter.sendMail({
      from: this.from,
      to: email,
      subject: 'Tu código de acceso a SevaleCRM',
      text: `Tu código de acceso es ${otp}. Expira en 5 minutos.`,
      html: `<p>Tu código de acceso a SevaleCRM es:</p><p style="font-size:24px;font-weight:700;letter-spacing:6px">${otp}</p><p>Expira en 5 minutos y solo puede utilizarse una vez.</p>`,
      disableFileAccess: true,
      disableUrlAccess: true,
    });
  }
}
