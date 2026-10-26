/**
 * Contrato del borrado remoto de un cliente. Lo importante aquí no es el camino feliz, sino las dos
 * decisiones que pueden perder datos: que se pida `force=true` (sin él WooCommerce mueve a papelera y
 * el cliente sigue vivo) y que un 404 cuente como éxito (el cliente ya no está, que es el objetivo).
 */
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { WooCustomerMapper } from '../apps/api/src/customers/mapping/woo-customer.mapper.js';
import { WooCustomerService } from '../apps/api/src/customers/integrations/woo-customer.service.js';

type RecordedRequest = {
  method: string;
  url: string;
  authorization: string | null;
};

const requests: RecordedRequest[] = [];
let respond: (request: IncomingMessage, response: ServerResponse) => void = () => {};

const server = createServer((request: IncomingMessage, response: ServerResponse) => {
  requests.push({
    method: request.method ?? '',
    url: request.url ?? '',
    authorization: request.headers.authorization ?? null,
  });
  respond(request, response);
});
await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('El servidor de prueba no arrancó.');
const baseUrl = `http://127.0.0.1:${address.port}/wp-json/wc/v3`;

process.env.SERATUS_API_URL = baseUrl;
process.env.WOOCOMMERCE_SERATUS_CK = 'seratus-key';
process.env.WOOCOMMERCE_SERATUS_CS = 'seratus-secret';
process.env.PALI_API_URL = baseUrl;
process.env.WOOCOMMERCE_PALI_CK = 'pali-key';
process.env.WOOCOMMERCE_PALI_CS = 'pali-secret';

const service = new WooCustomerService(new WooCustomerMapper());

function expect(condition: boolean, message: string) {
  if (!condition) throw new Error(message);
}

try {
  // --- Camino feliz: DELETE customers/{id}?force=true -------------------------------
  respond = (_request, response) => {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ id: 4242, deleted: true }));
  };
  requests.length = 0;
  await service.deleteCustomer('SERATUS', '4242');
  const deletion = requests[0];
  expect(requests.length === 1, `Se esperaba una sola petición y llegaron ${requests.length}.`);
  expect(deletion?.method === 'DELETE', `Se esperaba DELETE y llegó ${deletion?.method}.`);
  expect(
    deletion?.url?.includes('/customers/4242') === true,
    `La ruta no apunta al cliente: ${deletion?.url}.`,
  );
  expect(
    deletion?.url?.includes('force=true') === true,
    'Falta force=true: WooCommerce no borraría.',
  );
  const expectedAuth = `Basic ${Buffer.from('seratus-key:seratus-secret').toString('base64')}`;
  expect(
    deletion?.authorization === expectedAuth,
    'La petición no usó las credenciales de la tienda indicada.',
  );

  // --- Un 404 significa que ya no está: no debe romper el borrado del CRM ----------
  respond = (_request, response) => {
    response.writeHead(404, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ code: 'woocommerce_rest_customer_invalid_id' }));
  };
  await service.deleteCustomer('PALI', '7');

  // --- Un fallo real sí debe propagarse para abortar el borrado --------------------
  respond = (_request, response) => {
    response.writeHead(500, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ message: 'caída' }));
  };
  let failed = false;
  try {
    await service.deleteCustomer('PALI', '7');
  } catch {
    failed = true;
  }
  expect(failed, 'Un 500 de la tienda se tragó: el CRM borraría al cliente igual.');

  // --- Un identificador corrupto no puede convertirse en una ruta arbitraria -------
  let rejected = false;
  try {
    await service.deleteCustomer('PALI', '../../orders/1');
  } catch {
    rejected = true;
  }
  expect(rejected, 'Un externalId corrupto llegó a la URL de la tienda.');

  console.log('Customer delete smoke: force, auth, 404 as success and error propagation passed.');
} finally {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}
