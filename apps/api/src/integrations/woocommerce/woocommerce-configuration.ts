import type { Store } from '../../generated/prisma/client.js';
import { requireIntegrationValue } from '../integration-http.js';

export type WooCommerceConfiguration = {
  label: string;
  apiUrl: string;
  consumerKey: string;
  consumerSecret: string;
};

export function wooCommerceConfiguration(store: Store): WooCommerceConfiguration {
  const prefix = store === 'SERATUS' ? 'SERATUS' : 'PALI';
  const label = store === 'SERATUS' ? 'Seratus' : 'Pali';
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
