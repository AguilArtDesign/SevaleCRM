import { CustomerEventsService } from '../apps/api/src/customers/customer-events.service.js';
import type {
  CustomerEventInput,
  CustomerEventsRepository,
} from '../apps/api/src/customers/customer-events.repository.js';
import type { CustomerWithIntegrations } from '../apps/api/src/customers/customers.repository.js';

function equal(actual: unknown, expected: unknown, context: string) {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error(
      `${context}: se esperaba ${JSON.stringify(expected)} y se recibió ${JSON.stringify(actual)}.`,
    );
  }
}

/** Primer evento registrado; el proyecto tipa sin acceso indexado, así que se comprueba antes. */
function first(recorded: CustomerEventInput[]): CustomerEventInput {
  const [event] = recorded;
  if (!event) throw new Error('No se registró ningún evento cuando se esperaba uno.');
  return event;
}

/**
 * Repositorio de mentira: guarda lo que la traza intenta escribir para poder afirmar sobre ello,
 * sin base de datos. Es todo lo que el servicio usa del repositorio real.
 */
function fakeRepository(options: { fail?: boolean } = {}) {
  const recorded: CustomerEventInput[] = [];
  const repository = {
    recorded,
    async record(input: CustomerEventInput) {
      await Promise.resolve();
      if (options.fail) throw new Error('la base de datos no respondió');
      recorded.push(input);
      return { id: recorded.length, ...input, createdAt: new Date(), userName: null, user: null };
    },
  };
  return repository as unknown as CustomerEventsRepository & { recorded: CustomerEventInput[] };
}

/** Ficha mínima con todos los campos que la traza compara. */
function customer(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    displayName: 'ANA MARÍA PÉREZ',
    documentNumber: '1020304050',
    createdByUserId: 'user-1',
    firstName: 'Ana',
    lastName: 'María',
    company: null,
    documentType: 'CC',
    checkDigit: null,
    email: 'ana@ejemplo.com',
    phone: '+573001234567',
    country: 'CO',
    region: '05',
    cityCode: '05001',
    cityName: 'Medellín',
    postalCode: '050001',
    addressLine1: 'Calle 1 # 2-3',
    addressLine2: null,
    agreementId: null,
    vatResponsible: false,
    fiscalResponsibilities: ['R-99-PN'],
    active: true,
    ...overrides,
  } as unknown as CustomerWithIntegrations;
}

const userId = 'user-1';

// 1. El alta deja un evento con el autor.
{
  const repository = fakeRepository();
  const service = new CustomerEventsService(repository);
  await service.recordCreated({ id: 7, displayName: 'Ana', documentNumber: '1020304050' }, userId);
  equal(repository.recorded.length, 1, 'El alta debe registrar un evento');
  equal(first(repository.recorded).action, 'CREATED', 'La acción del alta');
  equal(first(repository.recorded).userId, userId, 'El autor del alta');
  // El servicio no fija `origin`: el repositorio lo deja en LIVE y solo el backfill escribe BACKFILL.
  equal(first(repository.recorded).origin, undefined, 'La traza en vivo no fuerza el origen');
}

// 2. Un guardado sin cambios reales no ensucia la traza.
{
  const repository = fakeRepository();
  const service = new CustomerEventsService(repository);
  await service.recordUpdated(customer(), customer(), userId);
  equal(repository.recorded.length, 0, 'Un guardado sin cambios no debe registrar nada');
}

// 3. Solo se registra lo que de verdad cambió, con el valor guardado antes y después.
{
  const repository = fakeRepository();
  const service = new CustomerEventsService(repository);
  await service.recordUpdated(
    customer(),
    customer({ phone: '+573009998888', postalCode: null, active: false }),
    userId,
  );
  equal(repository.recorded.length, 1, 'Una edición real debe registrar un evento');
  equal(first(repository.recorded).action, 'UPDATED', 'La acción de la edición');
  equal(
    first(repository.recorded).changes,
    [
      { field: 'phone', from: '+573001234567', to: '+573009998888' },
      { field: 'postalCode', from: '050001', to: null },
      { field: 'active', from: true, to: false },
    ],
    'Los cambios deben ser exactamente los campos modificados',
  );
}

// 4. El orden de un arreglo también es un cambio: las responsabilidades fiscales las cobra Siigo.
{
  const repository = fakeRepository();
  const service = new CustomerEventsService(repository);
  await service.recordUpdated(
    customer({ fiscalResponsibilities: ['R-99-PN', 'O-13'] }),
    customer({ fiscalResponsibilities: ['O-13', 'R-99-PN'] }),
    userId,
  );
  equal(
    repository.recorded[0]?.changes,
    [{ field: 'fiscalResponsibilities', from: ['R-99-PN', 'O-13'], to: ['O-13', 'R-99-PN'] }],
    'Reordenar responsabilidades fiscales es un cambio',
  );
}

// 5. La sincronización deja un evento por proveedor: el panel necesita saber cuál falló.
{
  const repository = fakeRepository();
  const service = new CustomerEventsService(repository);
  await service.recordSynced(
    { id: 7, displayName: 'Ana', documentNumber: '1020304050' },
    [
      { provider: 'SIIGO', status: 'ERROR', message: 'La dirección no existe en el catálogo.' },
      { provider: 'SERATUS', status: 'SYNCED' },
      { provider: 'PALI', status: 'SYNCED' },
    ],
    userId,
  );
  equal(repository.recorded.length, 3, 'Cada proveedor deja su propio evento');
  equal(
    repository.recorded.map((event) => [event.provider, event.outcome]),
    [
      ['SIIGO', 'ERROR'],
      ['SERATUS', 'SYNCED'],
      ['PALI', 'SYNCED'],
    ],
    'El proveedor y el resultado de cada sincronización',
  );
  equal(
    first(repository.recorded).message,
    'La dirección no existe en el catálogo.',
    'El error de la sincronización debe quedar escrito',
  );
  equal(
    repository.recorded[1]?.message,
    null,
    'Una sincronización correcta no guarda mensaje de error',
  );
}

// 6. El borrado sobrevive al cliente: el evento se guarda sin vínculo y conserva el documento.
{
  const repository = fakeRepository();
  const service = new CustomerEventsService(repository);
  await service.recordDeleted(
    { id: 7, displayName: 'Ana', documentNumber: '1020304050', createdByUserId: userId },
    userId,
  );
  equal(first(repository.recorded).action, 'DELETED', 'La acción del borrado');
  equal(first(repository.recorded).customerId, null, 'El evento del borrado pierde el vínculo');
  equal(
    first(repository.recorded).customerDocument,
    '1020304050',
    'El documento queda como rastro del cliente eliminado',
  );
}

// 7. Si la traza falla, la operación de negocio no se cae: se pierde el rastro, no el cliente.
{
  const repository = fakeRepository({ fail: true });
  const service = new CustomerEventsService(repository);
  let threw = false;
  try {
    await service.recordCreated({ id: 7, displayName: 'Ana', documentNumber: '1020304050' }, null);
    await service.recordUpdated(customer(), customer({ active: false }), userId);
    await service.recordSynced(
      { id: 7, displayName: 'Ana', documentNumber: '1020304050' },
      [{ provider: 'SIIGO', status: 'SYNCED' }],
      userId,
    );
  } catch {
    threw = true;
  }
  equal(threw, false, 'Un fallo de la traza no debe interrumpir la operación');
}

// 8. La lectura entrega autor, cambios y paginación lista para el panel.
{
  const createdAt = new Date('2026-01-15T10:00:00.000Z');
  const repository = {
    async list() {
      await Promise.resolve();
      return [
        [
          {
            id: 1,
            customerId: 7,
            action: 'UPDATED',
            origin: 'LIVE',
            userName: 'Yohander Aguilar',
            customerName: 'Ana',
            customerDocument: '1020304050',
            changes: [{ field: 'phone', from: '1', to: '2' }],
            provider: null,
            outcome: null,
            message: null,
            createdAt,
            user: null,
          },
        ],
        1,
      ] as const;
    },
  } as unknown as CustomerEventsRepository;
  const service = new CustomerEventsService(repository);
  const result = await service.list(7, { page: 1, pageSize: 50 });
  equal(result.data[0]?.actor?.name, 'Yohander Aguilar', 'El autor se lee del nombre copiado');
  equal(result.data[0]?.changes, [{ field: 'phone', from: '1', to: '2' }], 'Los cambios se leen');
  equal(result.pagination, { page: 1, pageSize: 50, total: 1, totalPages: 1 }, 'La paginación');
}

console.log('customer-activity-smoke: OK');
