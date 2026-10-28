import { OrderEventsService } from '../apps/api/src/orders/order-events.service.js';
import type {
  OrderEventInput,
  OrderEventsRepository,
} from '../apps/api/src/orders/order-events.repository.js';
import type { OrderOperationDetail } from '../apps/api/src/orders/orders.repository.js';

function equal(actual: unknown, expected: unknown, context: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${context}: se esperaba ${JSON.stringify(expected)} y se recibió ${JSON.stringify(actual)}.`,
    );
  }
}

/** Primer evento registrado; el proyecto tipa sin acceso indexado, así que se comprueba antes. */
function first(recorded: OrderEventInput[]): OrderEventInput {
  const [event] = recorded;
  if (!event) throw new Error('No se registró ningún evento cuando se esperaba uno.');
  return event;
}

/** Los importes del detalle son objetos tipo `Decimal`; para la traza basta el texto. */
function decimal(value: string) {
  return { toFixed: (decimals: number) => Number(value).toFixed(decimals) };
}

/**
 * Repositorio de mentira: guarda lo que la traza intenta escribir para poder afirmar sobre ello,
 * sin base de datos. Es todo lo que el servicio usa del repositorio real.
 */
function fakeRepository(options: { fail?: boolean } = {}) {
  const recorded: OrderEventInput[] = [];
  const repository = {
    recorded,
    async record(input: OrderEventInput) {
      await Promise.resolve();
      if (options.fail) throw new Error('la base de datos no respondió');
      recorded.push(input);
      return { id: recorded.length, ...input, createdAt: new Date(), userName: null, user: null };
    },
  };
  return repository as unknown as OrderEventsRepository & { recorded: OrderEventInput[] };
}

/** Operación mínima con todos los campos que la traza compara. */
function operation(overrides: Record<string, unknown> = {}) {
  return {
    id: 11,
    operationCode: 'OP261028120000ABCD',
    status: 'PENDING',
    currency: 'COP',
    paymentMethod: 'bancolombia',
    paymentMethodTitle: 'Bancolombia',
    shippingMethod: 'flat_rate',
    shippingMethodTitle: 'Envío estándar',
    couponCode: null,
    subtotal: decimal('100000'),
    discountTotal: decimal('0'),
    shippingTotal: decimal('15000'),
    total: decimal('115000'),
    billingFirstName: 'Ana',
    billingLastName: 'Pérez',
    billingCompany: null,
    billingAddress1: 'Calle 1 # 2-3',
    billingAddress2: null,
    billingCity: 'Medellín',
    billingState: 'CO-ANT',
    billingPostcode: '050001',
    billingCountry: 'CO',
    billingEmail: 'ana@ejemplo.com',
    billingPhone: '+573001234567',
    shippingFirstName: 'Ana',
    shippingLastName: 'Pérez',
    shippingCompany: null,
    shippingAddress1: 'Calle 1 # 2-3',
    shippingAddress2: null,
    shippingCity: 'Medellín',
    shippingState: 'CO-ANT',
    shippingPostcode: '050001',
    shippingCountry: 'CO',
    shippingPhone: '+573001234567',
    customer: { id: 7, displayName: 'Ana Pérez' },
    orders: [
      { store: 'SERATUS', total: decimal('115000') },
      { store: 'PALI', total: decimal('115000') },
    ],
    siigoQuotation: null,
    ...overrides,
  } as unknown as OrderOperationDetail;
}

const userId = 'user-1';
const ref = { id: 11, operationCode: 'OP261028120000ABCD', customerName: 'Ana Pérez' };

// 1. El alta desde el CRM deja un evento con el autor.
{
  const repository = fakeRepository();
  const service = new OrderEventsService(repository);
  await service.recordCreated(ref, userId);
  equal(repository.recorded.length, 1, 'El alta debe registrar un evento');
  equal(first(repository.recorded).action, 'CREATED', 'La acción del alta');
  equal(first(repository.recorded).userId, userId, 'El autor del alta');
  equal(first(repository.recorded).provider, null, 'Un pedido del CRM no tiene tienda de origen');
}

// 2. Un pedido importado de la tienda no tiene autor: lo dice la traza en vez de inventarlo.
{
  const repository = fakeRepository();
  const service = new OrderEventsService(repository);
  await service.recordCreated(ref, null, 'PALI');
  equal(first(repository.recorded).userId, null, 'La importación no tiene usuario');
  equal(first(repository.recorded).provider, 'PALI', 'La tienda que trajo el pedido');
  equal(first(repository.recorded).message, 'Pedido importado desde la tienda.', 'El motivo');
}

// 3. Un guardado sin cambios reales no ensucia la traza.
{
  const repository = fakeRepository();
  const service = new OrderEventsService(repository);
  await service.recordUpdated(operation(), operation(), userId);
  equal(repository.recorded.length, 0, 'Un guardado sin cambios no debe registrar nada');
}

// 4. Solo se registra la cabecera que cambió, nunca los ítems, que se recrean en cada guardado.
{
  const repository = fakeRepository();
  const service = new OrderEventsService(repository);
  await service.recordUpdated(
    operation(),
    operation({
      shippingTotal: decimal('20000'),
      total: decimal('120000'),
      orders: [{ store: 'SERATUS', total: decimal('120000') }],
      items: [{ id: 1 }, { id: 2 }],
    }),
    userId,
  );
  equal(repository.recorded.length, 1, 'Una edición real debe registrar un evento');
  equal(first(repository.recorded).action, 'UPDATED', 'La acción de la edición');
  equal(
    first(repository.recorded).changes,
    [
      { field: 'shippingTotal', from: '15000.00', to: '20000.00' },
      { field: 'total', from: '115000.00', to: '120000.00' },
      { field: 'stores', from: ['PALI', 'SERATUS'], to: ['SERATUS'] },
    ],
    'Solo cambian el dinero y las tiendas, no los ítems',
  );
}

// 5. Completar deja el evento con su autor, sin detalle de productos.
{
  const repository = fakeRepository();
  const service = new OrderEventsService(repository);
  await service.recordCompleted(operation(), userId);
  equal(first(repository.recorded).action, 'COMPLETED', 'La acción del cierre');
  equal(first(repository.recorded).changes, undefined, 'Completar no guarda cambios de campos');
}

// 6. La sincronización deja un evento por tienda: el panel necesita saber cuál falló.
{
  const repository = fakeRepository();
  const service = new OrderEventsService(repository);
  await service.recordSynced(
    operation(),
    [
      { provider: 'PALI', status: 'ERROR', message: 'El cliente no está vinculado con Pali.' },
      { provider: 'SERATUS', status: 'SYNCED' },
    ],
    userId,
  );
  equal(repository.recorded.length, 2, 'Cada tienda deja su propio evento');
  equal(
    repository.recorded.map((event) => [event.provider, event.outcome]),
    [
      ['PALI', 'ERROR'],
      ['SERATUS', 'SYNCED'],
    ],
    'La tienda y el resultado de cada sincronización',
  );
  equal(
    first(repository.recorded).message,
    'El cliente no está vinculado con Pali.',
    'El error de la sincronización debe quedar escrito',
  );
  equal(
    repository.recorded[1]?.message,
    null,
    'Una sincronización correcta no guarda mensaje de error',
  );
}

// 7. La cotización se registra con su resultado; sin cotización no hay nada que anotar.
{
  const repository = fakeRepository();
  const service = new OrderEventsService(repository);
  await service.recordQuoted(operation(), userId);
  equal(repository.recorded.length, 0, 'Una operación sin cotización no deja evento');

  await service.recordQuoted(
    operation({ siigoQuotation: { status: 'ERROR', errorMessage: 'La dirección no existe.' } }),
    userId,
  );
  equal(first(repository.recorded).action, 'QUOTED', 'La acción de la cotización');
  equal(first(repository.recorded).provider, 'SIIGO', 'La integración que cotiza');
  equal(first(repository.recorded).outcome, 'ERROR', 'El resultado fallido');
  equal(
    first(repository.recorded).message,
    'La dirección no existe.',
    'El motivo del fallo queda escrito',
  );

  const synced = fakeRepository();
  await new OrderEventsService(synced).recordQuoted(
    operation({ siigoQuotation: { status: 'SYNCED', number: 'CV-123' } }),
    userId,
  );
  equal(first(synced.recorded).outcome, 'SYNCED', 'El resultado correcto');
  equal(first(synced.recorded).message, 'CV-123', 'El número de la cotización como referencia');
}

// 8. El borrado sobrevive al pedido: el evento se guarda sin vínculo y conserva el código.
{
  const repository = fakeRepository();
  const service = new OrderEventsService(repository);
  await service.recordDeleted(operation(), userId);
  equal(first(repository.recorded).action, 'DELETED', 'La acción del borrado');
  equal(first(repository.recorded).operationId, null, 'El evento del borrado pierde el vínculo');
  equal(
    first(repository.recorded).operationCode,
    'OP261028120000ABCD',
    'El código queda como rastro del pedido eliminado',
  );
}

// 9. Si la traza falla, la operación de negocio no se cae: se pierde el rastro, no el pedido.
{
  const repository = fakeRepository({ fail: true });
  const service = new OrderEventsService(repository);
  let threw = false;
  try {
    await service.recordCreated(ref, userId);
    await service.recordUpdated(operation(), operation({ total: decimal('1') }), userId);
    await service.recordSynced(operation(), [{ provider: 'PALI', status: 'SYNCED' }], userId);
    await service.recordDeleted(operation(), userId);
  } catch {
    threw = true;
  }
  equal(threw, false, 'Un fallo de la traza no debe interrumpir la operación');
}

// 10. La lectura entrega autor, cambios y paginación lista para el panel.
{
  const createdAt = new Date('2026-01-15T10:00:00.000Z');
  const repository = {
    async list() {
      await Promise.resolve();
      return [
        [
          {
            id: 1,
            operationId: 11,
            action: 'SYNCED',
            origin: 'LIVE',
            userName: 'Yohander Aguilar',
            operationCode: 'OP261028120000ABCD',
            customerName: 'Ana Pérez',
            changes: null,
            provider: 'SERATUS',
            outcome: 'SYNCED',
            message: null,
            createdAt,
            user: null,
          },
        ],
        1,
      ] as const;
    },
  } as unknown as OrderEventsRepository;
  const service = new OrderEventsService(repository);
  const result = await service.list(11, { page: 1, pageSize: 50 });
  equal(result.data[0]?.actor?.name, 'Yohander Aguilar', 'El autor se lee del nombre copiado');
  equal(result.data[0]?.changes, [], 'Sin cambios guardados la lista llega vacía, no nula');
  equal(result.pagination, { page: 1, pageSize: 50, total: 1, totalPages: 1 }, 'La paginación');
}

console.log('order-activity-smoke: OK');
