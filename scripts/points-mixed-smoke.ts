import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Prisma } from '../apps/api/src/generated/prisma/client.js';
import { PuntosColombiaService } from '../apps/api/src/integrations/puntos-colombia/puntos-colombia.service.js';
import { PointsRedemptionsService } from '../apps/api/src/loyalty/points-redemptions.service.js';
import type {
  PointsMixedCreation,
  PointsRedemptionsRepository,
} from '../apps/api/src/loyalty/points-redemptions.repository.js';
import { PointsInvoicesService } from '../apps/api/src/loyalty/points-invoices.service.js';
import type { PointsInvoicesRepository } from '../apps/api/src/loyalty/points-invoices.repository.js';
import type { IntegrationLogsService } from '../apps/api/src/integration-logs/integration-logs.service.js';
import type { SiigoService } from '../apps/api/src/integrations/siigo/siigo.service.js';
import type { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { PointsLocationService } from '../apps/api/src/loyalty/points-location.service.js';

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

/** Código de negocio del error, que es lo que el panel usa para decidir qué mostrar. */
function businessCode(error: unknown): string {
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  const code = (response as { error?: { code?: unknown } } | undefined)?.error?.code;
  assert(typeof code === 'string', `El error no trae código de negocio: ${String(error)}`);
  return code;
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

const purchases: Record<string, unknown>[] = [];
const cancellations: Record<string, unknown>[] = [];

/** Las dos habilitaciones se eligen por documento para probar cada rechazo por separado. */
const balances = new Map<
  string,
  { pointsAmount: number; allowAccrual: boolean; allowRedemption: boolean }
>([
  ['1011237866', { pointsAmount: 9185, allowAccrual: true, allowRedemption: true }],
  ['2021237866', { pointsAmount: 100, allowAccrual: true, allowRedemption: true }],
  ['3031237866', { pointsAmount: 9185, allowAccrual: true, allowRedemption: false }],
  ['4041237866', { pointsAmount: 9185, allowAccrual: false, allowRedemption: true }],
  ['500500500', { pointsAmount: 9185, allowAccrual: true, allowRedemption: true }],
  ['600600600', { pointsAmount: 9185, allowAccrual: true, allowRedemption: true }],
  ['700700700', { pointsAmount: 9185, allowAccrual: true, allowRedemption: true }],
  ['800800800', { pointsAmount: 9185, allowAccrual: true, allowRedemption: true }],
  ['900900900', { pointsAmount: 9185, allowAccrual: true, allowRedemption: true }],
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
        allowAccrual: account.allowAccrual,
        allowRedemption: account.allowRedemption,
        mainBalance: { pointsAmount: account.pointsAmount, pointsValueInMoney: 55110 },
      });
    }

    if (
      url.pathname.endsWith('/transactions/processpurchaseandredemption') &&
      request.method === 'POST'
    ) {
      const payload = await body(request);
      purchases.push(payload);
      if (payload.documentNo === '500500500') {
        // 5xx: no se sabe si el proveedor movió los puntos.
        return json(response, 500, { resultCode: 'POS_ERROR' });
      }
      if (payload.documentNo === '600600600') {
        // Rechazo definitivo: nada se movió y se puede corregir y reintentar.
        return json(response, 400, {
          resultCode: 'POS_MIXED_REJECTED',
          resultMsg: 'El proveedor rechazó el pago mixto.',
        });
      }
      if (payload.documentNo === '900900900') {
        // Puntos Colombia usa 401 para el código de verificación inválido, no solo para credenciales.
        return json(response, 401, {
          resultCode: 'UNAUTHORIZED_VERIFICATION_CODE_NOT_VALID',
          resultMsg: 'Some of the data provided are not valid or does not exist.',
        });
      }
      if (typeof payload.pin !== 'string' || payload.pin.length === 0) {
        return json(response, 400, { resultCode: 'COMMON_FIELD_MANDATORY' });
      }
      const burned = Number(payload.mainPointsRedeemed ?? 0);
      const earned = Number(payload.mainPointsAccumulated ?? 0);
      return json(response, 200, {
        mainBalance: {
          bonusPointsEarned: 0,
          pointsBalance: 7518,
          pointsBurned: burned,
          pointsEarned: earned,
        },
        approbationNumber: 'AP-MIXED-1',
        transactionIdentifier: payload.transactionIdentifier,
      });
    }

    if (url.pathname.endsWith('/transactions/cancel') && request.method === 'POST') {
      const payload = await body(request);
      cancellations.push(payload);
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
process.env.PCO_TERMINAL_ID = 'PCAliados-01';
process.env.PCO_CASHIER_ID = 'Yohander-01';

// --- Dobles ------------------------------------------------------------------------------------

type Row = {
  id: number;
  type: 'MIXED';
  documentNumber: string;
  documentType: string;
  customerName: string | null;
  pointsRequested: number;
  pointsRedeemed: number | null;
  pointsEarned: number | null;
  pointsBalance: number | null;
  amountCop: Prisma.Decimal;
  saleTotalCop: Prisma.Decimal | null;
  cashAmountCop: Prisma.Decimal | null;
  approbationNumber: string | null;
  transactionIdentifier: Prisma.JsonValue;
  validationMethod: string | null;
  status: string;
  errorCode: string | null;
  errorMessage: string | null;
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
  return {
    ...row,
    createdBy: { id: 'user-admin', name: 'Admin', email: 'a@example.invalid' },
    reconciledBy: null,
  };
}

function seedRow(overrides: Partial<Row> = {}): Row {
  const row: Row = {
    id: nextId++,
    type: 'MIXED',
    documentNumber: '1011237866',
    documentType: '2',
    customerName: 'Yohander Aguilar',
    pointsRequested: 1667,
    pointsRedeemed: null,
    pointsEarned: null,
    pointsBalance: null,
    amountCop: new Prisma.Decimal('10002.00'),
    saleTotalCop: new Prisma.Decimal('20000.00'),
    cashAmountCop: new Prisma.Decimal('9998.00'),
    approbationNumber: null,
    transactionIdentifier: {
      terminalId: 'PCAliados-01',
      transactionId: 'nut-mixed',
      cashierId: 'Yohander-01',
      locationCode: 'PDVBRA0001',
      transactionDate: '2026-11-23T10:00:00',
      nut: 'nut-mixed',
    },
    validationMethod: 'OTP',
    status: 'PROCESSING',
    errorCode: null,
    errorMessage: null,
    invoiceName: null,
    invoiceDate: null,
    invoiceTotal: null,
    createdByUserId: 'user-admin',
    completedAt: null,
    createdAt: new Date('2026-11-23T15:00:00.000Z'),
    createdBy: null,
    revocationStatus: null,
    revocationIdentifier: null,
    revocationErrorCode: null,
    revocationErrorMessage: null,
    revokedAt: null,
    revokedByUserId: null,
    ...overrides,
  };
  rows.set(row.id, row);
  return row;
}

const repository = {
  createMixed(input: {
    documentNumber: string;
    documentType: string;
    customerName: string | null;
    pointsRequested: number;
    amountCop: Prisma.Decimal;
    saleTotalCop?: Prisma.Decimal;
    cashAmountCop?: Prisma.Decimal;
    validationMethod: string | null;
    transactionIdentifier: Prisma.InputJsonValue;
    createdByUserId: string;
  }): Promise<PointsMixedCreation> {
    // Misma regla que el repositorio real: lo abierto o por conciliar bloquea otra transacción.
    const open = [...rows.values()].find(
      (row) =>
        row.type === 'MIXED' &&
        row.documentNumber === input.documentNumber &&
        row.documentType === input.documentType &&
        (row.status === 'PROCESSING' || row.status === 'UNVERIFIED'),
    );
    if (open) {
      return Promise.resolve({
        outcome: open.status === 'UNVERIFIED' ? 'UNVERIFIED' : 'IN_PROGRESS',
      });
    }
    const row = seedRow({
      ...input,
      transactionIdentifier: input.transactionIdentifier as Prisma.JsonValue,
      saleTotalCop: input.saleTotalCop ?? null,
      cashAmountCop: input.cashAmountCop ?? null,
    });
    // El doble no reproduce todas las columnas de Prisma; el servicio solo usa las que llenó.
    return Promise.resolve({
      outcome: 'CREATED',
      redemption: withAuthor(row),
    } as unknown as PointsMixedCreation);
  },
  markApplied(
    id: number,
    applied: {
      pointsRedeemed: number;
      pointsEarned?: number;
      pointsBalance: number;
      approbationNumber: string | null;
    },
  ) {
    const row = rows.get(id)!;
    Object.assign(row, {
      status: 'PENDING_INVOICE',
      pointsRedeemed: applied.pointsRedeemed,
      pointsEarned: applied.pointsEarned ?? null,
      pointsBalance: applied.pointsBalance,
      approbationNumber: applied.approbationNumber,
      completedAt: new Date(),
      errorCode: null,
      errorMessage: null,
    });
    return Promise.resolve(withAuthor(row));
  },
  markFailed(id: number, code: string, message: string) {
    const row = rows.get(id)!;
    Object.assign(row, { status: 'FAILED', errorCode: code, errorMessage: message });
    return Promise.resolve(withAuthor(row));
  },
  markUnverified(id: number, code: string, message: string) {
    const row = rows.get(id)!;
    Object.assign(row, { status: 'UNVERIFIED', errorCode: code, errorMessage: message });
    return Promise.resolve(withAuthor(row));
  },
  /** Misma regla que el repositorio real: el rechazo definitivo se retira del panel. */
  discardMixed(id: number) {
    rows.delete(id);
    return Promise.resolve({ count: 1 });
  },
  find(id: number) {
    const row = rows.get(id);
    return Promise.resolve(row ? withAuthor(row) : null);
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
    return Promise.resolve(withAuthor(row));
  },
  invoiceNameTaken(name: string, exceptId: number) {
    return Promise.resolve(
      [...rows.values()].some((row) => row.invoiceName === name && row.id !== exceptId),
    );
  },
  mixedInvoiceNameTaken(name: string) {
    return Promise.resolve(
      [...rows.values()].some((row) => row.type === 'MIXED' && row.invoiceName === name),
    );
  },
  claimRevocation(id: number, userId: string, identifier: Prisma.InputJsonValue) {
    const row = rows.get(id);
    if (!row) return Promise.resolve({ outcome: 'NOT_FOUND' as const });
    if (row.status !== 'PENDING_INVOICE' && row.status !== 'COMPLETED') {
      return Promise.resolve({ outcome: 'NOT_REDEEMED' as const });
    }
    const previousStatus = row.status;
    Object.assign(row, {
      status: 'REVOKING',
      revocationStatus: 'PROCESSING',
      revocationIdentifier: identifier as Prisma.JsonValue,
      revokedByUserId: userId,
    });
    return Promise.resolve({ outcome: 'CLAIMED' as const, previousStatus });
  },
  markRevoked(id: number) {
    const row = rows.get(id)!;
    Object.assign(row, { status: 'REVOKED', revocationStatus: 'COMPLETED', revokedAt: new Date() });
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
};

/** Nombres de factura registrados en el panel para acumular; se activan por caso. */
const registeredInvoices = new Set<string>();

const invoices = {
  resolveInvoicePrefix() {
    return Promise.resolve({ prefix: 'FV-1-', sellerId: 820 });
  },
  isInvoiceRegistered(name: string) {
    return Promise.resolve(registeredInvoices.has(name));
  },
};

const siigo = {
  /** Total por número de factura: permite probar la coincidencia con el pago mixto. */
  totals: new Map<string, number>([
    ['FV-1-900', 20000],
    ['FV-1-901', 15000],
    ['FV-1-902', 20000],
  ]),
  findInvoiceByName(name: string) {
    const total = this.totals.get(name);
    if (total === undefined) return Promise.resolve(null);
    return Promise.resolve({
      id: `siigo-${name}`,
      name,
      date: '2026-11-23',
      sellerId: 820,
      total,
      customerIdentification: '1011237866',
      itemCount: 2,
    });
  },
};

const prisma = {
  user: {
    findUnique({ where }: { where: { id: string } }) {
      const found = [
        { id: 'user-admin', pcoLocationCode: 'PDVBRA0001' },
        { id: 'user-sin-punto', pcoLocationCode: null },
      ].find((user) => user.id === where.id);
      return Promise.resolve(found ? { pcoLocationCode: found.pcoLocationCode } : null);
    },
  },
} as unknown as PrismaService;
const location = new PointsLocationService(prisma);

const service = new PointsRedemptionsService(
  repository as unknown as PointsRedemptionsRepository,
  new PuntosColombiaService({ getAccessToken: () => Promise.resolve('token') } as never),
  siigo as unknown as SiigoService,
  invoices as unknown as PointsInvoicesService,
  { record: () => Promise.resolve(null) } as unknown as IntegrationLogsService,
  location,
);

const admin = { id: 'user-admin', role: 'ADMIN' };
const sinPunto = { id: 'user-sin-punto', role: 'ADMIN' };

/** Payload válido: 1.667 puntos ($10.002) y $9.998 en dinero sobre una venta de $20.000. */
const validInput = {
  documentNumber: '1011237866',
  documentType: '2' as const,
  points: 1667,
  pin: '979518',
  saleTotal: '20000.00',
};

try {
  // 1. Sin punto de venta no se consulta ni se envía nada.
  const sinPuntoError = await rejects(
    service.redeemMixed(validInput, sinPunto),
    'Un usuario sin punto de venta no podía operar el pago mixto.',
  );
  assert(
    businessCode(sinPuntoError) === 'POINTS_LOCATION_NOT_CONFIGURED',
    'Sin punto de venta el código debía ser POINTS_LOCATION_NOT_CONFIGURED.',
  );

  // 2. La cuenta tiene que existir y permitir las dos operaciones.
  const missing = await rejects(
    service.redeemMixed({ ...validInput, documentNumber: '999999999' }, admin),
    'Una cuenta inexistente no podía procesar un pago mixto.',
  );
  assert(
    businessCode(missing) === 'POINTS_ACCOUNT_NOT_FOUND',
    `La cuenta inexistente debía responder POINTS_ACCOUNT_NOT_FOUND, respondió ${businessCode(missing)}.`,
  );
  const noRedemption = await rejects(
    service.redeemMixed({ ...validInput, documentNumber: '3031237866' }, admin),
    'Una cuenta sin redención habilitada no podía procesar un pago mixto.',
  );
  assert(
    businessCode(noRedemption) === 'POINTS_REDEMPTION_NOT_ENABLED',
    'La cuenta sin redención debía responder POINTS_REDEMPTION_NOT_ENABLED.',
  );
  const noAccrual = await rejects(
    service.redeemMixed({ ...validInput, documentNumber: '4041237866' }, admin),
    'Una cuenta sin acumulación habilitada no podía procesar un pago mixto.',
  );
  assert(
    businessCode(noAccrual) === 'POINTS_ACCRUAL_NOT_ENABLED',
    'La cuenta sin acumulación debía responder POINTS_ACCRUAL_NOT_ENABLED.',
  );

  // 3. Saldo, mínimo y partición se validan antes de crear la fila o llamar al proveedor.
  const before = rows.size;
  const insufficient = await rejects(
    service.redeemMixed({ ...validInput, documentNumber: '2021237866' }, admin),
    'No se podía redimir más puntos de los disponibles.',
  );
  assert(
    businessCode(insufficient) === 'POINTS_INSUFFICIENT_BALANCE',
    'El saldo insuficiente debía responder POINTS_INSUFFICIENT_BALANCE.',
  );
  const belowMinimum = await rejects(
    service.redeemMixed({ ...validInput, points: 199 }, admin),
    'Redimir por debajo del mínimo debía rechazarse.',
  );
  assert(
    businessCode(belowMinimum) === 'POINTS_REDEMPTION_BELOW_MINIMUM',
    'El mínimo debía responder POINTS_REDEMPTION_BELOW_MINIMUM.',
  );
  const splitInvalid = await rejects(
    service.redeemMixed({ ...validInput, saleTotal: '10002.00' }, admin),
    'Un total sin parte en dinero debía rechazarse.',
  );
  assert(
    businessCode(splitInvalid) === 'POINTS_MIXED_INVALID_SPLIT',
    'La partición inválida debía responder POINTS_MIXED_INVALID_SPLIT.',
  );
  assert(rows.size === before, 'Los rechazos previos al envío no debían crear fila.');
  assert(purchases.length === 0, 'Los rechazos previos al envío no debían llamar al proveedor.');

  // 4. Pago mixto correcto: una sola llamada al endpoint combinado y una sola fila «Por facturar».
  const created = await service.redeemMixed(validInput, admin);
  assert(created.type === 'MIXED', `La fila debía ser MIXED, fue ${created.type}.`);
  assert(created.status === 'PENDING_INVOICE', `La fila quedó ${created.status}.`);
  assert(created.pointsRequested === 1667, 'Los puntos solicitados debían quedar guardados.');
  assert(created.pointsRedeemed === 1667, 'Lo quemado debía ser lo que devolvió el proveedor.');
  assert(created.pointsEarned === 9, 'Lo acumulado debía ser lo que devolvió el proveedor.');
  assert(created.amountCop === '10002.00', `El valor con puntos fue ${created.amountCop}.`);
  assert(created.saleTotalCop === '20000.00', `El total fue ${created.saleTotalCop}.`);
  assert(created.cashAmountCop === '9998.00', `La parte en dinero fue ${created.cashAmountCop}.`);
  assert(
    (purchases.length as number) === 1,
    'El pago mixto debía ser UNA sola llamada al proveedor.',
  );
  const sent = purchases[0]!;
  assert(sent.documentNo === '1011237866', 'El documento debía viajar al proveedor.');
  assert(sent.pin === '979518', 'El PIN debía viajar al proveedor.');
  assert(sent.mainPointsRedeemed === 1667, 'Los puntos redimidos debían viajar.');
  assert(sent.mainPointsAccumulated === 9, 'Los puntos por acumular debían viajar.');
  assert(sent.totalCashRedeemed === 10002, 'El valor en pesos de la redención debía viajar.');
  const methods = sent.paymentMethods as { amount: number; code: string }[];
  assert(methods.length === 1, 'Debía viajar un medio de pago.');
  assert(methods[0]?.amount === 9998, 'La parte en dinero debía viajar como medio de pago.');
  assert(methods[0]?.code === 'UN', 'El código de pago por defecto era UN.');
  assert(
    (sent.transactionIdentifier as Record<string, unknown>).nut ===
      (sent.transactionIdentifier as Record<string, unknown>).transactionId,
    'El NUT debía ser el mismo identificador de la transacción.',
  );

  // 5. Un doble clic o una operación abierta no abre una segunda transacción.
  const open = seedRow({ status: 'PROCESSING', documentNumber: '700700700' });
  const inProgress = await rejects(
    service.redeemMixed({ ...validInput, documentNumber: '700700700' }, admin),
    'Una operación mixta en curso debía bloquear otra.',
  );
  assert(
    businessCode(inProgress) === 'POINTS_MIXED_IN_PROGRESS',
    'La operación en curso debía responder POINTS_MIXED_IN_PROGRESS.',
  );
  assert(open.status === 'PROCESSING', 'La fila en curso no debía cambiar.');
  const ambiguousSeed = seedRow({ status: 'UNVERIFIED', documentNumber: '800800800' });
  const blocked = await rejects(
    service.redeemMixed({ ...validInput, documentNumber: '800800800' }, admin),
    'Un resultado ambiguo sin conciliar debía bloquear el reintento.',
  );
  assert(
    businessCode(blocked) === 'POINTS_MIXED_UNVERIFIED',
    'El resultado ambiguo debía responder POINTS_MIXED_UNVERIFIED.',
  );
  assert(ambiguousSeed.status === 'UNVERIFIED', 'La fila ambigua no debía cambiar.');

  // 6. El interruptor de la modalidad pendiente de UAT: cero deja el cálculo al proveedor.
  process.env.PCO_MIXED_POINTS_MODE = 'zero';
  process.env.PCO_MIXED_PAYMENT_METHOD_CODE = 'CASH';
  await new PuntosColombiaService({
    getAccessToken: () => Promise.resolve('token'),
  } as never).processPurchaseAndRedemption({
    documentNumber: '1011237866',
    documentType: '2',
    pin: '979518',
    pointsRedeemed: 1667,
    pointsAccumulated: 9,
    redeemedAmountCop: 10002,
    cashAmountCop: 9998,
    transactionIdentifier: {
      terminalId: 'PCAliados-01',
      transactionId: 'nut-zero',
      cashierId: 'Yohander-01',
      locationCode: 'PDVBRA0001',
      transactionDate: '2026-11-23T10:00:00',
      nut: 'nut-zero',
    },
  });
  const zeroSent = purchases.at(-1)!;
  assert(
    zeroSent.mainPointsRedeemed === 0,
    'La modalidad ZERO debía enviar puntos redimidos en 0.',
  );
  assert(zeroSent.mainPointsAccumulated === 0, 'La modalidad ZERO debía enviar acumulados en 0.');
  assert(
    (zeroSent.paymentMethods as { code: string }[])[0]?.code === 'CASH',
    'El código de pago configurado debía viajar.',
  );
  delete process.env.PCO_MIXED_POINTS_MODE;
  delete process.env.PCO_MIXED_PAYMENT_METHOD_CODE;

  // 7. Un 5xx deja la fila por verificar y bloquea el reintento; un 4xx la deja fallida.
  const ambiguous = await rejects(
    service.redeemMixed({ ...validInput, documentNumber: '500500500' }, admin),
    'Un 5xx debía dejar el pago mixto por verificar.',
  );
  assert(ambiguous instanceof Error, 'El fallo incierto debía propagarse como error.');
  const ambiguousRow = [...rows.values()].find((row) => row.documentNumber === '500500500');
  assert(ambiguousRow?.status === 'UNVERIFIED', 'La fila debía quedar UNVERIFIED.');
  const rejected = await rejects(
    service.redeemMixed({ ...validInput, documentNumber: '600600600' }, admin),
    'Un 4xx debía fallar el pago mixto.',
  );
  assert(rejected instanceof Error, 'El rechazo definitivo debía propagarse como error.');
  assert(
    ![...rows.values()].some((row) => row.documentNumber === '600600600'),
    'Un rechazo definitivo no debía dejar una fila en el panel.',
  );

  /**
   * 7b. Un código de verificación inválido llega como 401 del proveedor, no como 4xx de negocio.
   * Debe tratarse como rechazo definitivo: la fila queda fallida, con un mensaje de OTP inválido y
   * sin renovar el token ni reintentar la transacción.
   */
  const invalidOtp = await rejects(
    service.redeemMixed({ ...validInput, documentNumber: '900900900' }, admin),
    'Un OTP inválido debía rechazar el pago mixto.',
  );
  assert(
    businessCode(invalidOtp) === 'POINTS_OTP_INVALID',
    `El OTP inválido debía responder POINTS_OTP_INVALID, respondió ${businessCode(invalidOtp)}.`,
  );
  assert(
    ![...rows.values()].some((row) => row.documentNumber === '900900900'),
    'Un OTP inválido no debía dejar una fila en el panel.',
  );
  assert(
    purchases.filter((payload) => payload.documentNo === '900900900').length === 1,
    'Un 401 por OTP inválido no debía renovar el token ni reintentar la transacción.',
  );

  // 8. Asociar la factura exige que el total cuadre con el del pago mixto.
  const mismatch = await rejects(
    service.attachInvoice(created.id, { number: '901' }, admin),
    'Una factura con otro total no debía asociarse.',
  );
  assert(
    businessCode(mismatch) === 'POINTS_MIXED_TOTAL_MISMATCH',
    'El total distinto debía responder POINTS_MIXED_TOTAL_MISMATCH.',
  );
  const invoiced = await service.attachInvoice(created.id, { number: '900' }, admin);
  assert(
    invoiced.status === 'COMPLETED',
    `Con factura debía quedar COMPLETED, quedó ${invoiced.status}.`,
  );
  assert(invoiced.invoice?.name === 'FV-1-900', 'La factura debía quedar asociada.');

  // 9. Una factura usada por otro movimiento o registrada para acumular no se asocia.
  const attachedElsewhere = await service.redeemMixed(validInput, admin);
  const duplicate = await rejects(
    service.attachInvoice(attachedElsewhere.id, { number: '900' }, admin),
    'Una factura ya asociada a otro movimiento no debía reutilizarse.',
  );
  assert(
    businessCode(duplicate) === 'POINTS_INVOICE_ALREADY_ASSOCIATED',
    'La factura repetida debía responder POINTS_INVOICE_ALREADY_ASSOCIATED.',
  );
  registeredInvoices.add('FV-1-902');
  const registered = await rejects(
    service.attachInvoice(attachedElsewhere.id, { number: '902' }, admin),
    'Una factura registrada para acumular no debía asociarse a un pago mixto.',
  );
  assert(
    businessCode(registered) === 'POINTS_INVOICE_ALREADY_REGISTERED',
    'La factura registrada debía responder POINTS_INVOICE_ALREADY_REGISTERED.',
  );
  registeredInvoices.delete('FV-1-902');

  // 10. Revocar reutiliza la anulación de la redención con el identificador original.
  const cancelBefore = cancellations.length;
  const revoked = await service.revoke(created.id, admin);
  assert(revoked.status === 'REVOKED', `Tras revocar quedó ${revoked.status}.`);
  const cancelBody = cancellations[cancelBefore]!;
  const original = cancelBody.originalTransactionIdentifier as Record<string, unknown>;
  const storedIdentifier = rows.get(created.id)!.transactionIdentifier as Record<string, unknown>;
  assert(
    original.nut === storedIdentifier.nut,
    'El original debía ser el identificador del pago mixto, no el de la anulación.',
  );
  assert(
    revoked.invoice?.name === 'FV-1-900',
    'La factura asociada debía conservarse como histórico.',
  );

  // 11. La acumulación normal no puede reutilizar una factura de un pago mixto.
  const usedInvoice = 'FV-1-900';
  const invoiceRepo = {
    detail: () =>
      Promise.resolve({
        id: 1,
        source: 'SIIGO',
        createdByUserId: 'user-admin',
        name: usedInvoice,
        status: 'COMPLETED',
        accruals: [],
      }),
    invoicePrefixes: () =>
      Promise.resolve([
        { id: 'user-admin', name: 'Admin', sellerId: 820, siigoInvoicePrefix: 'FV-1-' },
      ]),
    bySiigoId: () => Promise.resolve(null),
    byName: () => Promise.resolve(null),
  };
  const mixedGuard = {
    mixedInvoiceNameTaken: () => Promise.resolve(true),
  };
  const accrualService = new PointsInvoicesService(
    invoiceRepo as unknown as PointsInvoicesRepository,
    mixedGuard as unknown as PointsRedemptionsRepository,
    siigo as unknown as SiigoService,
    {} as PuntosColombiaService,
    { record: () => Promise.resolve(null) } as unknown as IntegrationLogsService,
    location,
  );
  const accrueBlocked = await rejects(
    accrualService.accrue(1, { documentNumber: '1011237866', documentType: '2' }, admin),
    'Una factura usada en un pago mixto no debía acumular otra vez.',
  );
  assert(
    businessCode(accrueBlocked) === 'POINTS_INVOICE_USED_BY_MIXED',
    'La acumulación sobre una factura mixta debía responder POINTS_INVOICE_USED_BY_MIXED.',
  );
  const registerBlocked = await rejects(
    accrualService.register({ number: '900' }, admin),
    'Una factura usada en un pago mixto no debía registrarse para acumular.',
  );
  assert(
    businessCode(registerBlocked) === 'POINTS_INVOICE_USED_BY_MIXED',
    'El registro de la factura mixta debía responder POINTS_INVOICE_USED_BY_MIXED.',
  );

  console.log(
    'Points mixed smoke: validación de cuenta y punto de venta, saldo/mínimo/partición antes de enviar, una sola llamada a processpurchaseandredemption con los dos importes, fila MIXED «Por facturar» con puntos redimidos y acumulados separados, bloqueo de doble clic y de resultados ambiguos, modalidades SEND/ZERO configurables, fallo incierto conservado para conciliar, rechazos definitivos sin fila en el panel, asociación de factura con total exacto, rechazo de factura repetida o registrada, revocación con el identificador original y bloqueo de una acumulación normal sobre la factura mixta OK.',
  );
} finally {
  server.close();
}
