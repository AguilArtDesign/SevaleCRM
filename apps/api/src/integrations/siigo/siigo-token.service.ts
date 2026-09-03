import { Injectable } from '@nestjs/common';
import {
  integrationPost,
  integrationUrl,
  invalidIntegrationResponse,
  requireIntegrationValue,
} from '../integration-http.js';
import { SiigoTokenRepository } from './siigo-token.repository.js';

const TOKEN_EXPIRY_MARGIN_MS = 60_000;
const DEFAULT_PROVIDER = 'SIIGO';

type TokenResponse = {
  accessToken: string;
  expiresIn: number;
};

function normalizeTokenResponse(payload: unknown): TokenResponse | null {
  if (typeof payload !== 'object' || payload === null || Array.isArray(payload)) return null;
  const response = payload as Record<string, unknown>;
  const accessToken = typeof response.access_token === 'string' ? response.access_token.trim() : '';
  const expiresIn =
    typeof response.expires_in === 'number' ? response.expires_in : Number(response.expires_in);
  if (!accessToken || !Number.isFinite(expiresIn) || expiresIn <= 0) return null;
  return { accessToken, expiresIn };
}

function isUsable(expiresAt: Date): boolean {
  return expiresAt.getTime() - Date.now() > TOKEN_EXPIRY_MARGIN_MS;
}

@Injectable()
export class SiigoTokenService {
  private refreshPromise: Promise<string> | null = null;

  constructor(private readonly tokens: SiigoTokenRepository) {}

  async getAccessToken(): Promise<string> {
    const stored = await this.tokens.find(this.provider());
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
    const provider = this.provider();
    const stored = await this.tokens.find(provider);
    const wasAlreadyReplaced =
      rejectedToken !== undefined && stored?.accessToken !== rejectedToken && stored !== null;
    if (
      stored &&
      isUsable(stored.expiresAt) &&
      (rejectedToken === undefined || wasAlreadyReplaced)
    ) {
      return stored.accessToken;
    }

    const baseUrl = requireIntegrationValue('SIIGO_API_URL', 'Siigo');
    const username = requireIntegrationValue('SIIGO_USERNAME', 'Siigo');
    const accessKey = requireIntegrationValue('SIIGO_ACCESS_KEY', 'Siigo');
    const partnerId = requireIntegrationValue('SIIGO_PARTNER_ID', 'Siigo');
    const payload = await integrationPost(
      integrationUrl(baseUrl, '../auth'),
      { 'Partner-Id': partnerId },
      { username, access_key: accessKey },
      'Siigo',
    );
    const token = normalizeTokenResponse(payload);
    if (!token) throw invalidIntegrationResponse('Siigo');

    const expiresAt = new Date(Date.now() + token.expiresIn * 1000);
    await this.tokens.save(provider, token.accessToken, expiresAt);
    return token.accessToken;
  }

  private provider(): string {
    return process.env.SIIGO_TOKEN_PROVIDER?.trim() || DEFAULT_PROVIDER;
  }
}
