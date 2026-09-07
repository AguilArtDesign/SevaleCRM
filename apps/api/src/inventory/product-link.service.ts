import {
  ConflictException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { CreateProductLinkInput } from '@sevale/validation';
import type { Product, SyncStatus } from '../generated/prisma/client.js';
import { SiigoService, type SiigoProduct } from '../integrations/siigo/siigo.service.js';
import {
  WooCommerceService,
  type WooCommerceProduct,
} from '../integrations/woocommerce/woocommerce.service.js';
import { ProductsRepository } from './products.repository.js';
import { serializeProduct } from './products.service.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { NotificationsService } from '../notifications/notifications.service.js';

export type ProductLinkPreview = {
  sku: string;
  isLinked: boolean;
  siigo: SiigoProduct;
  store: WooCommerceProduct;
  syncStatus: SyncStatus;
  canLink: boolean;
  issues: string[];
};

function businessError(
  Exception: typeof ConflictException | typeof NotFoundException,
  code: string,
  message: string,
) {
  return new Exception({ success: false, error: { code, message } });
}

function requiredDataIssues(siigo: SiigoProduct, store: WooCommerceProduct): string[] {
  const issues: string[] = [];
  if (siigo.priceCop === null) issues.push('Siigo no devolvió el precio PESOS.');
  if (siigo.priceUsd === null) issues.push('Siigo no devolvió el precio DOLAR.');
  if (!store.parentId) issues.push('WooCommerce no devolvió el producto padre.');
  if (store.priceCop === null) issues.push('WooCommerce no devolvió el precio COP.');
  if (store.priceUsd === null) issues.push('WooCommerce no devolvió un precio USD válido.');
  if (store.stock === null) issues.push('WooCommerce no devolvió el stock de la variación.');
  if (!store.productName) issues.push('WooCommerce no devolvió el nombre del producto.');
  return issues;
}

function calculateSyncStatus(
  siigo: SiigoProduct,
  store: WooCommerceProduct,
  issues: string[],
): SyncStatus {
  if (issues.length > 0) return 'ERROR';
  return siigo.priceCop === store.priceCop &&
    siigo.priceUsd === store.priceUsd &&
    siigo.stock === store.stock
    ? 'SYNCED'
    : 'OUT_OF_SYNC';
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function numericChange(previous: number, current: number) {
  return previous === current ? null : { previous, current };
}

function productChanges(previous: Product, preview: ProductLinkPreview) {
  return {
    priceCop: numericChange(Number(previous.siigoPriceCop), preview.siigo.priceCop as number),
    priceUsd: numericChange(Number(previous.siigoPriceUsd), preview.siigo.priceUsd as number),
    stock: numericChange(previous.siigoStock, preview.siigo.stock),
    syncStatus:
      previous.syncStatus === preview.syncStatus
        ? null
        : { previous: previous.syncStatus, current: preview.syncStatus },
  };
}

@Injectable()
export class ProductLinkService {
  constructor(
    private readonly products: ProductsRepository,
    private readonly siigo: SiigoService,
    private readonly wooCommerce: WooCommerceService,
    private readonly realtime: RealtimeGateway,
    private readonly notifications: NotificationsService,
  ) {}

  async preview(sku: string): Promise<ProductLinkPreview> {
    const existingProduct = await this.products.findBySku(sku);

    const siigo = await this.siigo.searchProductBySku(sku);
    if (!siigo) {
      throw businessError(
        NotFoundException,
        'PRODUCT_NOT_FOUND_IN_SIIGO',
        'El producto no fue encontrado en Siigo.',
      );
    }

    const [seratus, pali] = await Promise.all([
      this.wooCommerce.searchProductBySku('SERATUS', sku),
      this.wooCommerce.searchProductBySku('PALI', sku),
    ]);
    if (!seratus && !pali) {
      throw businessError(
        NotFoundException,
        'PRODUCT_NOT_FOUND_IN_STORE',
        'El producto no fue encontrado en Seratus ni en Pali.',
      );
    }
    if (seratus && pali) {
      throw businessError(
        ConflictException,
        'PRODUCT_FOUND_IN_MULTIPLE_STORES',
        'El SKU existe en Seratus y Pali. Debes corregirlo antes de vincularlo.',
      );
    }

    const store = seratus ?? pali;
    if (!store) {
      throw businessError(
        NotFoundException,
        'PRODUCT_NOT_FOUND_IN_STORE',
        'El producto no fue encontrado en una tienda.',
      );
    }
    const issues = requiredDataIssues(siigo, store);
    return {
      sku,
      isLinked: existingProduct !== null,
      siigo,
      store,
      syncStatus: calculateSyncStatus(siigo, store, issues),
      canLink: issues.length === 0,
      issues,
    };
  }

  async create({ sku }: CreateProductLinkInput) {
    if (await this.products.findBySku(sku)) {
      throw businessError(
        ConflictException,
        'PRODUCT_ALREADY_LINKED',
        'Este producto ya está vinculado.',
      );
    }

    const preview = await this.preview(sku);
    if (!preview.canLink) {
      throw new UnprocessableEntityException({
        success: false,
        error: {
          code: 'EXTERNAL_PRODUCT_DATA_INVALID',
          message: 'El producto tiene datos externos incompletos y no puede vincularse.',
          details: preview.issues,
        },
      });
    }

    const { siigo, store } = preview;
    if (
      siigo.priceCop === null ||
      siigo.priceUsd === null ||
      store.parentId === null ||
      store.priceCop === null ||
      store.priceUsd === null ||
      store.stock === null
    ) {
      throw new UnprocessableEntityException('Los datos externos están incompletos.');
    }

    try {
      const product = await this.products.create({
        siigoId: siigo.id,
        sku: siigo.sku,
        siigoPriceCop: siigo.priceCop,
        siigoPriceUsd: siigo.priceUsd,
        siigoStock: siigo.stock,
        store: store.store,
        wooParentId: BigInt(store.parentId),
        wooVariationId: BigInt(store.variationId),
        wooSku: store.sku,
        wooPriceCop: store.priceCop,
        wooPriceUsd: store.priceUsd,
        wooStock: store.stock,
        syncStatus: preview.syncStatus,
        lastCheckAt: new Date(),
        productName: store.productName,
        imageUrl: store.imageUrl,
      });
      await this.notifications.createProductLinked(product);
      this.realtime.emitProductCreated(product);
      return serializeProduct(product);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw businessError(
          ConflictException,
          'PRODUCT_ALREADY_LINKED',
          'Este producto ya está vinculado.',
        );
      }
      throw error;
    }
  }

  async update({ sku }: CreateProductLinkInput) {
    const existingProduct = await this.products.findBySku(sku);
    if (!existingProduct) {
      throw businessError(
        NotFoundException,
        'PRODUCT_LINK_NOT_FOUND',
        'Este producto todavía no está vinculado.',
      );
    }

    const preview = await this.preview(sku);
    if (!preview.canLink) {
      throw new UnprocessableEntityException({
        success: false,
        error: {
          code: 'EXTERNAL_PRODUCT_DATA_INVALID',
          message: 'El producto tiene datos externos incompletos y no puede actualizarse.',
          details: preview.issues,
        },
      });
    }

    const { siigo, store } = preview;
    if (
      siigo.priceCop === null ||
      siigo.priceUsd === null ||
      store.parentId === null ||
      store.priceCop === null ||
      store.priceUsd === null ||
      store.stock === null
    ) {
      throw new UnprocessableEntityException('Los datos externos están incompletos.');
    }

    const updated = await this.products.update(existingProduct.id, {
      siigoId: siigo.id,
      sku: siigo.sku,
      siigoPriceCop: siigo.priceCop,
      siigoPriceUsd: siigo.priceUsd,
      siigoStock: siigo.stock,
      store: store.store,
      wooParentId: BigInt(store.parentId),
      wooVariationId: BigInt(store.variationId),
      wooSku: store.sku,
      wooPriceCop: store.priceCop,
      wooPriceUsd: store.priceUsd,
      wooStock: store.stock,
      syncStatus: preview.syncStatus,
      lastCheckAt: new Date(),
      productName: store.productName,
      imageUrl: store.imageUrl,
    });
    const changes = productChanges(existingProduct, preview);
    await this.notifications.createProductChanges(updated, changes);
    this.realtime.emitProductUpdated(updated, changes);
    return serializeProduct(updated);
  }
}
