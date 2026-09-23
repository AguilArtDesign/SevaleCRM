import { ServiceUnavailableException } from '@nestjs/common';
import type { Store } from '../../generated/prisma/client.js';
import { requireIntegrationValue } from '../integration-http.js';

export type WooCommerceConfiguration = {
  label: string;
  apiUrl: string;
  consumerKey: string;
  consumerSecret: string;
};

export type WooCommerceCrmConfiguration = {
  label: string;
  apiUrl: string;
  username: string;
  password: string;
};

function storeNames(store: Store): { prefix: string; label: string } {
  return store === 'SERATUS'
    ? { prefix: 'SERATUS', label: 'Seratus' }
    : { prefix: 'PALI', label: 'Pali' };
}

export function wooCommerceConfiguration(store: Store): WooCommerceConfiguration {
  const { prefix, label } = storeNames(store);
  return {
    label,
    apiUrl: requireIntegrationValue(`${prefix}_API_URL`, label),
    consumerKey: requireIntegrationValue(`WOOCOMMERCE_${prefix}_CK`, label),
    consumerSecret: requireIntegrationValue(`WOOCOMMERCE_${prefix}_CS`, label),
  };
}

export function wooCommerceAuthorizationHeaders(config: WooCommerceConfiguration): HeadersInit {
  const credentials = Buffer.from(`${config.consumerKey}:${config.consumerSecret}`).toString(
    'base64',
  );
  return { Authorization: `Basic ${credentials}` };
}

// El endpoint propio de Sevale vive en /wp-json/sevale/v1, fuera del namespace wc/v3,
// por lo que se resuelve contra el origen del sitio y no contra la URL de la REST API.
function sevaleApiUrl(apiUrl: string, label: string): string {
  try {
    return `${new URL(apiUrl).origin}/wp-json/sevale/v1`;
  } catch {
    throw new ServiceUnavailableException({
      success: false,
      error: {
        code: 'INTEGRATION_NOT_CONFIGURED',
        message: `La integración con ${label} no está configurada.`,
      },
    });
  }
}

export function wooCommerceCrmConfiguration(store: Store): WooCommerceCrmConfiguration {
  const { prefix, label } = storeNames(store);
  return {
    label,
    apiUrl: sevaleApiUrl(requireIntegrationValue(`${prefix}_API_URL`, label), label),
    username: requireIntegrationValue('WOOCOMMERCE_USERNAME', label),
    password: requireIntegrationValue(`${prefix}_PASSWORD`, label),
  };
}

export function wooCommerceCrmAuthorizationHeaders(
  config: WooCommerceCrmConfiguration,
): HeadersInit {
  const credentials = Buffer.from(`${config.username}:${config.password}`).toString('base64');
  return { Authorization: `Basic ${credentials}` };
}
