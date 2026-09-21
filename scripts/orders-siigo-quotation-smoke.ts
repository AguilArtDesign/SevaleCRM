import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { SiigoService } from '../apps/api/src/integrations/siigo/siigo.service.js';
import { SiigoQuotationService } from '../apps/api/src/orders/siigo-quotation.service.js';

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

let capturedPayload: Record<string, unknown> | null = null;
const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    if (url.pathname.endsWith('/document-types')) {
      return json(response, 200, [
        {
          id: 24446,
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
        branch_office: 0,
        active: true,
        seller_id: 629,
      });
    }
    if (url.pathname.endsWith('/products/product-seratus-id')) {
      return json(response, 200, {
        id: 'product-seratus-id',
        code: 'SERATUS-SKU',
        active: true,
      });
    }
    if (url.pathname.endsWith('/products/product-pali-id')) {
      return json(response, 200, {
        id: 'product-pali-id',
        code: 'PALI-SKU',
        active: true,
      });
    }
    if (request.method === 'POST' && url.pathname.endsWith('/quotations')) {
      capturedPayload = await requestBody(request);
      return json(response, 201, {
        id: 'quotation-external-id',
        number: 81,
        name: 'C-1-81',
        seller: 629,
        currency: { code: 'USD', exchange_rate: 4100.25 },
        public_url: 'https://publicview.siigo.com/document?data=test',
      });
    }
    return json(response, 404, { message: 'Not found' });
  })().catch(() => json(response, 500, { message: 'Mock failure' }));
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('No se inició el mock de Siigo.');

const previousEnvironment = {
  SIIGO_API_URL: process.env.SIIGO_API_URL,
  SIIGO_PARTNER_ID: process.env.SIIGO_PARTNER_ID,
  SIIGO_QUOTATION_DOCUMENT_ID: process.env.SIIGO_QUOTATION_DOCUMENT_ID,
  SIIGO_QUOTATION_SELLER_ID: process.env.SIIGO_QUOTATION_SELLER_ID,
};
process.env.SIIGO_API_URL = `http://127.0.0.1:${address.port}/v1`;
process.env.SIIGO_PARTNER_ID = 'quotation-smoke';
delete process.env.SIIGO_QUOTATION_DOCUMENT_ID;
delete process.env.SIIGO_QUOTATION_SELLER_ID;

try {
  const siigo = new SiigoService({ getAccessToken: () => Promise.resolve('token') } as never);
  const result = await siigo.createQuotation({
    customerExternalId: 'customer-siigo-id',
    customerIdentification: '904940',
    currency: 'USD',
    exchangeRate: 4100.25,
    date: '2026-09-19',
    items: [
      {
        productExternalId: 'product-seratus-id',
        description: 'Producto Seratus',
        quantity: 2,
        price: 50,
        discountValue: 10,
      },
      {
        productExternalId: 'product-pali-id',
        description: 'Producto Pali',
        quantity: 1,
        price: 30,
        discountValue: 0,
      },
    ],
  });
  const payload = capturedPayload as {
    document?: { id?: number };
    seller?: number;
    currency?: { code?: string; exchange_rate?: number };
    items?: Array<{ code?: string; discount?: number }>;
  } | null;
  if (
    result.id !== 'quotation-external-id' ||
    payload?.document?.id !== 24446 ||
    payload.seller !== 629 ||
    payload.currency?.code !== 'USD' ||
    payload.currency.exchange_rate !== 4100.25 ||
    payload.items?.length !== 2 ||
    payload.items[0]?.code !== 'SERATUS-SKU' ||
    payload.items[1]?.code !== 'PALI-SKU' ||
    payload.items[0]?.discount !== 10
  ) {
    throw new Error('El payload de cotización no respeta el contrato de Siigo.');
  }

  const job = {
    id: 1,
    exchangeRate: null,
    operation: {
      currency: 'COP',
      customer: {
        documentNumber: '904940',
        integrations: [{ provider: 'SIIGO', externalId: 'customer-siigo-id' }],
      },
      orders: [
        {
          store: 'SERATUS',
          items: [
            {
              skuSnapshot: 'SERATUS-SKU',
              nameSnapshot: 'Producto Seratus',
              quantity: 1,
              unitPrice: { toNumber: () => 100 },
              discountTotal: { toNumber: () => 0 },
              product: { siigoId: 'product-seratus-id' },
            },
          ],
        },
        {
          store: 'PALI',
          items: [
            {
              skuSnapshot: 'PALI-SKU',
              nameSnapshot: 'Producto Pali',
              quantity: 1,
              unitPrice: { toNumber: () => 80 },
              discountTotal: { toNumber: () => 0 },
              product: { siigoId: 'product-pali-id' },
            },
          ],
        },
      ],
    },
  };
  let markedSynced = false;
  let markedError = false;
  let capturedItems = 0;
  let attempts = 0;
  const quotationService = new SiigoQuotationService(
    {
      siigoQuotationJob: () => Promise.resolve(job),
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
          sellerId: '629',
          exchangeRate: null,
        });
      },
    } as never,
  );
  await quotationService.synchronize(1);
  if (!markedError || markedSynced) {
    throw new Error('El error de Siigo no quedó disponible para reintento.');
  }
  await quotationService.synchronize(1);
  if (!markedSynced || capturedItems !== 2 || attempts !== 2) {
    throw new Error('El reintento no reunió los productos de ambas tiendas.');
  }

  process.stdout.write(
    'Siigo quotation smoke: official payload, external product resolution, mixed-store items, errors and retry checks passed.\n',
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
