import { Injectable, Logger } from '@nestjs/common';
import type { Coupon, CouponSyncStatus, Store } from '../generated/prisma/client.js';
import {
  WooCommerceService,
  type WooCommerceCouponPayload,
} from '../integrations/woocommerce/woocommerce.service.js';
import { CouponsRepository } from './coupons.repository.js';

export const couponStores: readonly Store[] = ['SERATUS', 'PALI'];

export type CouponSyncAction = 'CREATED' | 'UPDATED' | 'DELETED' | 'SKIPPED' | 'FAILED';

export type CouponSyncOutcome = {
  store: Store;
  action: CouponSyncAction;
  externalId: number | null;
  errorCode: string | null;
  errorMessage: string | null;
};

// La caducidad se envía como cadena vacía para quitarla: su campo es de tipo texto y
// WooCommerce la normaliza a "sin expiración" con StringUtil::is_null_or_empty.
function wooExpires(value: Date | null): string {
  if (!value || Number.isNaN(value.getTime())) return '';
  return `${value.toISOString().slice(0, 10)}T23:59:59`;
}

// Los límites son enteros: WordPress rechaza la cadena vacía con un 400 y el controlador
// ignora un null, así que 0 es el único valor aceptado que significa "sin límite".
function wooLimit(value: number | null): number {
  return value ?? 0;
}

export function toWooCouponPayload(coupon: Coupon): WooCommerceCouponPayload {
  return {
    code: coupon.coupon,
    description: coupon.description ?? '',
    discount_type: coupon.type,
    amount: coupon.amount.toFixed(2),
    date_expires: wooExpires(coupon.dateExpires),
    individual_use: coupon.individualUse,
    exclude_sale_items: coupon.excludeSaleItems,
    usage_limit: wooLimit(coupon.usageLimit),
    usage_limit_per_user: wooLimit(coupon.usageLimitPerUser),
  };
}

function externalIdOf(store: Store, coupon: Coupon): number | null {
  return store === 'SERATUS' ? coupon.seratusCouponId : coupon.paliCouponId;
}

// Extrae únicamente el código y el mensaje normalizados: nunca credenciales ni datos del cliente.
function failureDetails(error: unknown): { code: string | null; message: string } {
  const fallback = 'No fue posible completar la sincronización con la tienda.';
  if (!error || typeof error !== 'object') return { code: null, message: fallback };
  if (!('getResponse' in error) || typeof error.getResponse !== 'function') {
    return { code: null, message: fallback };
  }
  const response: unknown = (error as { getResponse: () => unknown }).getResponse();
  if (!response || typeof response !== 'object') return { code: null, message: fallback };
  const failure = (response as { error?: { code?: unknown; message?: unknown } }).error;
  if (!failure) return { code: null, message: fallback };
  return {
    code: typeof failure.code === 'string' ? failure.code : null,
    message: typeof failure.message === 'string' ? failure.message : fallback,
  };
}

@Injectable()
export class CouponSyncService {
  private readonly logger = new Logger(CouponSyncService.name);

  constructor(
    private readonly coupons: CouponsRepository,
    private readonly wooCommerce: WooCommerceService,
  ) {}

  // Cada tienda es una sincronización independiente: su identificador se persiste en cuanto
  // la tienda confirma, aunque la otra falle, para no volver a crear el cupón en el reintento.
  // El estado resultante resume el intento: las dos tiendas, una sola o ninguna.
  async synchronize(coupon: Coupon): Promise<CouponSyncOutcome[]> {
    const payload = toWooCouponPayload(coupon);
    const outcomes = await Promise.all(
      couponStores.map((store) => this.pushToStore(store, coupon, payload)),
    );
    const succeeded = outcomes.filter((outcome) => outcome.action !== 'FAILED').length;
    const status: CouponSyncStatus =
      succeeded === couponStores.length ? 'SYNCED' : succeeded === 0 ? 'ERROR' : 'PARTIAL';
    await this.coupons.saveSyncStatus(coupon.id, status);
    return outcomes;
  }

  removeFromStores(coupon: Coupon): Promise<CouponSyncOutcome[]> {
    return Promise.all(couponStores.map((store) => this.removeFromStore(store, coupon)));
  }

  private async pushToStore(
    store: Store,
    coupon: Coupon,
    payload: WooCommerceCouponPayload,
  ): Promise<CouponSyncOutcome> {
    const externalId = externalIdOf(store, coupon);
    try {
      if (externalId !== null) {
        await this.wooCommerce.updateCoupon(store, externalId, payload);
        return { store, action: 'UPDATED', externalId, errorCode: null, errorMessage: null };
      }
      const created = await this.wooCommerce.createCoupon(store, payload);
      const createdId = Number(created.id);
      await this.coupons.saveExternalId(coupon.id, store, createdId);
      return {
        store,
        action: 'CREATED',
        externalId: createdId,
        errorCode: null,
        errorMessage: null,
      };
    } catch (error) {
      const operation = externalId === null ? 'crear' : 'actualizar';
      return this.failed(store, coupon, operation, error);
    }
  }

  private async removeFromStore(store: Store, coupon: Coupon): Promise<CouponSyncOutcome> {
    const externalId = externalIdOf(store, coupon);
    if (externalId === null) {
      // Nunca se sincronizó con esta tienda, así que no hay nada que eliminar.
      return { store, action: 'SKIPPED', externalId: null, errorCode: null, errorMessage: null };
    }
    try {
      await this.wooCommerce.deleteCoupon(store, externalId);
      return { store, action: 'DELETED', externalId, errorCode: null, errorMessage: null };
    } catch (error) {
      return this.failed(store, coupon, 'eliminar', error);
    }
  }

  private failed(
    store: Store,
    coupon: Coupon,
    operation: string,
    error: unknown,
  ): CouponSyncOutcome {
    const { code, message } = failureDetails(error);
    this.logger.error(
      `No se pudo ${operation} el cupón ${coupon.coupon} (${coupon.id}) en ${store}: ${code ?? 'sin código'} - ${message}`,
    );
    return {
      store,
      action: 'FAILED',
      externalId: externalIdOf(store, coupon),
      errorCode: code,
      errorMessage: message,
    };
  }
}
