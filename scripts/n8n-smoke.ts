import '../apps/api/src/config/load-environment.js';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { AppModule } from '../apps/api/src/app.module.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { Store, SyncStatus } from '../apps/api/src/generated/prisma/client.js';

process.env.BETTER_AUTH_SECRET ||= 'local-n8n-smoke-secret-at-least-32-characters';
const originalApiKey = process.env.N8N_API_KEY;
const apiKey = `n8n-${randomUUID()}`;
process.env.N8N_API_KEY = apiKey;

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
  logger: false,
});
app.setGlobalPrefix('api');
await app.listen(0, '127.0.0.1');

const prisma = app.get(PrismaService);
const baseUrl = await app.getUrl();
const runId = randomUUID();
const siigoId = randomUUID();
const sku = `N8N-CAFÉ-${runId}`;
let productId: number | null = null;

function expectStatus(response: Response, status: number, context: string) {
  if (response.status !== status) {
    throw new Error(`${context}: se esperaba ${status} y se recibió ${response.status}.`);
  }
}

async function post(payload: unknown, authorization?: string) {
  return fetch(`${baseUrl}/api/integrations/siigo/product`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(authorization ? { authorization } : {}),
    },
    body: JSON.stringify(payload),
  });
}

const validPayload = {
  siigo_id: siigoId,
  sku,
  siigo_price_cop: 95000,
  siigo_price_usd: 24.5,
  siigo_stock: 7,
};

try {
  const product = await prisma.product.create({
    data: {
      siigoId,
      sku,
      siigoPriceCop: 90000,
      siigoPriceUsd: 22,
      siigoStock: 10,
      store: Store.SERATUS,
      wooParentId: 701n,
      wooVariationId: 702n,
      wooSku: sku,
      wooPriceCop: 100000,
      wooPriceUsd: 25,
      wooStock: 8,
      syncStatus: SyncStatus.SYNCED,
      productName: 'Producto webhook n8n',
    },
  });
  productId = product.id;

  expectStatus(await post(validPayload), 401, 'Solicitud sin API key');
  const wrongKeyResponse = await post(validPayload, 'Bearer incorrecta');
  expectStatus(wrongKeyResponse, 401, 'Solicitud con API key incorrecta');
  if ((await wrongKeyResponse.text()).includes(apiKey)) {
    throw new Error('La respuesta expuso la API key configurada.');
  }

  delete process.env.N8N_API_KEY;
  expectStatus(await post(validPayload, `Bearer ${apiKey}`), 503, 'Integración no configurada');
  process.env.N8N_API_KEY = apiKey;

  expectStatus(
    await post({ ...validPayload, arbitrary: true }, `Bearer ${apiKey}`),
    400,
    'Payload con campos arbitrarios',
  );
  expectStatus(
    await post({ ...validPayload, siigo_stock: -1 }, `Bearer ${apiKey}`),
    400,
    'Stock negativo',
  );
  expectStatus(
    await post({ ...validPayload, siigo_price_cop: '95000' }, `Bearer ${apiKey}`),
    400,
    'Precio con tipo incorrecto',
  );
  expectStatus(
    await post({ ...validPayload, siigo_id: randomUUID() }, `Bearer ${apiKey}`),
    404,
    'Producto no vinculado',
  );

  expectStatus(
    await post({ ...validPayload, sku: 'SKU-DIFERENTE' }, `Bearer ${apiKey}`),
    409,
    'SKU diferente',
  );
  const beforeUpdate = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  if (Number(beforeUpdate.siigoPriceCop) !== 90000 || beforeUpdate.siigoStock !== 10) {
    throw new Error('El payload rechazado modificó el producto.');
  }

  const updateResponse = await post(validPayload, `Bearer ${apiKey}`);
  expectStatus(updateResponse, 200, 'Actualización normalizada');
  const update = (await updateResponse.json()) as {
    success: boolean;
    product: { syncStatus: string; siigoStock: number; lastCheckAt: string | null };
    changes: {
      priceCop: { previous: number; current: number } | null;
      stock: { previous: number; current: number } | null;
      syncStatus: { previous: string; current: string } | null;
    };
  };
  if (
    !update.success ||
    update.product.syncStatus !== 'OUT_OF_SYNC' ||
    update.product.siigoStock !== 7 ||
    !update.product.lastCheckAt ||
    update.changes.priceCop?.previous !== 90000 ||
    update.changes.priceCop.current !== 95000 ||
    update.changes.stock?.previous !== 10 ||
    update.changes.stock.current !== 7 ||
    update.changes.syncStatus?.current !== 'OUT_OF_SYNC'
  ) {
    throw new Error('La actualización o la detección de cambios no produjo el resultado esperado.');
  }

  const stored = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  if (
    Number(stored.siigoPriceCop) !== 95000 ||
    Number(stored.siigoPriceUsd) !== 24.5 ||
    stored.siigoStock !== 7 ||
    stored.syncStatus !== SyncStatus.OUT_OF_SYNC ||
    Number(stored.wooPriceCop) !== 100000 ||
    Number(stored.wooPriceUsd) !== 25 ||
    stored.wooStock !== 8 ||
    stored.lastSyncAt !== null
  ) {
    throw new Error('La actualización modificó campos incorrectos o alteró WooCommerce.');
  }
  if ((await prisma.notification.count({ where: { productId: product.id } })) !== 3) {
    throw new Error('Los cambios de stock, precio y estado no crearon sus notificaciones.');
  }

  const matchingPayload = {
    ...validPayload,
    siigo_price_cop: 100000,
    siigo_price_usd: 25,
    siigo_stock: 8,
  };
  const matchingResponse = await post(matchingPayload, `Bearer ${apiKey}`);
  expectStatus(matchingResponse, 200, 'Actualización sincronizada');
  const matching = (await matchingResponse.json()) as { product: { syncStatus: string } };
  if (matching.product.syncStatus !== 'SYNCED') {
    throw new Error('El estado no cambió a SYNCED cuando los valores coincidieron.');
  }

  const notificationsBeforeUnchanged = await prisma.notification.count({
    where: { productId: product.id },
  });

  const unchangedResponse = await post(matchingPayload, `Bearer ${apiKey}`);
  expectStatus(unchangedResponse, 200, 'Actualización sin cambios');
  const unchanged = (await unchangedResponse.json()) as {
    changes: Record<string, unknown>;
  };
  if (Object.values(unchanged.changes).some((change) => change !== null)) {
    throw new Error('Una actualización idéntica reportó cambios inexistentes.');
  }
  if (
    (await prisma.notification.count({ where: { productId: product.id } })) !==
    notificationsBeforeUnchanged
  ) {
    throw new Error('La actualización idéntica creó una notificación falsa.');
  }

  process.stdout.write(
    'n8n smoke: API key, strict validation, lookup by Siigo ID, change detection, local update, sync status and Woo preservation checks passed.\n',
  );
} finally {
  if (productId !== null) {
    await prisma.notification.deleteMany({ where: { productId } });
    await prisma.product.deleteMany({ where: { id: productId } });
  }
  await app.close();
  if (originalApiKey === undefined) delete process.env.N8N_API_KEY;
  else process.env.N8N_API_KEY = originalApiKey;
}
