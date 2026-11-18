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
let simpleProductId: number | null = null;

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

async function get(siigoId: string, authorization?: string) {
  return fetch(
    `${baseUrl}/api/integrations/siigo/product?${new URLSearchParams({ siigo_id: siigoId })}`,
    { headers: authorization ? { authorization } : {} },
  );
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
  const simpleSiigoId = randomUUID();
  const simpleProduct = await prisma.product.create({
    data: {
      siigoId: simpleSiigoId,
      sku: `N8N-SIMPLE-${runId}`,
      siigoPriceCop: 50000,
      siigoPriceUsd: 20,
      siigoStock: 5,
      store: Store.PALI,
      wooParentId: null,
      wooVariationId: 703n,
      wooSku: `N8N-SIMPLE-${runId}`,
      wooPriceCop: 50000,
      wooPriceUsd: 20,
      wooStock: 5,
      syncStatus: SyncStatus.SYNCED,
      productName: 'Producto simple webhook n8n',
    },
  });
  simpleProductId = simpleProduct.id;

  expectStatus(await get(siigoId), 401, 'Consulta sin API key');
  const missingLookupResponse = await get(randomUUID(), `Bearer ${apiKey}`);
  expectStatus(missingLookupResponse, 200, 'Consulta de producto inexistente');
  const missingLookup = (await missingLookupResponse.json()) as {
    exists: boolean;
    product: unknown;
  };
  if (missingLookup.exists || missingLookup.product !== null) {
    throw new Error('La consulta no respondió false para un siigo_id inexistente.');
  }
  const lookupResponse = await get(siigoId, `Bearer ${apiKey}`);
  expectStatus(lookupResponse, 200, 'Consulta de producto existente');
  const lookup = (await lookupResponse.json()) as {
    exists: boolean;
    product: {
      id: number;
      siigoId: string;
      sku: string;
      store: string;
      wooCommerce: { type: string; productId: string | null; variationId: string | null };
    } | null;
  };
  if (
    !lookup.exists ||
    lookup.product?.id !== product.id ||
    lookup.product.siigoId !== siigoId ||
    lookup.product.sku !== sku ||
    lookup.product.store !== 'SERATUS' ||
    lookup.product.wooCommerce.type !== 'VARIATION' ||
    lookup.product.wooCommerce.productId !== '701' ||
    lookup.product.wooCommerce.variationId !== '702'
  ) {
    throw new Error('La consulta no devolvió la ruta WooCommerce vinculada al producto.');
  }
  const simpleLookupResponse = await get(simpleSiigoId, `Bearer ${apiKey}`);
  expectStatus(simpleLookupResponse, 200, 'Consulta de producto simple');
  const simpleLookup = (await simpleLookupResponse.json()) as typeof lookup;
  if (
    !simpleLookup.exists ||
    simpleLookup.product?.id !== simpleProduct.id ||
    simpleLookup.product.wooCommerce.type !== 'SIMPLE' ||
    simpleLookup.product.wooCommerce.productId !== '703' ||
    simpleLookup.product.wooCommerce.variationId !== null
  ) {
    throw new Error('La consulta no devolvió la ruta del producto simple esperada.');
  }

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
  if ((await prisma.notification.count({ where: { productId: product.id } })) !== 1) {
    throw new Error('La actualización de Siigo no creó una única notificación consolidada.');
  }
  const updateNotification = await prisma.notification.findFirstOrThrow({
    where: { productId: product.id },
  });
  if (
    updateNotification.type !== 'SIIGO_PRODUCT_UPDATED' ||
    updateNotification.title !== 'Producto actualizado' ||
    updateNotification.message !== 'Producto webhook n8n'
  ) {
    throw new Error('La notificación de Siigo no conservó el formato o los cambios esperados.');
  }

  const matchingPayload = {
    ...validPayload,
    siigo_price_cop: 100000,
    siigo_price_usd: 25,
    siigo_stock: 8,
    woo_sync: {
      success: true,
      store: 'SERATUS',
      price_cop: 100000,
      price_usd: 25,
      stock: 8,
    },
  };
  const matchingResponse = await post(matchingPayload, `Bearer ${apiKey}`);
  expectStatus(matchingResponse, 200, 'Actualización sincronizada');
  const matching = (await matchingResponse.json()) as {
    product: { syncStatus: string; lastSyncAt: string | null };
  };
  if (matching.product.syncStatus !== 'SYNCED' || !matching.product.lastSyncAt) {
    throw new Error('El resultado WooCommerce no guardó la sincronización confirmada.');
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
    notificationsBeforeUnchanged + 1
  ) {
    throw new Error('La sincronización confirmada no creó su notificación informativa.');
  }
  const syncConfirmationNotification = await prisma.notification.findFirstOrThrow({
    where: { productId: product.id },
    orderBy: { id: 'desc' },
  });
  if (
    syncConfirmationNotification.type !== 'SIIGO_PRODUCT_UPDATED' ||
    syncConfirmationNotification.title !== 'Producto actualizado' ||
    syncConfirmationNotification.message !== 'Producto webhook n8n'
  ) {
    throw new Error('La notificación de sincronización confirmada no tiene el formato esperado.');
  }

  expectStatus(
    await post(
      { ...matchingPayload, woo_sync: { ...matchingPayload.woo_sync, store: 'PALI' } },
      `Bearer ${apiKey}`,
    ),
    409,
    'Tienda WooCommerce diferente',
  );

  // Las monedas nuevas son opcionales: el payload de siempre las deja como estaban. Cuando n8n las
  // envía, entran en la comparación igual que COP y USD.
  const currenciesResponse = await post(
    {
      ...matchingPayload,
      siigo_price_mxn: 847,
      siigo_price_eur: 45,
      woo_sync: { ...matchingPayload.woo_sync, price_mxn: 847, price_eur: 40 },
    },
    `Bearer ${apiKey}`,
  );
  expectStatus(currenciesResponse, 200, 'Monedas nuevas');
  const currencies = (await currenciesResponse.json()) as {
    product: { syncStatus: string; siigoPriceMxn: number | null; siigoPriceEur: number | null };
  };
  if (
    currencies.product.siigoPriceMxn !== 847 ||
    currencies.product.siigoPriceEur !== 45 ||
    currencies.product.syncStatus !== 'OUT_OF_SYNC'
  ) {
    throw new Error('Las monedas MXN y EUR no se guardaron o no entraron en la comparación.');
  }

  const currenciesMatchResponse = await post(
    {
      ...matchingPayload,
      siigo_price_mxn: 847,
      siigo_price_eur: 45,
      woo_sync: { ...matchingPayload.woo_sync, price_mxn: 847, price_eur: 45 },
    },
    `Bearer ${apiKey}`,
  );
  expectStatus(currenciesMatchResponse, 200, 'Monedas nuevas sincronizadas');
  const currenciesMatch = (await currenciesMatchResponse.json()) as {
    product: { syncStatus: string };
  };
  if (currenciesMatch.product.syncStatus !== 'SYNCED') {
    throw new Error('Las cuatro monedas coincidentes no dejaron el producto sincronizado.');
  }

  const beforeFailedSync = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  const failedSyncResponse = await post(
    {
      ...matchingPayload,
      woo_sync: {
        success: false,
        store: 'SERATUS',
        error: 'WooCommerce no respondió dentro del tiempo esperado',
      },
    },
    `Bearer ${apiKey}`,
  );
  expectStatus(failedSyncResponse, 200, 'Resultado WooCommerce fallido');
  const failedSync = (await failedSyncResponse.json()) as {
    product: { syncStatus: string; lastSyncAt: string | null };
  };
  const afterFailedSync = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  if (
    failedSync.product.syncStatus !== 'ERROR' ||
    !failedSync.product.lastSyncAt ||
    afterFailedSync.lastSyncAt?.getTime() !== beforeFailedSync.lastSyncAt?.getTime() ||
    Number(afterFailedSync.wooPriceCop) !== Number(beforeFailedSync.wooPriceCop) ||
    Number(afterFailedSync.wooPriceUsd) !== Number(beforeFailedSync.wooPriceUsd) ||
    afterFailedSync.wooStock !== beforeFailedSync.wooStock
  ) {
    throw new Error('El fallo WooCommerce alteró datos confirmados o la última sincronización.');
  }

  // Bodegas: opcionales, informativas y sin efecto en el estado de sincronización ni en el stock.
  const warehouseBase = {
    siigo_id: matchingPayload.siigo_id,
    sku: matchingPayload.sku,
    siigo_price_cop: matchingPayload.siigo_price_cop,
    siigo_price_usd: matchingPayload.siigo_price_usd,
    siigo_stock: matchingPayload.siigo_stock,
  };

  expectStatus(
    await post(matchingPayload, `Bearer ${apiKey}`),
    200,
    'Restauración antes de bodegas',
  );
  const notificationsBeforeWarehouse = await prisma.notification.count({
    where: { productId: product.id },
  });

  // n8n puede omitir `name`: el nombre visible se resuelve con el glosario del CRM.
  // Siigo puede devolver cantidades negativas («Sin asignar» con -1): se normalizan a 0.
  const warehousesA = [
    { id: -1, quantity: -1 },
    { id: 178, quantity: 5 },
    { id: 177, quantity: 4 },
    { id: 185, quantity: 1 },
    { id: 999, quantity: 1 },
    { id: 1000, quantity: 0 },
    { id: 188, quantity: -3 },
  ];
  const warehouseResponse = await post(
    { ...warehouseBase, siigo_warehouses: warehousesA },
    `Bearer ${apiKey}`,
  );
  expectStatus(warehouseResponse, 200, 'Actualización de bodegas');
  const warehouseUpdate = (await warehouseResponse.json()) as {
    product: {
      siigoStock: number;
      syncStatus: string;
      siigoWarehouses: { id: number; name: string; quantity: number }[] | null;
      siigoWarehousesUpdatedAt: string | null;
    };
    changes: Record<string, unknown>;
  };
  if (
    warehouseUpdate.product.siigoStock !== 8 ||
    warehouseUpdate.product.syncStatus !== 'SYNCED' ||
    warehouseUpdate.product.siigoWarehouses?.length !== 3 ||
    warehouseUpdate.product.siigoWarehouses[0]?.id !== 178 ||
    warehouseUpdate.product.siigoWarehouses[0]?.name !== 'Bodega' ||
    warehouseUpdate.product.siigoWarehouses[0]?.quantity !== 9 ||
    warehouseUpdate.product.siigoWarehouses[1]?.id !== 185 ||
    warehouseUpdate.product.siigoWarehouses[1]?.name !== 'Portal 80' ||
    warehouseUpdate.product.siigoWarehouses[1]?.quantity !== 1 ||
    warehouseUpdate.product.siigoWarehouses[2]?.id !== 999 ||
    warehouseUpdate.product.siigoWarehouses[2]?.name !== 'Bodega 999' ||
    warehouseUpdate.product.siigoWarehouses[2]?.quantity !== 1 ||
    !warehouseUpdate.product.siigoWarehousesUpdatedAt ||
    Object.values(warehouseUpdate.changes).some((change) => change !== null)
  ) {
    throw new Error('La actualización de bodegas devolvió un resultado inesperado.');
  }
  if (
    (await prisma.notification.count({ where: { productId: product.id } })) !==
    notificationsBeforeWarehouse
  ) {
    throw new Error('Una actualización solo de bodegas creó una notificación.');
  }

  const storedWarehouseProduct = await prisma.product.findUniqueOrThrow({
    where: { id: product.id },
  });
  const storedWarehouses = storedWarehouseProduct.siigoWarehouses as
    | {
        id: number;
        name: string;
        quantity: number;
      }[]
    | null;
  if (
    !Array.isArray(storedWarehouses) ||
    storedWarehouses.length !== 4 ||
    storedWarehouses[0]?.id !== 178 ||
    storedWarehouses[0]?.name !== '' ||
    storedWarehouses[1]?.id !== 177 ||
    storedWarehouses[1]?.name !== '' ||
    storedWarehouses[2]?.id !== 185 ||
    storedWarehouses[2]?.name !== '' ||
    storedWarehouses[3]?.id !== 999 ||
    storedWarehouses[3]?.name !== '' ||
    storedWarehouses.some((warehouse) => warehouse.quantity <= 0) ||
    !storedWarehouseProduct.siigoWarehousesUpdatedAt
  ) {
    throw new Error('La base de datos no guardó el snapshot filtrado de bodegas.');
  }

  const preservedResponse = await post(warehouseBase, `Bearer ${apiKey}`);
  expectStatus(preservedResponse, 200, 'Actualización sin bodegas');
  const preservedProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  const preservedWarehouses = preservedProduct.siigoWarehouses as
    | {
        id: number;
        quantity: number;
      }[]
    | null;
  if (
    !Array.isArray(preservedWarehouses) ||
    preservedWarehouses.length !== 4 ||
    preservedWarehouses[0]?.id !== 178 ||
    preservedWarehouses[1]?.id !== 177 ||
    preservedWarehouses[2]?.id !== 185 ||
    preservedWarehouses[3]?.id !== 999
  ) {
    throw new Error('Omitir siigo_warehouses borró el snapshot anterior.');
  }

  const clearedResponse = await post(
    { ...warehouseBase, siigo_warehouses: [] },
    `Bearer ${apiKey}`,
  );
  expectStatus(clearedResponse, 200, 'Bodegas vacías');
  const cleared = (await clearedResponse.json()) as {
    product: { siigoWarehouses: { id: number; quantity: number }[] | null };
  };
  if (
    !Array.isArray(cleared.product.siigoWarehouses) ||
    cleared.product.siigoWarehouses.length !== 0
  ) {
    throw new Error('Una lista vacía de bodegas no limpió el snapshot.');
  }
  const clearedProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  if (
    !Array.isArray(clearedProduct.siigoWarehouses) ||
    clearedProduct.siigoWarehouses.length !== 0
  ) {
    throw new Error('La base de datos no guardó la lista vacía de bodegas.');
  }

  // Una lista con solo cantidades negativas es válida: se normalizan a 0 y no se guarda nada.
  const negativeResponse = await post(
    {
      ...warehouseBase,
      siigo_warehouses: [
        { id: -1, quantity: -1 },
        { id: 188, quantity: -3 },
      ],
    },
    `Bearer ${apiKey}`,
  );
  expectStatus(negativeResponse, 200, 'Cantidades negativas');
  const negative = (await negativeResponse.json()) as {
    product: { siigoWarehouses: { id: number; quantity: number }[] | null };
  };
  if (
    !Array.isArray(negative.product.siigoWarehouses) ||
    negative.product.siigoWarehouses.length !== 0
  ) {
    throw new Error('Las cantidades negativas se mostraron en el desglose de bodegas.');
  }
  const negativeProduct = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  if (
    !Array.isArray(negativeProduct.siigoWarehouses) ||
    negativeProduct.siigoWarehouses.length !== 0
  ) {
    throw new Error('La base de datos guardó bodegas con cantidades negativas.');
  }

  const invalidWarehouses: { value: unknown; context: string }[] = [
    { value: {}, context: 'Bodegas no es un arreglo' },
    { value: [{ id: 178, name: 'SERATUS', quantity: 1.5 }], context: 'Cantidad decimal' },
    { value: [{ id: 1.5, name: 'SERATUS', quantity: 1 }], context: 'Id decimal' },
    { value: [{ id: 178, name: '', quantity: 1 }], context: 'Nombre vacío' },
    { value: [{ id: 178, name: 'SERATUS', quantity: 1, extra: true }], context: 'Clave extra' },
  ];
  for (const invalid of invalidWarehouses) {
    expectStatus(
      await post({ ...warehouseBase, siigo_warehouses: invalid.value }, `Bearer ${apiKey}`),
      400,
      invalid.context,
    );
  }
  const afterInvalid = await prisma.product.findUniqueOrThrow({ where: { id: product.id } });
  if (!Array.isArray(afterInvalid.siigoWarehouses) || afterInvalid.siigoWarehouses.length !== 0) {
    throw new Error('Un payload inválido de bodegas modificó el snapshot.');
  }

  process.stdout.write(
    'n8n smoke: API key, strict validation, lookup by Siigo ID, change detection, local update, sync status and Woo preservation checks passed.\n',
  );
} finally {
  if (productId !== null) {
    await prisma.notification.deleteMany({ where: { productId } });
  }
  await prisma.product.deleteMany({
    where: { id: { in: [productId, simpleProductId].filter((id): id is number => id !== null) } },
  });
  await app.close();
  if (originalApiKey === undefined) delete process.env.N8N_API_KEY;
  else process.env.N8N_API_KEY = originalApiKey;
}
