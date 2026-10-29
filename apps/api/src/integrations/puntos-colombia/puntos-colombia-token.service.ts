import { Injectable } from '@nestjs/common';
import {
  IntegrationAuthenticationException,
  integrationPost,
  integrationUrl,
  invalidIntegrationResponse,
  requireIntegrationValue,
} from '../integration-http.js';
import { IntegrationTokenRepository } from '../integration-token.repository.js';
import { puntosColombiaConfig } from './puntos-colombia-config.js';

/** Margen de seguridad: el token se renueva antes de que el proveedor lo dé por vencido. */
const EXPIRY_MARGIN_MS = 90_000;
const PROVIDER = 'PUNTOS_COLOMBIA';

type TokenResponse = { accessToken: string; expiresIn: number };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function normalizeTokenResponse(payload: unknown): TokenResponse | null {
  if (!isRecord(payload)) return null;
  const accessToken = typeof payload.access_token === 'string' ? payload.access_token : '';
  const expiresIn =
    typeof payload.expires_in === 'number' ? payload.expires_in : Number(payload.expires_in);
  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) return null;
  return { accessToken, expiresIn };
}

function isUsable(expiresAt: Date): boolean {
  return expiresAt.getTime() - Date.now() > EXPIRY_MARGIN_MS;
}

/**
 * Token OAuth de Puntos Colombia. Se guarda en la base y se reutiliza: el proveedor no debe recibir
 * una petición de token por cada consulta. Una sola promesa en vuelo evita que dos peticiones
 * simultáneas pidan un token cada una.
 */
@Injectable()
export class PuntosColombiaTokenService {
  private refreshPromise: Promise<string> | null = null;

  constructor(private readonly tokens: IntegrationTokenRepository) {}

  async getAccessToken(): Promise<string> {
    const stored = await this.tokens.find(PROVIDER);
    if (stored && isUsable(stored.expiresAt)) return stored.accessToken;
    return this.refreshAccessToken();
  }

  async refreshAccessToken(rejectedToken?: string): Promise<string> {
    if (this.refreshPromise) return this.refreshPromise;
    const refresh = this.performRefresh(rejectedToken);
    this.refreshPromise = refresh;
    try {
      return await refresh;
    } finally {
      if (this.refreshPromise === refresh) this.refreshPromise = null;
    }
  }

  private async performRefresh(rejectedToken?: string): Promise<string> {
    const stored = await this.tokens.find(PROVIDER);
    // Otra petición pudo renovarlo mientras esta esperaba: si el token guardado ya es otro y sirve,
    // se devuelve en lugar de pedir uno nuevo.
    const wasAlreadyReplaced =
      rejectedToken !== undefined && stored !== null && stored.accessToken !== rejectedToken;
    if (
      stored &&
      isUsable(stored.expiresAt) &&
      (rejectedToken === undefined || wasAlreadyReplaced)
    ) {
      return stored.accessToken;
    }

    const config = puntosColombiaConfig();
    const clientId = requireIntegrationValue('PCO_CLIENT_ID', 'Puntos Colombia');
    const clientSecret = requireIntegrationValue('PCO_CLIENT_SECRET', 'Puntos Colombia');
    const url = integrationUrl(config.baseUrl, 'auth/oauth/v2/token');
    url.searchParams.set('grant_type', 'client_credentials');
    url.searchParams.set('client_secret', clientSecret);
    url.searchParams.set('client_id', clientId);

    // `confidential`: el secreto viaja en la query y la respuesta trae el token, así que no deben
    // quedar en el registro de integraciones.
    const payload = await integrationPost(
      url,
      {
        'CA-CHANNEL': config.channel,
        'CA-PARTNERCODE': config.partnerCode,
        'X-REMOTE-IP': config.remoteIp,
      },
      { partnerCode: config.partnerCode },
      'Puntos Colombia',
      { confidential: true },
    );
    const token = normalizeTokenResponse(payload);
    if (!token) throw invalidIntegrationResponse('Puntos Colombia');

    const expiresAt = new Date(Date.now() + token.expiresIn * 1000);
    await this.tokens.save(PROVIDER, token.accessToken, expiresAt);
    return token.accessToken;
  }

  /** Un 401 de este proveedor no siempre es token vencido; quien llama decide si reintenta. */
  isAuthenticationFailure(error: unknown): boolean {
    return error instanceof IntegrationAuthenticationException;
  }
}
