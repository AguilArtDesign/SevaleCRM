import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Prisma } from '../apps/api/src/generated/prisma/client.js';
import { PuntosColombiaService } from '../apps/api/src/integrations/puntos-colombia/puntos-colombia.service.js';
import { PointsRedemptionsService } from '../apps/api/src/loyalty/points-redemptions.service.js';
import type { PointsRedemptionsRepository } from '../apps/api/src/loyalty/points-redemptions.repository.js';
import { PointsInvoicesService } from '../apps/api/src/loyalty/points-invoices.service.js';
import type { PointsInvoicesRepository } from '../apps/api/src/loyalty/points-invoices.repository.js';
import type { IntegrationLogsService } from '../apps/api/src/integration-logs/integration-logs.service.js';
import type { SiigoService } from '../apps/api/src/integrations/siigo/siigo.service.js';
import { serializeLogBody } from '../apps/api/src/integration-logs/integration-log.types.js';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function rejects(promise: Promise<unknown>, message: string): Promise<unknown> {
  try {
    await promise;
  } catch (error) {
    return error;
  }
  throw new Error(message);
}

function json(response: ServerResponse, status: number, value: unknown) {
  response.writeHead(status, { 'content-type': 'application/json' });
  response.end(JSON.stringify(value));
}

async function body(request: IncomingMessage): Promise<Record<string, unknown>> {
  return new Promise((resolve, reject) => {
    let content = '';
    request.setEncoding('utf8');
    request.on('data', (chunk: string) => (content += chunk));
    request.on('end', () => {
      try {
        resolve(content ? (JSON.parse(content) as Record<string, unknown>) : {});
      } catch (error) {
        reject(error instanceof Error ? error : new Error('JSON inválido'));
      }
    });
    request.on('error', reject);
  });
}

// --- Proveedor simulado ------------------------------------------------------------------------

const redemptions: Record<string, unknown>[] = [];
const challenges: Record<string, unknown>[] = [];
const cancellations: Record<string, unknown>[] = [];

/** El saldo que el simulador devuelve para cada documento. */
const balances = new Map<string, { pointsAmount: number; allowRedemption: boolean }>([
  ['1011237866', { pointsAmount: 9185, allowRedemption: true }],
  ['2021237866', { pointsAmount: 100, allowRedemption: true }],
  ['3031237866', { pointsAmount: 9185, allowRedemption: false }],
  ['500500500', { pointsAmount: 9185, allowRedemption: true }],
  ['600600600', { pointsAmount: 9185, allowRedemption: true }],
]);

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const balance = url.pathname.match(/\/accounts\/([^/]+)\/shortBalance$/);
    if (balance) {
      const document = decodeURIComponent(balance[1] as string);
      if (document === '999999999') {
        return json(response, 404, { resultCode: 'POS_CUSTOMER_NOT_FOUND' });
      }
      const account = balances.get(document);
      if (!account) return json(response, 404, { resultCode: 'POS_CUSTOMER_NOT_FOUND' });
      return json(response, 200, {
        name: 'Yohander Aguilar',
        allowAccrual: true,
        allowRedemption: account.allowRedemption,
        mainBalance: { pointsAmount: account.pointsAmount, pointsValueInMoney: 55110 },
      });
    }

    /**
     * Dos rutas distintas: el código se pide en la validación de identidad y la redención en la de
     * transacciones. Apuntar el código a la de redención devuelve `"pin" is required` y, con un pin
     * real, quemaría los puntos.
     */
    if (url.pathname.endsWith('/Vinculacion/v1/accounts/me/beginidentityvalidation')) {
      const payload = await body(request);
      challenges.push(payload);
      return json(response, 200, {
        processed: true,
        validationMethod: 'OTP',
        suggestedMessage: 'Cod Cel',
        // El proveedor repite el código en la respuesta. El CRM no debe mostrarlo ni guardarlo.
        otpCode: '979518',
      });
    }

    if (url.pathname.endsWith('/transactions/processredemption') && request.method === 'POST') {
      const payload = await body(request);
      redemptions.push(payload);
      if (payload.documentNo === '500500500') {
        // 5xx: no se sabe si los puntos se quemaron.
        return json(response, 500, { resultCode: 'POS_ERROR' });
      }
      if (payload.documentNo === '600600600') {
        // Rechazo definitivo: el código no sirvió.
        return json(response, 400, {
          resultCode: 'POS_INVALID_OTP',
          resultMsg: 'El código ingresado no es válido.',
        });
      }
      // El esquema del proveedor exige `pin` con contenido: sin él la redención no es válida.
      if (typeof payload.pin !== 'string' || payload.pin.length === 0) {
        return json(response, 400, {
          resultCode: 'COMMON_FIELD_MANDATORY',
          resultMsg: '"pin" is required',
        });
      }
      const burned = Number(payload.mainPointsRedeemed ?? 0);
      return json(response, 200, {
        mainBalance: '8185',
        mainPointsBurned: burned,
        approbationNumber: '8a42c1f3f078a903b02964a06dae0d8781dc0c39327d097793',
        transactionIdentifier: payload.transactionIdentifier,
      });
    }

    if (url.pathname.endsWith('/transactions/cancel') && request.method === 'POST') {
      const payload = await body(request);
      cancellations.push(payload);
      const original = payload.originalTransactionIdentifier as Record<string, unknown> | undefined;
      // El NUT del original identifica el caso: el simulador no puede distinguir de otra forma una
      // redención que se anula bien de una que el proveedor rechaza.
      if (original?.nut === 'cancel-rejected') {
        return json(response, 400, {
          resultCode: 'POS_TRANSACTION_NOT_CANCELLABLE',
          resultMsg: 'La transacción no se puede anular.',
        });
      }
      if (original?.nut === 'cancel-ambiguous') {
        return json(response, 500, { resultCode: 'POS_ERROR' });
      }
      return json(response, 200, { resultCode: '0' });
    }

    return json(response, 404, { resultCode: 'POS_NOT_FOUND' });
  })();
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (!address || typeof address === 'string') throw new Error('Sin puerto para el simulador.');

process.env.PCO_BASE_URL = `http://127.0.0.1:${address.port}`;
process.env.PCO_PARTNER_CODE = '901647454';
process.env.PCO_LOCATION_CODE = 'PDVBRA0001';
process.env.PCO_TERMINAL_ID = 'PCAliados-01';
process.env.PCO_CASHIER_ID = 'Yohander-01';

// --- Dobles ------------------------------------------------------------------------------------

type Row = {
  id: number;
  documentNumber: string;
  documentType: string;
  customerName: string | null;
  pointsRequested: number;
  pointsRedeemed: number | null;
  pointsBalance: number | null;
  amountCop: Prisma.Decimal;
  approbationNumber: string | null;
  transactionIdentifier: Prisma.JsonValue;
  validationMethod: string | null;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
  siigoInvoiceId: string | null;
  invoiceName: string | null;
  invoiceDate: Date | null;
  invoiceTotal: Prisma.Decimal | null;
  createdByUserId: string | null;
  completedAt: Date | null;
  createdAt: Date;
  createdBy: { id: string; name: string; email: string } | null;
  revocationStatus: string | null;
  revocationIdentifier: Prisma.JsonValue | null;
  revocationErrorCode: string | null;
  revocationErrorMessage: string | null;
  revokedAt: Date | null;
  revokedByUserId: string | null;
};

const rows = new Map<number, Row>();
let nextId = 1;

function withAuthor(row: Row) {
  return { ...row, createdBy: { id: 'user-admin', name: 'Admin', email: 'a@example.invalid' } };
}

const repository = {
  create(input: {
    documentNumber: string;
    documentType: string;
    customerName: string | null;
    pointsRequested: number;
    amountCop: Prisma.Decimal;
    validationMethod: string | null;
    transactionIdentifier: Prisma.InputJsonValue;
    createdByUserId: string;
  }) {
    const row: Row = {
      id: nextId++,
      ...input,
      transactionIdentifier: input.transactionIdentifier as Prisma.JsonValue,
      pointsRedeemed: null,
      pointsBalance: null,
      approbationNumber: null,
      status: 'PROCESSING',
      errorCode: null,
      errorMessage: null,
      siigoInvoiceId: null,
      invoiceName: null,
      invoiceDate: null,
      invoiceTotal: null,
      completedAt: null,
      createdAt: new Date(),
      createdBy: null,
      revocationStatus: null,
      revocationIdentifier: null,
      revocationErrorCode: null,
      revocationErrorMessage: null,
      revokedAt: null,
      revokedByUserId: null,
    };
    rows.set(row.id, row);
    return withAuthor(row);
  },
  markApplied(
    id: number,
    applied: { pointsRedeemed: number; pointsBalance: number; approbationNumber: string | null },
  ) {
    const row = rows.get(id)!;
    Object.assign(row, {
      status: 'PENDING_INVOICE',
      pointsRedeemed: applied.pointsRedeemed,
      pointsBalance: applied.pointsBalance,
      approbationNumber: applied.approbationNumber,
      completedAt: new Date(),
    });
    return withAuthor(row);
  },
  markFailed(id: number, code: string, message: string) {
    const row = rows.get(id)!;
    Object.assign(row, { status: 'FAILED', errorCode: code, errorMessage: message });
    return withAuthor(row);
  },
  markUnverified(id: number, code: string, message: string) {
    const row = rows.get(id)!;
    Object.assign(row, { status: 'UNVERIFIED', errorCode: code, errorMessage: message });
    return withAuthor(row);
  },
  find(id: number) {
    const row = rows.get(id);
    return row ? withAuthor(row) : null;
  },
  claimRevocation(id: number, userId: string, identifier: Prisma.InputJsonValue) {
    const row = rows.get(id);
    if (!row) return Promise.resolve({ outcome: 'NOT_FOUND' as const });
    if (row.status === 'REVOKED') return Promise.resolve({ outcome: 'ALREADY_REVOKED' as const });
    if (row.status === 'REVOKING') return Promise.resolve({ outcome: 'IN_PROGRESS' as const });
    if (row.status !== 'PENDING_INVOICE' && row.status !== 'COMPLETED') {
      return Promise.resolve({ outcome: 'NOT_REDEEMED' as const });
    }
    if (row.revocationStatus === 'COMPLETED') {
      return Promise.resolve({ outcome: 'ALREADY_REVOKED' as const });
    }
    if (row.revocationStatus === 'UNVERIFIED') {
      return Promise.resolve({ outcome: 'UNVERIFIED' as const });
    }
    // Tras los descartes anteriores el estado ya es uno de los dos que se pueden anular.
    const previousStatus = row.status;
    Object.assign(row, {
      status: 'REVOKING',
      revocationStatus: 'PROCESSING',
      revocationIdentifier: identifier as Prisma.JsonValue,
      revokedByUserId: userId,
      revocationErrorCode: null,
      revocationErrorMessage: null,
    });
    return Promise.resolve({ outcome: 'CLAIMED' as const, previousStatus });
  },
  markRevoked(id: number) {
    const row = rows.get(id)!;
    Object.assign(row, {
      status: 'REVOKED',
      revocationStatus: 'COMPLETED',
      revokedAt: new Date(),
    });
    return Promise.resolve(withAuthor(row));
  },
  markRevocationFailed(
    id: number,
    previousStatus: 'PENDING_INVOICE' | 'COMPLETED',
    code: string,
    message: string,
    unverified: boolean,
  ) {
    const row = rows.get(id)!;
    Object.assign(row, {
      status: previousStatus,
      revocationStatus: unverified ? 'UNVERIFIED' : 'FAILED',
      revocationErrorCode: code,
      revocationErrorMessage: message,
    });
    return Promise.resolve(withAuthor(row));
  },
  attachInvoice(
    id: number,
    invoice: {
      siigoInvoiceId: string | null;
      invoiceName: string;
      invoiceDate: Date;
      invoiceTotal: Prisma.Decimal;
    },
  ) {
    const row = rows.get(id)!;
    Object.assign(row, { status: 'COMPLETED', ...invoice });
    return withAuthor(row);
  },
};

const invoices = {
  resolveInvoicePrefix() {
    return { prefix: 'FV-1-', sellerId: 820 };
  },
};

const siigo = {
  findInvoiceByName(name: string) {
    return {
      id: `siigo-${name}`,
      name,
      date: '2026-11-05',
      sellerId: 820,
      total: 10000,
      customerIdentification: '1011237866',
      itemCount: 2,
    };
  },
};

/**
 * El estado pedido dentro de un `where` de Prisma. El servicio lo mete en un `AND` porque la búsqueda
 * y la fecha también usan `OR` y se pisarían entre sí.
 */
function statusOf(where: unknown) {
  const conditions = (where as { AND?: { status?: string | { in?: string[] } }[] }).AND;
  const status = conditions?.find((condition) => condition.status)?.status;
  if (typeof status === 'string') return [status];
  return status?.in ?? null;
}

const service = new PointsRedemptionsService(
  repository as unknown as PointsRedemptionsRepository,
  new PuntosColombiaService({ getAccessToken: () => Promise.resolve('token') } as never),
  siigo as unknown as SiigoService,
  invoices as unknown as PointsInvoicesService,
  { record: () => Promise.resolve(null) } as unknown as IntegrationLogsService,
);

const admin = { id: 'user-admin', role: 'ADMIN' };

/**
 * Filas de las dos tablas para el listado unido: una redención del 6 y dos acumulaciones del 5 y el
 * 4. Así se comprueba que la mezcla ordena por fecha y no por tabla.
 */
const invoiceRows = [
  {
    id: 10,
    source: 'SIIGO',
    siigoInvoiceId: 'siigo-10',
    name: 'FV-1-810',
    invoiceDate: new Date('2026-11-05T00:00:00.000Z'),
    sellerId: 820,
    customerIdentification: '1011237866',
    customerDocumentType: '2',
    total: new Prisma.Decimal('120000.00'),
    itemCount: 2,
    points: 120,
    status: 'COMPLETED',
    completedAt: new Date('2026-11-05T15:00:00.000Z'),
    createdBy: { id: 'user-admin', name: 'Admin', email: 'a@example.invalid' },
    createdAt: new Date('2026-11-05T15:00:00.000Z'),
    accruals: [],
  },
  {
    id: 11,
    source: 'SIIGO',
    siigoInvoiceId: 'siigo-11',
    name: 'FV-1-811',
    invoiceDate: new Date('2026-11-04T00:00:00.000Z'),
    sellerId: 820,
    customerIdentification: '1011237866',
    customerDocumentType: '2',
    total: new Prisma.Decimal('90000.00'),
    itemCount: 1,
    points: 90,
    status: 'REVOKED',
    completedAt: null,
    createdBy: { id: 'user-admin', name: 'Admin', email: 'a@example.invalid' },
    createdAt: new Date('2026-11-04T15:00:00.000Z'),
    accruals: [],
  },
];

/** Filas de redención para el listado unido, con la forma que devuelve el repositorio real. */
function redemptionRowFor(id: number, createdAt: Date): Row {
  return {
    id,
    documentNumber: '1011237866',
    documentType: '2',
    customerName: 'Yohander Aguilar',
    pointsRequested: 1667,
    pointsRedeemed: 1667,
    pointsBalance: 8185,
    amountCop: new Prisma.Decimal('10002.00'),
    approbationNumber: 'AP-1',
    transactionIdentifier: {},
    validationMethod: 'OTP',
    status: 'PENDING_INVOICE',
    errorCode: null,
    errorMessage: null,
    siigoInvoiceId: null,
    invoiceName: null,
    invoiceDate: null,
    invoiceTotal: null,
    createdByUserId: 'user-admin',
    completedAt: createdAt,
    createdAt,
    createdBy: null,
    revocationStatus: null,
    revocationIdentifier: null,
    revocationErrorCode: null,
    revocationErrorMessage: null,
    revokedAt: null,
    revokedByUserId: null,
  };
}

const redemptionRows: Row[] = [
  withAuthor(redemptionRowFor(2, new Date('2026-11-06T14:00:00.000Z'))),
  withAuthor(redemptionRowFor(3, new Date('2026-11-03T14:00:00.000Z'))),
];

/**
 * Siembra una redención lista para anular. El NUT del identificador elige qué hace el simulador al
 * anular: es la única forma de probar el rechazo y el fallo incierto, que dependen del proveedor.
 */
let seedId = 900;
function seedRevocable(status: 'PENDING_INVOICE' | 'COMPLETED', nut: string): Row {
  const row = redemptionRowFor(seedId++, new Date('2026-11-10T13:00:00.000Z'));
  row.status = status;
  row.transactionIdentifier = {
    terminalId: 'PCAliados-01',
    transactionId: nut,
    cashierId: 'Yohander-01',
    locationCode: 'PDVBRA0001',
    transactionDate: '2026-11-10T13:00:00',
    nut,
  };
  if (status === 'COMPLETED') {
    row.siigoInvoiceId = `siigo-${nut}`;
    row.invoiceName = 'FV-1-900';
    row.invoiceDate = new Date('2026-11-10T00:00:00.000Z');
    row.invoiceTotal = new Prisma.Decimal('10002.00');
  }
  rows.set(row.id, row);
  // También entra en el listado del panel: `redemptionRows` es lo que lee el doble para paginar. Se
  // guarda la fila viva, no una copia, porque los casos siguientes le cambian el estado.
  redemptionRows.push(row);
  return row;
}

try {
  // 1. La consulta distingue una cuenta inexistente de una que existe.
  const found = await service.lookup({ documentNumber: '1011237866', documentType: '2' });
  assert(found.found === true, 'La cuenta de prueba debía existir.');
  assert(found.balance.pointsAmount === 9185, 'El saldo debía ser el del proveedor.');
  assert(found.balance.allowRedemption === true, 'La cuenta debía permitir redimir.');
  const missing = await service.lookup({ documentNumber: '999999999', documentType: '2' });
  assert(missing.found === false, 'Una cuenta inexistente debía informarse como no encontrada.');

  // 2. El código se pide y el que devuelve el proveedor no se propaga.
  const challenge = await service.requestChallenge({
    documentNumber: '1011237866',
    documentType: '2',
  });
  assert(challenge.validationMethod === 'OTP', 'El método de validación debía ser OTP.');
  assert(
    !JSON.stringify(challenge).includes('979518'),
    'El código del proveedor no debe llegar al navegador.',
  );
  const challengePayload = challenges[0]!;
  assert(
    JSON.stringify(challengePayload.otpActions) === '{"validate":false,"redeem":true}',
    'La solicitud del código debía pedir solo la redención.',
  );
  assert(
    !('pin' in challengePayload),
    'La solicitud del código no debe llevar pin: la redención sí lo exige y con uno real quemaría los puntos.',
  );

  // 3. Sin saldo suficiente no se llama al proveedor ni se crea la fila.
  const before = rows.size;
  const insufficient = await rejects(
    service.redeem(
      { documentNumber: '2021237866', documentType: '2', points: 500, pin: '979518' },
      admin,
    ),
    'No se podía redimir más puntos de los que hay.',
  );
  assert(
    (insufficient as { getResponse?: () => unknown }).getResponse?.() !== undefined,
    'La falta de saldo debía ser un error de negocio.',
  );
  assert(rows.size === before, 'Una redención sin saldo no debía crear fila.');
  assert(redemptions.length === 0, 'Una redención sin saldo no debía llegar al proveedor.');

  // 3b. El mínimo del proveedor son 200 puntos: por debajo no se llama ni se crea fila.
  const belowMinimum = await rejects(
    service.redeem(
      { documentNumber: '1011237866', documentType: '2', points: 199, pin: '979518' },
      admin,
    ),
    'Redimir por debajo del mínimo debía rechazarse.',
  );
  assert(
    (belowMinimum as { getResponse?: () => unknown }).getResponse?.() !== undefined,
    'El mínimo debía ser un error de negocio.',
  );
  assert(rows.size === before, 'Una redención por debajo del mínimo no debía crear fila.');
  assert(
    redemptions.length === 0,
    'Una redención por debajo del mínimo no debía llegar al proveedor.',
  );

  // 4. Una cuenta inhabilitada para redimir se rechaza antes de enviar.
  await rejects(
    service.redeem(
      { documentNumber: '3031237866', documentType: '2', points: 100, pin: '979518' },
      admin,
    ),
    'Una cuenta sin redención habilitada no podía redimir.',
  );

  // 5. Redención correcta: los puntos los dice el proveedor y el importe es puntos × 6.
  const redeemed = await service.redeem(
    { documentNumber: '1011237866', documentType: '2', points: 1667, pin: '979518' },
    admin,
  );
  assert(redeemed.status === 'PENDING_INVOICE', `La redención quedó ${redeemed.status}.`);
  assert(redeemed.pointsRedeemed === 1667, 'Los puntos quemados debían ser los del proveedor.');
  assert(
    redeemed.amountCop === '10002.00',
    `El importe debía ser 10002.00, fue ${redeemed.amountCop}.`,
  );
  assert(redeemed.pointsBalance === 8185, 'El saldo debía ser el que devolvió el proveedor.');
  const sent = redemptions[0]!;
  assert(sent.pin === '979518', 'El PIN debía viajar al proveedor.');
  assert(sent.mainPointsRedeemed === 1667, 'La cantidad de puntos debía viajar al proveedor.');
  assert(
    (sent.transactionIdentifier as Record<string, unknown>).nut ===
      (sent.transactionIdentifier as Record<string, unknown>).transactionId,
    'El NUT debía ser el mismo identificador de la transacción.',
  );

  // 6. Un 5xx deja la redención por verificar: no se puede reintentar a ciegas.
  const unverified = await rejects(
    service.redeem(
      { documentNumber: '500500500', documentType: '2', points: 500, pin: '979518' },
      admin,
    ),
    'Un 5xx debía dejar la redención por verificar.',
  );
  assert(unverified instanceof Error, 'El fallo incierto debía propagarse como error.');
  const unverifiedRow = [...rows.values()].find((row) => row.documentNumber === '500500500');
  assert(unverifiedRow?.status === 'UNVERIFIED', 'La fila debía quedar UNVERIFIED.');

  // 7. Un rechazo es definitivo: la fila queda fallida.
  await rejects(
    service.redeem(
      { documentNumber: '600600600', documentType: '2', points: 500, pin: '979518' },
      admin,
    ),
    'Un rechazo debía fallar la redención.',
  );
  const failedRow = [...rows.values()].find((row) => row.documentNumber === '600600600');
  assert(failedRow?.status === 'FAILED', 'La fila debía quedar FAILED.');

  // 8. Asociar la factura cierra la redención.
  const invoiced = await service.attachInvoice(redeemed.id, { number: '844' }, admin);
  assert(
    invoiced.status === 'COMPLETED',
    `Con factura debía quedar COMPLETED, quedó ${invoiced.status}.`,
  );
  assert(invoiced.invoice?.name === 'FV-1-844', 'La factura debía quedar asociada.');
  assert(invoiced.invoice?.total === '10000.00', 'El total debía ser el de Siigo.');

  // 9. Una redención ya facturada no se vuelve a facturar.
  await rejects(
    service.attachInvoice(redeemed.id, { number: '844' }, admin),
    'Una redención ya facturada no debía aceptar otra factura.',
  );

  // 10. El código y el PIN no quedan escritos en la bitácora de integraciones.
  const logged = serializeLogBody({ documentNo: '1011237866', pin: '979518', otpCode: '979518' });
  assert(logged !== null, 'El cuerpo debía serializarse.');
  assert(!logged.includes('979518'), `La bitácora no debe guardar el código: ${logged}`);

  /**
   * 11. El listado del panel mezcla dos tablas. Lo delicado es que la página salga ordenada y
   * completa: una acumulación y una redención del mismo día se alternan, así que el corte no puede
   * hacerse tabla por tabla.
   */
  const panel = new PointsInvoicesService(
    {
      listSlice: (_where: unknown, take: number) => Promise.resolve(invoiceRows.slice(0, take)),
      count: () => Promise.resolve(invoiceRows.length),
      // Los nombres de vendedor salen del CRM; sin ninguno, la fila muestra el id de Siigo.
      sellerNames: () => Promise.resolve([]),
    } as unknown as PointsInvoicesRepository,
    {
      // El doble respeta el filtro de estado: sin eso, el panel «encontraría» redenciones que la
      // consulta real descartaría y la comprobación del filtro no probaría nada. El estado llega
      // dentro de un `AND`, no en la raíz del `where`.
      listSlice: (where: unknown, take: number) => {
        const statuses = statusOf(where);
        const filtered = statuses
          ? redemptionRows.filter((row) => statuses.includes(row.status))
          : redemptionRows;
        return Promise.resolve(filtered.slice(0, take).map(withAuthor));
      },
      count: (where: unknown) => {
        const statuses = statusOf(where);
        return Promise.resolve(
          statuses
            ? redemptionRows.filter((row) => statuses.includes(row.status)).length
            : redemptionRows.length,
        );
      },
    } as unknown as PointsRedemptionsRepository,
    { sellerName: () => Promise.resolve(null) } as unknown as SiigoService,
    new PuntosColombiaService({ getAccessToken: () => Promise.resolve('token') } as never),
    { record: () => Promise.resolve(null) } as unknown as IntegrationLogsService,
  );

  const firstPage = await panel.list({
    search: '',
    status: 'all',
    page: 1,
    pageSize: 2,
  } as never);
  assert(
    firstPage.pagination.total === 4,
    `El total debía sumar las dos tablas, fue ${firstPage.pagination.total}.`,
  );
  assert(firstPage.data.length === 2, 'La primera página debía traer dos filas.');
  // La más reciente es una redención del 6 y luego una factura del 5; la mezcla las ordena así.
  assert(
    firstPage.data[0]?.kind === 'REDEMPTION' && firstPage.data[0].id === 2,
    'La fila más reciente debía ser la redención.',
  );
  assert(
    firstPage.data[1]?.kind === 'ACCRUAL',
    'La segunda fila debía ser la acumulación del día anterior.',
  );

  const secondPage = await panel.list({
    search: '',
    status: 'all',
    page: 2,
    pageSize: 2,
  } as never);
  assert(secondPage.data.length === 2, 'La segunda página debía traer las dos filas restantes.');
  assert(
    !secondPage.data.some((row) => row.kind === 'REDEMPTION' && row.id === 2),
    'Una fila no puede repetirse entre páginas.',
  );

  const onlyPendingInvoice = await panel.list({
    search: '',
    status: 'PENDING_INVOICE',
    page: 1,
    pageSize: 20,
  } as never);
  assert(
    onlyPendingInvoice.data.every((row) => row.kind === 'REDEMPTION'),
    'Filtrar por pendiente de factura no debe devolver acumulaciones.',
  );

  const onlyRevoked = await panel.list({
    search: '',
    status: 'REVOKED',
    page: 1,
    pageSize: 20,
  } as never);
  assert(
    onlyRevoked.data.every((row) => row.kind === 'ACCRUAL'),
    'Filtrar por revocado no debe devolver redenciones sin anular: una redención también se anula y entra en ese filtro.',
  );

  /**
   * 12. Revocar una redención pendiente de factura. Los puntos vuelven al cliente y la fila queda
   * revocada, con el identificador de la redención como original y uno nuevo para la anulación.
   */
  const cancelBefore = cancellations.length;
  const pending = seedRevocable('PENDING_INVOICE', 'nut-pending');
  const revoked = await service.revoke(pending.id, admin);
  assert(
    revoked.status === 'REVOKED',
    `Tras revocar debía quedar REVOKED, quedó ${revoked.status}.`,
  );
  assert(revoked.revocationStatus === 'COMPLETED', 'La anulación debía quedar completada.');
  assert(revoked.revokedAt !== null, 'La anulación debía dejar fecha de revocación.');
  const cancelBody = cancellations[cancelBefore]!;
  const cancellationId = cancelBody.transactionIdentifier as Record<string, unknown>;
  const originalId = cancelBody.originalTransactionIdentifier as Record<string, unknown>;
  assert(
    originalId.nut === 'nut-pending',
    'El original debía ser el identificador con el que se redimió.',
  );
  assert(
    cancellationId.nut !== originalId.nut,
    'La anulación debía llevar un identificador nuevo, no el de la redención.',
  );
  assert(
    cancellationId.nut === cancellationId.transactionId,
    'El NUT de la anulación debía ser el mismo identificador de la transacción.',
  );
  assert(
    cancellationId.transactionDate !== originalId.transactionDate,
    'La fecha es lo que distingue la anulación del original.',
  );

  // 13. Con factura asociada también se puede anular, y la factura se conserva como histórico.
  const invoicedSeed = seedRevocable('COMPLETED', 'nut-invoiced');
  const revokedInvoiced = await service.revoke(invoicedSeed.id, admin);
  assert(
    revokedInvoiced.status === 'REVOKED',
    'Una redención facturada también debía poder anularse.',
  );
  assert(
    revokedInvoiced.invoice?.name === 'FV-1-900',
    'La factura asociada debía conservarse en la fila.',
  );

  // 14. Un rechazo del proveedor no deshace nada: la redención vuelve a su estado y se puede repetir.
  const rejectedSeed = seedRevocable('PENDING_INVOICE', 'cancel-rejected');
  await rejects(service.revoke(rejectedSeed.id, admin), 'Un rechazo de la anulación debía fallar.');
  const afterReject = rows.get(rejectedSeed.id)!;
  assert(
    afterReject.status === 'PENDING_INVOICE',
    `Tras un rechazo debía volver a PENDING_INVOICE, quedó ${afterReject.status}.`,
  );
  assert(afterReject.revocationStatus === 'FAILED', 'La anulación rechazada debía quedar fallida.');
  const retryBefore = cancellations.length;
  await rejects(service.revoke(rejectedSeed.id, admin), 'El reintento volvía a ser rechazado.');
  assert(
    cancellations.length === retryBefore + 1,
    'Una anulación rechazada debía poder reintentarse contra el proveedor.',
  );

  // 15. Un 5xx es ambiguo: los puntos pudieron volver, así que no se reintenta a ciegas.
  const ambiguousSeed = seedRevocable('COMPLETED', 'cancel-ambiguous');
  await rejects(
    service.revoke(ambiguousSeed.id, admin),
    'Un 5xx debía dejar la anulación incierta.',
  );
  const afterAmbiguous = rows.get(ambiguousSeed.id)!;
  assert(
    afterAmbiguous.status === 'COMPLETED',
    `Un fallo incierto debía devolver la redención a COMPLETED, quedó ${afterAmbiguous.status}.`,
  );
  assert(
    afterAmbiguous.revocationStatus === 'UNVERIFIED',
    'La anulación incierta debía quedar por verificar.',
  );
  const blockedBefore = cancellations.length;
  await rejects(
    service.revoke(ambiguousSeed.id, admin),
    'Una anulación por verificar no debía reintentarse.',
  );
  assert(
    cancellations.length === blockedBefore,
    'Una anulación por verificar no debía volver a llegar al proveedor.',
  );

  // 16. Una redención fallida no descontó nada al cliente: no hay puntos que devolver.
  const failedSeed = seedRevocable('PENDING_INVOICE', 'nut-failed');
  failedSeed.status = 'FAILED';
  await rejects(
    service.revoke(failedSeed.id, admin),
    'Una redención fallida no debía poder anularse.',
  );

  /**
   * 17. El filtro agrupa los dos estados que solo duran lo que tarda el proveedor. Pedir «En proceso»
   * tiene que traer tanto una redención `PROCESSING` como una `REVOKING`, sin dejar fuera ninguna.
   */
  const inProgressSeed = seedRevocable('PENDING_INVOICE', 'nut-inprogress');
  inProgressSeed.status = 'PROCESSING';
  const inProgress = await panel.list({
    search: '',
    status: 'IN_PROGRESS',
    page: 1,
    pageSize: 20,
  } as never);
  assert(
    inProgress.data.some((row) => row.kind === 'REDEMPTION' && row.id === inProgressSeed.id),
    '«En proceso» debía incluir la redención PROCESSING.',
  );
  assert(
    inProgress.data.every(
      (row) => row.kind === 'ACCRUAL' || ['PROCESSING', 'REVOKING'].includes(row.status),
    ),
    '«En proceso» no debía devolver redenciones ya terminadas.',
  );

  console.log(
    'Points redemption smoke: lookup, OTP challenge sin filtrar el código, saldo insuficiente, cuenta inhabilitada, redención correcta con importe puntos × 6, fallo incierto, rechazo definitivo, factura asociada, bitácora sin PIN, anulación con identificador nuevo, factura conservada, rechazo reintentable, 5xx bloqueado y filtro «En proceso» OK.',
  );
} finally {
  server.close();
}
