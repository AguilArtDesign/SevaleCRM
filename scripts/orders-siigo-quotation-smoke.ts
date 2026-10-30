import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { SiigoService } from '../apps/api/src/integrations/siigo/siigo.service.js';
import { ExchangeRateService } from '../apps/api/src/integrations/trm/trm.service.js';
import { SiigoQuotationService } from '../apps/api/src/orders/siigo-quotation.service.js';
import {
  buildQuotation,
  quotationFingerprint,
} from '../apps/api/src/orders/siigo-quotation-input.js';
import type { IntegrationLogsService } from '../apps/api/src/integration-logs/integration-logs.service.js';
import type { OrderEventsRepository } from '../apps/api/src/orders/order-events.repository.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

async function requestBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let content = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (content += chunk));
    request.on('end', () => {
      try {
        resolve(JSON.parse(content) as Record<string, unknown>);
      } catch (error) {
        reject(error instanceof Error ? error : new Error('Invalid JSON'));
      }
    });
    request.on('error', reject);
  });
}

// El comprobante real de la cuenta usa descuento por porcentaje.
let discountType: 'Value' | 'Percentage' = 'Percentage';
let capturedPayload: Record<string, unknown> | null = null;
const requestedPaths: string[] = [];
const usersHits: number[] = [];
const updatedQuotationIds: string[] = [];
let createdQuotations = 0;
const trmHits = { count: 0 };

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    requestedPaths.push(url.pathname);
    if (url.pathname.replace(/\/$/, '').endsWith('/trm')) {
      trmHits.count += 1;
      return json(response, 200, [
        { valor: '3157.94', unidad: 'COP', vigenciadesde: '2026-10-27T00:00:00.000' },
      ]);
    }
    // Siigo no filtra `users` por id: el vendedor se busca recorriendo las páginas. La cuenta de
    // prueba informa 150 usuarios, así que el vendedor 999 solo aparece en la segunda página.
    if (url.pathname.replace(/\/$/, '').endsWith('/v1/users')) {
      const page = Number(url.searchParams.get('page') ?? '1');
      usersHits.push(page);
      const all = Array.from({ length: 150 }, (_, index) => ({
        id: 1000 + index,
        first_name: `Vendedor${index}`,
        last_name: 'Siigo',
        active: true,
      }));
      all[120] = { id: 999, first_name: 'Histórico', last_name: 'Antiguo', active: true };
      const start = (page - 1) * 100;
      return json(response, 200, {
        pagination: { page, page_size: 100, total_results: all.length },
        results: all.slice(start, start + 100),
      });
    }
    if (url.pathname.endsWith('/document-types')) {
      return json(response, 200, [
        {
          id: 8652,
          type: 'C',
          active: true,
          automatic_number: true,
          discount_type: discountType,
        },
        {
          id: 9001,
          type: 'C',
          active: true,
          automatic_number: true,
          discount_type: 'Percentage',
        },
      ]);
    }
    if (url.pathname.endsWith('/customers/customer-siigo-id')) {
      return json(response, 200, {
        id: 'customer-siigo-id',
        identification: '904940',
        branch_office: 2,
        active: true,
      });
    }
    if (request.method === 'POST' && url.pathname.endsWith('/quotations')) {
      createdQuotations += 1;
      capturedPayload = await requestBody(request);
      return json(response, 201, {
        id: 'quotation-external-id',
        number: 81,
        name: 'C-1-81',
        seller: 820,
        public_url: 'https://publicview.siigo.com/document?data=test',
      });
    }
    // Actualizar una cotización existente: mismo cuerpo que el alta, sobre el documento ya creado.
    const existingQuotation = /\/quotations\/([^/]+)$/.exec(url.pathname);
    if (request.method === 'PUT' && existingQuotation) {
      capturedPayload = await requestBody(request);
      updatedQuotationIds.push(decodeURIComponent(existingQuotation[1] ?? ''));
      return json(response, 200, {
        id: decodeURIComponent(existingQuotation[1] ?? ''),
        number: 81,
        name: 'C-1-81',
        seller: 820,
        public_url: 'https://publicview.siigo.com/document?data=test',
      });
    }
    return json(response, 404, { message: 'Not found' });
  })().catch(() => json(response, 500, { message: 'Mock failure' }));
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No se inició el mock.');

const previousEnvironment = {
  SIIGO_API_URL: process.env.SIIGO_API_URL,
  SIIGO_PARTNER_ID: process.env.SIIGO_PARTNER_ID,
  SIIGO_QUOTATION_DOCUMENT_ID: process.env.SIIGO_QUOTATION_DOCUMENT_ID,
  SIIGO_COST_CENTER_ID: process.env.SIIGO_COST_CENTER_ID,
  TRM_API_URL: process.env.TRM_API_URL,
};
process.env.SIIGO_API_URL = `http://127.0.0.1:${address.port}/v1`;
process.env.SIIGO_PARTNER_ID = 'quotation-smoke';
process.env.TRM_API_URL = `http://127.0.0.1:${address.port}/v1/trm`;
delete process.env.SIIGO_QUOTATION_DOCUMENT_ID;
delete process.env.SIIGO_COST_CENTER_ID;

const seller = { id: 820, name: 'Yohander Aguilar', email: 'admin@example.invalid' };

const linkedCustomer = {
  id: 7,
  displayName: 'Cliente de prueba',
  documentType: '13',
  documentNumber: '904940',
  integrations: [{ provider: 'SIIGO', externalId: 'customer-siigo-id' }],
};

function item(
  sku: string,
  name: string,
  quantity: number,
  unitPrice: number,
  discount = 0,
  linked = true,
  priceModified = false,
) {
  return {
    skuSnapshot: sku,
    nameSnapshot: `${name} (tienda)`,
    quantity,
    unitPrice: { toNumber: () => unitPrice },
    discountTotal: { toNumber: () => discount },
    priceModified,
    product: linked ? { id: 1, sku, productName: name } : null,
  };
}

function operation(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    operationCode: 'OP20261027TEST',
    status: 'PENDING',
    currency: 'COP',
    subtotal: { toNumber: () => 280_000 },
    discountTotal: { toNumber: () => 28_000 },
    shippingTotal: { toNumber: () => 15_000 },
    couponId: 5,
    couponCode: 'MITAD',
    couponType: 'percent',
    couponAmount: { toNumber: () => 50 },
    siigoQuotation: null,
    customer: linkedCustomer,
    orders: [
      {
        store: 'SERATUS',
        wooStatus: 'pending',
        items: [item('SERATUS-SKU', 'Producto Seratus', 2, 100_000)],
      },
      {
        store: 'PALI',
        wooStatus: 'pending',
        items: [item('PALI-SKU', 'Producto Pali', 1, 80_000)],
      },
    ],
    ...overrides,
  } as never;
}

/** Operación con los dos pedidos de la tienda en el mismo estado de WooCommerce. */
function operationWithWooStatus(wooStatus: string | null, status = 'PENDING') {
  return operation({
    status,
    orders: [
      { store: 'SERATUS', wooStatus, items: [item('SERATUS-SKU', 'Producto Seratus', 2, 100_000)] },
    ],
  });
}

try {
  const siigo = new SiigoService({ getAccessToken: () => Promise.resolve('token') } as never);
  const rates = new ExchangeRateService();

  // La TRM se consulta una sola vez y se reutiliza: el panel la pide en cada vista previa.
  const rate = await rates.current();
  const cachedRate = await rates.current();
  assert(rate.value === 3157.94, 'La TRM no se leyó del valor publicado.');
  assert(
    cachedRate.value === 3157.94 && trmHits.count === 1,
    'La TRM no se reutilizó desde caché.',
  );

  // Vista previa en pesos: el IVA se separa del precio y el porcentaje del cupón viaja igual en
  // cada producto, que es como lo aplica Siigo.
  const cop = buildQuotation(operation(), { seller, exchangeRate: null, exchangeRateDate: null });
  assert(cop.preview.issues.length === 0, 'La operación en pesos no debería tener bloqueos.');
  const quotationInput = cop.input;
  assert(quotationInput, 'La cotización en pesos debería poder enviarse a Siigo.');
  const [seratus, pali, shipping] = cop.preview.items;
  assert(cop.preview.items.length === 3, 'No se agregó el envío como producto.');
  assert(
    seratus?.code === 'SERATUS-SKU' && pali?.code === 'PALI-SKU',
    'El código debe ser el SKU.',
  );
  assert(seratus?.description === 'Producto Seratus', 'La descripción debe ser la del inventario.');
  assert(seratus?.price === 84_033.613445, 'El precio en pesos debe enviarse sin IVA.');
  assert(seratus?.grossPrice === 100_000, 'La vista previa debe mostrar el precio del pedido.');
  assert(seratus?.discount === 50, 'El porcentaje del cupón debe viajar en cada producto.');
  assert(pali?.discount === 50, 'El porcentaje del cupón no se repitió en el segundo producto.');
  assert(
    shipping?.code === 'FLETES' && shipping.price === 15_000,
    'El envío no se convirtió en un producto FLETES con el valor del pedido.',
  );
  assert(shipping?.taxId === 13882, 'El flete debe viajar con el impuesto de 0 %.');
  assert(shipping?.discount === 0, 'El envío no puede llevar el descuento del cupón.');
  assert(cop.preview.tax.id === 4651, 'La cotización en pesos debe llevar IVA 19.');
  assert(
    quotationInput?.documentId === 8652,
    'El tipo de cotización debe ser el fijo de la cuenta.',
  );
  assert(quotationInput?.costCenter === 1388, 'El centro de costo debe ser el fijo de la cuenta.');
  assert(quotationInput?.sellerId === 820, 'El vendedor debe ser el del usuario.');
  assert(quotationInput?.items[0]?.taxId === 4651, 'Los ítems no llevan el impuesto de pesos.');
  assert(quotationInput?.items[2]?.code === 'FLETES', 'El envío no viaja como producto FLETES.');

  // Un producto con precio cambiado a mano queda fuera del cupón: viaja con su precio y sin
  // descuento, mientras el resto conserva el porcentaje.
  const mixed = buildQuotation(
    operation({
      orders: [
        {
          store: 'SERATUS',
          items: [
            item('SERATUS-SKU', 'Producto Seratus', 1, 100_000, 0, true, true),
            item('PALI-SKU', 'Producto Pali', 1, 127_000),
          ],
        },
      ],
    }),
    { seller, exchangeRate: null, exchangeRateDate: null },
  );
  assert(
    mixed.preview.items[0]?.discount === 0,
    'El producto con precio manual no debería llevar descuento.',
  );
  assert(
    mixed.preview.items[0]?.price === 84_033.613445,
    'El producto con precio manual debe cotizarse a ese precio.',
  );
  assert(
    mixed.preview.items[1]?.discount === 50,
    'El producto sin cambios de precio debe conservar el cupón.',
  );
  assert(
    mixed.preview.items[1]?.price === 106_722.689076,
    'El producto con cupón debe enviarse sin IVA.',
  );

  // Sin cupón no hay descuento en ningún producto.
  const withoutCoupon = buildQuotation(
    operation({ couponId: null, couponCode: null, couponType: null, couponAmount: null }),
    { seller, exchangeRate: null, exchangeRateDate: null },
  );
  assert(
    withoutCoupon.preview.items.every(({ discount }) => discount === 0),
    'Sin cupón ningún producto debería llevar descuento.',
  );

  // En dólares no hay IVA: el precio pasa tal cual y la TRM es obligatoria.
  const usdWithoutRate = buildQuotation(operation({ currency: 'USD' }), {
    seller,
    exchangeRate: null,
    exchangeRateDate: null,
  });
  assert(
    usdWithoutRate.preview.issues[0]?.code === 'SIIGO_EXCHANGE_RATE_REQUIRED' &&
      usdWithoutRate.input === null,
    'Una cotización en dólares sin TRM debería bloquearse.',
  );
  const usd = buildQuotation(operation({ currency: 'USD', discountTotal: { toNumber: () => 0 } }), {
    seller,
    exchangeRate: 3157.94,
    exchangeRateDate: '2026-10-27T00:00:00.000',
  });
  assert(usd.preview.issues.length === 0, 'La cotización en dólares no debería tener bloqueos.');
  assert(usd.preview.items[0]?.price === 100_000, 'En dólares el precio no se divide por el IVA.');
  assert(
    usd.preview.tax.id === 13882,
    'La cotización en dólares debe llevar el impuesto de exportación.',
  );
  assert(usd.input?.exchangeRate === 3157.94, 'La TRM no viajó en la petición.');
  assert(usd.preview.exchangeRate.required, 'La TRM debe marcarse como obligatoria en dólares.');

  // Bloqueos que el modal muestra antes de sincronizar.
  const unlinked = buildQuotation(
    operation({ customer: { ...linkedCustomer, integrations: [] } }),
    { seller, exchangeRate: null, exchangeRateDate: null },
  );
  assert(
    unlinked.preview.issues.some(({ code }) => code === 'SIIGO_CUSTOMER_NOT_LINKED'),
    'Un cliente sin vínculo con Siigo debería bloquear la cotización.',
  );
  const withoutSeller = buildQuotation(operation(), {
    seller: { id: null, name: 'Sin Seller', email: 'x@example.invalid' },
    exchangeRate: null,
    exchangeRateDate: null,
  });
  assert(
    withoutSeller.preview.issues.some(({ code }) => code === 'SIIGO_SELLER_NOT_CONFIGURED'),
    'Un usuario sin Seller ID debería bloquear la cotización.',
  );
  const withoutProduct = buildQuotation(
    operation({
      orders: [{ store: 'SERATUS', items: [item('SIN-VINCULO', 'Suelto', 1, 1000, 0, false)] }],
    }),
    { seller, exchangeRate: null, exchangeRateDate: null },
  );
  assert(
    withoutProduct.preview.issues.some(({ code }) => code === 'SIIGO_PRODUCT_NOT_LINKED'),
    'Un producto sin vínculo debería bloquear la cotización.',
  );

  // Solo se cotiza un pedido abierto en WooCommerce. Completado, cancelado, reembolsado y fallido
  // ya cerraron el pedido; el panel esconde la acción y aquí se rechaza por si se llama a la ruta.
  for (const openStatus of ['pending', 'processing', 'on-hold']) {
    const open = buildQuotation(operationWithWooStatus(openStatus), {
      seller,
      exchangeRate: null,
      exchangeRateDate: null,
    });
    assert(
      !open.preview.issues.some(({ code }) => code === 'SIIGO_QUOTATION_ORDER_CLOSED'),
      `Un pedido en ${openStatus} debería poder cotizarse.`,
    );
    assert(open.input !== null, `Un pedido en ${openStatus} debería generar la cotización.`);
  }
  for (const closedStatus of ['completed', 'cancelled', 'refunded', 'failed']) {
    const closed = buildQuotation(operationWithWooStatus(closedStatus), {
      seller,
      exchangeRate: null,
      exchangeRateDate: null,
    });
    assert(
      closed.preview.issues.some(({ code }) => code === 'SIIGO_QUOTATION_ORDER_CLOSED'),
      `Un pedido en ${closedStatus} no debería poder cotizarse.`,
    );
    assert(closed.input === null, `Un pedido en ${closedStatus} no debería generar la cotización.`);
  }
  assert(
    buildQuotation(operationWithWooStatus('Processing'), {
      seller,
      exchangeRate: null,
      exchangeRateDate: null,
    }).input !== null,
    'El estado de WooCommerce debería compararse sin distinguir mayúsculas.',
  );

  // Un pedido del CRM que todavía no existe en la tienda no tiene estado de WooCommerce: sigue
  // abierto mientras la operación esté pendiente, y cerrado cuando ya se completó.
  assert(
    buildQuotation(operationWithWooStatus(null, 'PENDING'), {
      seller,
      exchangeRate: null,
      exchangeRateDate: null,
    }).input !== null,
    'Un pedido del CRM pendiente y sin estado de WooCommerce debería poder cotizarse.',
  );
  assert(
    buildQuotation(operationWithWooStatus(null, 'COMPLETED'), {
      seller,
      exchangeRate: null,
      exchangeRateDate: null,
    }).input === null,
    'Un pedido del CRM completado y sin estado de WooCommerce no debería cotizarse.',
  );

  // Basta con que un pedido de la operación siga abierto: el otro pudo completarse en la tienda.
  const mixedStoreStatus = buildQuotation(
    operation({
      orders: [
        {
          store: 'SERATUS',
          wooStatus: 'completed',
          items: [item('SERATUS-SKU', 'Producto Seratus', 2, 100_000)],
        },
        {
          store: 'PALI',
          wooStatus: 'processing',
          items: [item('PALI-SKU', 'Producto Pali', 1, 80_000)],
        },
      ],
    }),
    { seller, exchangeRate: null, exchangeRateDate: null },
  );
  assert(
    mixedStoreStatus.input !== null,
    'Una operación con un pedido todavía abierto debería poder cotizarse.',
  );

  // Contrato real de Siigo: comprobante y centro de costo fijos, impuesto y descuento por ítem, y
  // ninguna consulta de productos porque el código ya viene del inventario.
  const reference = await siigo.createQuotation(quotationInput);
  const payload = capturedPayload as unknown as {
    document?: { id?: number };
    cost_center?: number;
    seller?: number;
    customer?: { identification?: string; branch_office?: number };
    items?: Array<{
      code?: string;
      price?: number;
      discount?: number;
      taxes?: Array<{ id?: number }>;
    }>;
  } | null;
  assert(reference.id === 'quotation-external-id', 'No se normalizó la respuesta de Siigo.');
  assert(payload?.document?.id === 8652, 'El payload no lleva el tipo de cotización fijo.');
  assert(payload.cost_center === 1388, 'El payload no lleva el centro de costo fijo.');
  assert(payload.seller === 820, 'El payload no lleva el vendedor del usuario.');
  assert(payload.customer?.branch_office === 2, 'El payload no lleva la sucursal del cliente.');
  assert(payload.items?.length === 3, 'El payload no incluye el envío como producto.');
  assert(payload.items[0]?.code === 'SERATUS-SKU', 'El payload no usa el SKU como código.');
  assert(payload.items[0]?.taxes?.[0]?.id === 4651, 'El payload no lleva el IVA de 19%.');
  assert(payload.items[0]?.discount === 50, 'El descuento del cupón no se envía como porcentaje.');
  assert(payload.items[1]?.discount === 50, 'El porcentaje no se repite en cada producto.');
  assert(payload.items[2]?.code === 'FLETES', 'El payload no lleva el producto FLETES.');
  assert(payload.items[2]?.taxes?.[0]?.id === 13882, 'El flete no viaja con el impuesto de 0 %.');
  assert(payload.items[2]?.discount === 0, 'El flete no puede llevar descuento.');
  assert(
    requestedPaths.every((path) => !path.includes('/products/')),
    'No se deben consultar productos en Siigo: el código ya está en el inventario.',
  );

  // El nombre de un vendedor que no está en el CRM: Siigo no filtra por id, así que hay que
  // recorrer las páginas hasta encontrarlo. El 999 vive en la segunda.
  const sellerName = await siigo.sellerName(999);
  assert(sellerName === 'Histórico Antiguo', 'El nombre del vendedor no se resolvió en Siigo.');
  assert(
    usersHits.join(',') === '1,2',
    'La búsqueda del vendedor debe paginar hasta encontrar la página que lo contiene.',
  );
  // La caché evita repetir la consulta para el mismo vendedor.
  await siigo.sellerName(999);
  assert(usersHits.join(',') === '1,2', 'La segunda consulta debía salir de la caché.');
  // Un vendedor inexistente recorre todas las páginas y termina en null, sin lanzar.
  assert((await siigo.sellerName(777_777)) === null, 'Un vendedor inexistente debe devolver null.');
  assert(
    usersHits.join(',') === '1,2,1,2',
    'Debe detenerse al agotar las páginas que informa Siigo.',
  );

  // Un comprobante configurado por valor necesita convertir el porcentaje al importe de la línea.
  discountType = 'Value';
  await siigo.createQuotation(quotationInput);
  const valuePayload = capturedPayload as unknown as {
    items?: Array<{ discount?: number; price?: number; quantity?: number }>;
  } | null;
  assert(
    valuePayload?.items?.[0]?.discount === 84_033.61,
    'El descuento no se convirtió a valor sobre el total de la línea.',
  );
  assert(
    valuePayload.items[2]?.discount === 0,
    'El flete no puede llevar descuento en un comprobante por valor.',
  );
  discountType = 'Percentage';

  // Un error de Siigo deja la cotización reintentable sin perder los productos de la operación.
  let markedSynced = false;
  let markedError = false;
  let attempts = 0;
  let capturedItems = 0;
  const quotationService = new SiigoQuotationService(
    {
      siigoQuotationJob: () => Promise.resolve({ id: 1, operation: operation() }),
      quotationSeller: () => Promise.resolve(seller),
      markSiigoQuotationSynced: () => {
        markedSynced = true;
        return Promise.resolve({ count: 1 });
      },
      markSiigoQuotationError: () => {
        markedError = true;
        return Promise.resolve({ count: 1 });
      },
    } as never,
    {
      createQuotation: (input: { items: unknown[] }) => {
        attempts += 1;
        capturedItems = input.items.length;
        if (attempts === 1) return Promise.reject(new Error('Fallo simulado de Siigo'));
        return Promise.resolve({
          id: 'quote',
          number: '82',
          name: 'C-1-82',
          publicUrl: null,
          sellerId: '820',
          exchangeRate: null,
        });
      },
    } as never,
    rates,
    // El log de integraciones no puede romper la cotización, así que en el smoke basta un doble.
    { record: () => Promise.resolve() } as unknown as IntegrationLogsService,
    // La traza solo se consulta en la vista previa; la sincronización no la necesita.
    { latestQuoted: () => Promise.resolve(null) } as unknown as OrderEventsRepository,
  );
  await quotationService.synchronize(1, 'user-id');
  assert(markedError && !markedSynced, 'El error de Siigo no quedó disponible para reintento.');
  await quotationService.synchronize(1, 'user-id');
  assert(
    markedSynced && capturedItems === 3 && attempts === 2,
    'El reintento no reenvió la operación completa.',
  );

  // Con la cotización ya creada en Siigo, el pedido editado se reenvía sobre ese mismo documento
  // (PUT con su UUID) en lugar de abrir una segunda cotización, y la huella guardada es la del
  // contenido que efectivamente viajó: es contra ella que se detecta el próximo cambio.
  let storedFingerprint: string | null = null;
  const createdBeforeUpdate = createdQuotations;
  const updateService = new SiigoQuotationService(
    {
      siigoQuotationJob: () =>
        Promise.resolve({
          id: 9,
          operation: operation({ siigoQuotation: { externalId: 'quotation-uuid' } }),
        }),
      quotationSeller: () => Promise.resolve(seller),
      markSiigoQuotationSynced: (_quotationId: number, _result: unknown, fingerprint: string) => {
        storedFingerprint = fingerprint;
        return Promise.resolve({ count: 1 });
      },
      markSiigoQuotationError: () => Promise.resolve({ count: 1 }),
    } as never,
    siigo,
    rates,
    { record: () => Promise.resolve() } as unknown as IntegrationLogsService,
    { latestQuoted: () => Promise.resolve(null) } as unknown as OrderEventsRepository,
  );
  await updateService.synchronize(9, 'user-id');
  assert(
    updatedQuotationIds.length === 1 && updatedQuotationIds[0] === 'quotation-uuid',
    'La cotización existente no se actualizó en Siigo por su UUID.',
  );
  assert(
    createdQuotations === createdBeforeUpdate,
    'Un pedido ya cotizado intentó crear una segunda cotización.',
  );
  assert(
    storedFingerprint ===
      quotationFingerprint(
        buildQuotation(operation(), {
          seller,
          exchangeRate: null,
          exchangeRateDate: null,
        }).preview,
      ),
    'La huella guardada no corresponde al contenido enviado.',
  );

  process.stdout.write(
    'Siigo quotation smoke: fixed document and cost center, SKU codes, per-currency taxes, tax split, per-product coupon, manual price exclusion, shipping line, TRM cache, paginated seller name fallback, open-order rule per WooCommerce status, blocking issues, discount unit, update of an already created quotation, errors and retry checks passed.\n',
  );
} finally {
  for (const [key, value] of Object.entries(previousEnvironment)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  await new Promise<void>((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
