import { requireIntegrationValue } from '../integration-http.js';

/**
 * Parámetros fijos que Puntos Colombia exige en cada llamada. Se leen del entorno y no del código
 * para poder pasar de UAT a producción sin tocar la lógica de negocio. UAT es el único ambiente
 * habilitado hoy.
 *
 * El `LocationCode` **no** está aquí: es el punto de venta de cada usuario, no de la empresa, y se
 * resuelve en cada petición desde su ficha (`PointsLocationService`).
 */
export type PuntosColombiaConfig = {
  baseUrl: string;
  partnerCode: string;
  channel: string;
  remoteIp: string;
  terminalId: string;
  cashierId: string;
};

export function puntosColombiaConfig(): PuntosColombiaConfig {
  return {
    baseUrl: requireIntegrationValue('PCO_BASE_URL', 'Puntos Colombia'),
    partnerCode: requireIntegrationValue('PCO_PARTNER_CODE', 'Puntos Colombia'),
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

/**
 * Alta manual de facturas de prueba desde el panel. Es una ayuda de certificación, no una función de
 * negocio: cuando el CRM apunte al ambiente real del proveedor debe apagarse, para que nadie meta
 * facturas inventadas en un historial que ya es de producción. Ausente equivale a encendido, igual
 * que la bandera de administrador, porque hoy el único ambiente conectado es UAT.
 */
export function puntosColombiaUatEnabled(): boolean {
  const value = process.env.PCO_UAT_ENABLED?.trim().toLowerCase();
  return value !== 'false';
}

/**
 * Modalidad de cálculo del pago mixto. `SEND` envía en `mainPointsRedeemed`/`mainPointsAccumulated`
 * los puntos calculados por el CRM; `ZERO` envía ceros y deja que el proveedor los calcule a partir
 * de `totalCashRedeemed` y de los medios de pago.
 *
 * `SEND` se validó en UAT el 2026-11-23 con una operación completa y su anulación. `ZERO` sigue sin
 * probarse: el ejemplo del portal muestra ceros, pero es un ejemplo estático y no una petición
 * validada.
 */
export type PuntosColombiaMixedPointsMode = 'SEND' | 'ZERO';

export function puntosColombiaMixedPointsMode(): PuntosColombiaMixedPointsMode {
  return process.env.PCO_MIXED_POINTS_MODE?.trim().toLowerCase() === 'zero' ? 'ZERO' : 'SEND';
}

/**
 * Código del medio de pago con el que se registra la parte en dinero del pago mixto. `UN` funcionó
 * en la prueba UAT del 2026-11-23 y es el valor del ejemplo del portal; se deja configurable por si
 * el proveedor confirma otro código para los distintos medios.
 */
export function puntosColombiaMixedPaymentMethodCode(): string {
  return process.env.PCO_MIXED_PAYMENT_METHOD_CODE?.trim() || 'UN';
}
