import { requireIntegrationValue } from '../integration-http.js';

/**
 * Parámetros fijos que Puntos Colombia exige en cada llamada. Se leen del entorno y no del código
 * para poder pasar de UAT a producción sin tocar la lógica de negocio. UAT es el único ambiente
 * habilitado hoy.
 */
export type PuntosColombiaConfig = {
  baseUrl: string;
  partnerCode: string;
  locationCode: string;
  channel: string;
  remoteIp: string;
  terminalId: string;
  cashierId: string;
};

export function puntosColombiaConfig(): PuntosColombiaConfig {
  return {
    baseUrl: requireIntegrationValue('PCO_BASE_URL', 'Puntos Colombia'),
    partnerCode: requireIntegrationValue('PCO_PARTNER_CODE', 'Puntos Colombia'),
    locationCode: requireIntegrationValue('PCO_LOCATION_CODE', 'Puntos Colombia'),
    channel: process.env.PCO_CA_CHANNEL?.trim() || 'V',
    // La cabecera es informativa para el proveedor: identifica el origen de la petición, no autoriza.
    remoteIp: process.env.PCO_REMOTE_IPV4?.trim() || '0.0.0.0',
    terminalId: process.env.PCO_TERMINAL_ID?.trim() || 'PCAliados-01',
    cashierId: process.env.PCO_CASHIER_ID?.trim() || 'Yohander-01',
  };
}

/** Cabeceras comunes a todas las llamadas autenticadas. */
export function puntosColombiaHeaders(config: PuntosColombiaConfig, token: string) {
  return {
    Authorization: `Bearer ${token}`,
    'CA-CHANNEL': config.channel,
    'X-REMOTE-IP': config.remoteIp,
  };
}

/**
 * Mientras no haya autorización explícita, el panel solo lo ve y lo opera el administrador. El
 * permiso del rol ya lo exige el panel; esta bandera permite cerrarlo del todo sin desplegar código.
 */
export function puntosColombiaAdminOnly(): boolean {
  const value = process.env.PCO_ADMIN_ONLY?.trim().toLowerCase();
  // Ausente significa encendido: es la configuración segura mientras se certifica.
  return value !== 'false';
}
