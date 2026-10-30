import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { Prisma } from '../apps/api/src/generated/prisma/client.js';
import { PuntosColombiaService } from '../apps/api/src/integrations/puntos-colombia/puntos-colombia.service.js';
import {
  PointsInvoicesService,
  pointsForTotal,
} from '../apps/api/src/loyalty/points-invoices.service.js';
import type { PuntosColombiaTokenService } from '../apps/api/src/integrations/puntos-colombia/puntos-colombia-token.service.js';
import type { PointsInvoicesRepository } from '../apps/api/src/loyalty/points-invoices.repository.js';
import type { IntegrationLogsService } from '../apps/api/src/integration-logs/integration-logs.service.js';
import type { SiigoService } from '../apps/api/src/integrations/siigo/siigo.service.js';
import { siigoInvoicePrefixSchema } from '@sevale/validation';

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

const salePayloads: Record<string, unknown>[] = [];
const cancelPayloads: Record<string, unknown>[] = [];
const sentSales = () => salePayloads.length;
const uatAccounts = new Map<string, { pointsAmount: number; allowAccrual: boolean }>([
  ['1011237867', { pointsAmount: 10900, allowAccrual: true }],
  ['101123516', { pointsAmount: 10000, allowAccrual: true }],
  ['0000000000', { pointsAmount: 500, allowAccrual: false }],
  ['500500500', { pointsAmount: 300, allowAccrual: true }],
  ['600600600', { pointsAmount: 700, allowAccrual: true }],
]);
let unauthorizedBalanceRequests = 0;

const server = createServer((request, response) => {
  void (async () => {
    const url = new URL(request.url ?? '/', 'http://localhost');
    const balance = url.pathname.match(/\/accounts\/([^/]+)\/shortBalance$/);
    if (balance) {
      const document = decodeURIComponent(balance[1] as string);
      if (document === '999999999')
        return json(response, 404, { resultCode: 'POS_CUSTOMER_NOT_FOUND' });
      if (document === '401401401' && unauthorizedBalanceRequests++ === 0) {
        return json(response, 401, { resultCode: 'POS_UNAUTHORIZED' });
      }
      const account = uatAccounts.get(document) ?? { pointsAmount: 0, allowAccrual: false };
      return json(response, 200, {
        name: 'Cuenta',
        allowAccrual: account.allowAccrual,
        allowRedemption: true,
        mainBalance: { pointsAmount: account.pointsAmount, pointsValueInMoney: 65400 },
      });
    }
    if (url.pathname.endsWith('/transactions/processsale') && request.method === 'POST') {
      const payload = await body(request);
      salePayloads.push(payload);
      if (payload.documentNo === '500500500')
        return json(response, 500, { resultCode: 'POS_ERROR' });
      // El proveedor no repite el código en el texto: la clasificación no puede depender de leerlo.
      if (payload.documentNo === '600600600')
        return json(response, 409, {
          resultCode: 'POS_DUPLICATE_TRANSACTION',
          resultMsg: 'La transacción ya fue procesada.',
        });
      const granted = Number(payload.mainPoints ?? 0);
      return json(response, 200, {
        approbationNumber: 'AP-9001',
        mainBalance: { pointsEarned: granted, pointsBalance: 50000 + granted },
      });
    }
    if (url.pathname.endsWith('/transactions/cancel') && request.method === 'POST') {
      const payload = await body(request);
      cancelPayloads.push(payload);
      const current = payload.transactionIdentifier as Record<string, unknown> | undefined;
      const invoice = typeof current?.transactionId === 'string' ? current.transactionId : '';
      // Un 5xx deja la anulación por verificar: no se sabe si el proveedor la aplicó.
      if (invoice === 'FV-1-950') return json(response, 500, { resultCode: 'POS_ERROR' });
      // Un rechazo con código propio es definitivo: reintentar daría lo mismo.
      if (invoice === 'FV-1-951')
        return json(response, 409, {
          resultCode: 'POS_TRANSACTION_NOT_FOUND',
          resultMsg: 'La transacción no existe.',
        });
      // Éxito tal como lo devuelve el proveedor: código de confirmación, no un cuerpo de datos.
      return json(response, 200, { resultCode: '0', resultMsg: 'Transacción anulada.' });
    }
    return json(response, 404, { resultCode: 'POS_NOT_FOUND' });
  })();
});

await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
const address = server.address();
if (typeof address === 'string' || address === null)
  throw new Error('Sin puerto para el simulador.');
process.env.PCO_BASE_URL = `http://127.0.0.1:${address.port}`;
process.env.PCO_PARTNER_CODE = '901647454';
process.env.PCO_LOCATION_CODE = 'PDVBRA0001';
process.env.PCO_TERMINAL_ID = 'PCAliados-01';
process.env.PCO_CASHIER_ID = 'Yohander-01';

// --- Dobles de repositorio y servicios ---------------------------------------------------------

type Accrual = Record<string, unknown> & { id: number; status: string };
type Row = {
  id: number;
  source: string;
  siigoInvoiceId: string | null;
  name: string;
  invoiceDate: Date;
  sellerId: number | null;
  customerIdentification: string | null;
  customerDocumentType: string | null;
  total: Prisma.Decimal;
  itemCount: number;
  points: number;
  status: string;
  completedAt: Date | null;
  createdByUserId: string | null;
  createdAt: Date;
  accruals: Accrual[];
};

const users = [
  { id: 'user-admin', name: 'Yohander Aguilar', sellerId: 820, siigoInvoicePrefix: 'FV-1-' },
  { id: 'user-commercial', name: 'Otro Comercial', sellerId: 821, siigoInvoicePrefix: 'FV-2-' },
  { id: 'user-sin-prefijo', name: 'Sin Prefijo', sellerId: 822, siigoInvoicePrefix: null },
];

const invoices = new Map<number, Row>();
let nextInvoiceId = 1;
let nextAccrualId = 1;
const balanceValues: number[] = [];

function newRow(input: {
  name: string;
  siigoInvoiceId: string | null;
  total: string;
  status?: string;
  sellerId?: number;
  source?: string;
  points?: number;
}): Row {
  const row: Row = {
    id: nextInvoiceId++,
    source: input.source ?? 'SIIGO',
    siigoInvoiceId: input.siigoInvoiceId,
    name: input.name,
    invoiceDate: new Date('2026-10-20T00:00:00.000Z'),
    sellerId: input.sellerId ?? 820,
    customerIdentification: '1011237867',
    customerDocumentType: '2',
    total: new Prisma.Decimal(input.total),
    itemCount: 2,
    points: input.points ?? pointsForTotal(new Prisma.Decimal(input.total)),
    status: input.status ?? 'PENDING',
    completedAt: null,
    createdByUserId: 'user-admin',
    createdAt: new Date('2026-10-20T10:00:00.000Z'),
    accruals: [],
  };
  invoices.set(row.id, row);
  return row;
}

const resolved = <T>(value: T): Promise<T> => Promise.resolve(value);

const repository = {
  detail(id: number) {
    const row = invoices.get(id);
    if (!row) return resolved(null);
    return resolved({ ...row, createdBy: users[0], accruals: row.accruals.slice(-1) });
  },
  bySiigoId(siigoInvoiceId: string) {
    return resolved(
      [...invoices.values()].find((row) => row.siigoInvoiceId === siigoInvoiceId) ?? null,
    );
  },
  byName(name: string) {
    return resolved([...invoices.values()].find((row) => row.name === name) ?? null);
  },
  invoicePrefixes() {
    return resolved(users);
  },
  sellerNames(sellerIds: number[]) {
    return resolved(
      users
        .filter((user) => user.sellerId !== null && sellerIds.includes(user.sellerId))
        .map((user) => ({ sellerId: user.sellerId, name: user.name })),
    );
  },
  create(input: Record<string, unknown>) {
    const row = newRow({
      name: String(input.name),
      siigoInvoiceId: (input.siigoInvoiceId as string | null) ?? null,
      total: String(input.total),
      points: Number(input.points),
      // El vendedor y el origen viajan desde el servicio: sin ellos la tabla no puede resolver el
      // nombre ni distinguir una factura de Siigo de una de prueba.
      sellerId: typeof input.sellerId === 'number' ? input.sellerId : undefined,
      source: typeof input.source === 'string' ? input.source : undefined,
    });
    row.status = String(input.status);
    return resolved({ ...row, createdBy: users[0], accruals: [] });
  },
  claim(id: number, userId: string, accrual: Record<string, unknown>) {
    const row = invoices.get(id);
    if (!row) return resolved({ outcome: 'NOT_FOUND' });
    if (row.status === 'COMPLETED') return resolved({ outcome: 'ALREADY_COMPLETED' });
    if (row.status === 'PROCESSING') return resolved({ outcome: 'IN_PROGRESS' });
    if (row.status === 'UNVERIFIED') return resolved({ outcome: 'UNVERIFIED' });
    if (row.status === 'REVOKED') return resolved({ outcome: 'REVOKED' });
    row.status = 'PROCESSING';
    const created: Accrual = {
      id: nextAccrualId++,
      status: 'PROCESSING',
      documentNumber: accrual.documentNumber,
      documentType: accrual.documentType,
      transactionIdentifier: accrual.transactionIdentifier,
      pointsRequested: row.points,
      user: { id: userId, name: 'Yohander Aguilar' },
    };
    row.accruals.push(created);
    return resolved({ outcome: 'CLAIMED', accrualId: created.id, points: row.points });
  },
  markCompleted(invoiceId: number, accrualId: number, result: Record<string, unknown>) {
    const row = invoices.get(invoiceId);
    if (!row) throw new Error('Factura inexistente');
    row.status = 'COMPLETED';
    row.completedAt = new Date();
    const accrual = row.accruals.find((item) => item.id === accrualId);
    if (accrual) Object.assign(accrual, { status: 'COMPLETED', ...result });
    return resolved(null);
  },
  recordBalanceValue(_accrualId: number, valueInMoney: number) {
    balanceValues.push(valueInMoney);
    return resolved(null);
  },
  markFailed(
    invoiceId: number,
    accrualId: number,
    code: string,
    message: string,
    unverified: boolean,
  ) {
    const row = invoices.get(invoiceId);
    if (!row) throw new Error('Factura inexistente');
    row.status = unverified ? 'UNVERIFIED' : 'FAILED';
    const accrual = row.accruals.find((item) => item.id === accrualId);
    if (accrual)
      Object.assign(accrual, { status: row.status, errorCode: code, errorMessage: message });
    return resolved(null);
  },
  claimRevocation(invoiceId: number, userId: string, identifier: Record<string, unknown>) {
    const row = invoices.get(invoiceId);
    if (!row) return resolved({ outcome: 'NOT_FOUND' });
    if (row.status === 'REVOKED') return resolved({ outcome: 'ALREADY_REVOKED' });
    if (row.status === 'REVOKING') return resolved({ outcome: 'IN_PROGRESS' });
    const accrual = row.accruals.find((item) => item.status === 'COMPLETED');
    if (!accrual || row.status !== 'COMPLETED') return resolved({ outcome: 'NOT_ACCRUED' });
    if (accrual.revocationStatus === 'COMPLETED') return resolved({ outcome: 'ALREADY_REVOKED' });
    if (accrual.revocationStatus === 'UNVERIFIED') return resolved({ outcome: 'UNVERIFIED' });
    accrual.revocationStatus = 'PROCESSING';
    accrual.revocationIdentifier = identifier;
    accrual.revokedBy = { id: userId, name: 'Yohander Aguilar' };
    row.status = 'REVOKING';
    return resolved({ outcome: 'CLAIMED', accrualId: accrual.id });
  },
  markRevoked(invoiceId: number, accrualId: number) {
    const row = invoices.get(invoiceId);
    if (!row) throw new Error('Factura inexistente');
    row.status = 'REVOKED';
    const accrual = row.accruals.find((item) => item.id === accrualId);
    if (accrual) Object.assign(accrual, { revocationStatus: 'COMPLETED', revokedAt: new Date() });
    return resolved(null);
  },
  /** Un fallo al anular no deshace los puntos: la factura sigue completada. */
  markRevocationFailed(
    invoiceId: number,
    accrualId: number,
    code: string,
    message: string,
    unverified: boolean,
  ) {
    const row = invoices.get(invoiceId);
    if (!row) throw new Error('Factura inexistente');
    row.status = 'COMPLETED';
    const accrual = row.accruals.find((item) => item.id === accrualId);
    if (accrual)
      Object.assign(accrual, {
        revocationStatus: unverified ? 'UNVERIFIED' : 'FAILED',
        revocationErrorCode: code,
        revocationErrorMessage: message,
      });
    return resolved(null);
  },
};

const siigoCatalog = new Map<string, Record<string, unknown>>([
  [
    'FV-1-846',
    {
      id: 'siigo-846',
      name: 'FV-1-846',
      date: '2026-10-20',
      sellerId: 820,
      total: new Prisma.Decimal('110999.99'),
      customerIdentification: '1011237867',
      itemCount: 3,
    },
  ],
  [
    'FV-1-100',
    {
      id: 'siigo-100',
      name: 'FV-1-100',
      date: '2026-10-21',
      sellerId: 820,
      total: new Prisma.Decimal('999.00'),
      customerIdentification: '1011237867',
      itemCount: 1,
    },
  ],
  [
    'FV-2-500',
    {
      id: 'siigo-500',
      name: 'FV-2-500',
      date: '2026-10-22',
      sellerId: 999,
      total: new Prisma.Decimal('250000.00'),
      customerIdentification: '101123516',
      itemCount: 2,
    },
  ],
]);

const siigo = {
  findInvoiceByName(name: string) {
    return resolved(siigoCatalog.get(name) ?? null);
  },
  /** El nombre de un vendedor que no existe en el CRM se resuelve contra Siigo. */
  sellerName(sellerId: number) {
    sellerNameRequests.push(sellerId);
    return resolved(sellerId === 999 ? 'Vendedor de Siigo' : null);
  },
} as unknown as SiigoService;

const logEntries: Record<string, unknown>[] = [];
const sellerNameRequests: number[] = [];
const logs = {
  record(entry: Record<string, unknown>) {
    logEntries.push(entry);
    return resolved(null);
  },
} as unknown as IntegrationLogsService;

let tokenRequests = 0;
let tokenRefreshes = 0;
const tokens = {
  getAccessToken() {
    tokenRequests += 1;
    return resolved(`token-${tokenRequests}`);
  },
  refreshAccessToken() {
    tokenRefreshes += 1;
    return resolved(`refreshed-${tokenRefreshes}`);
  },
} as unknown as PuntosColombiaTokenService;

const puntos = new PuntosColombiaService(tokens);
const service = new PointsInvoicesService(
  repository as unknown as PointsInvoicesRepository,
  siigo,
  puntos,
  logs,
);

const admin = { id: 'user-admin', role: 'ADMIN' };
const commercial = { id: 'user-commercial', role: 'COMMERCIAL' };
const sinPrefijo = { id: 'user-sin-prefijo', role: 'COMMERCIAL' };

function businessCode(error: unknown): string {
  const response = (error as { getResponse?: () => unknown }).getResponse?.();
  const code = (response as { error?: { code?: unknown } } | undefined)?.error?.code;
  assert(typeof code === 'string', `El error no trae código de negocio: ${String(error)}`);
  return code;
}

// --- Casos --------------------------------------------------------------------------------------

try {
  // Regla de puntos: piso sobre el total original, nunca sobre el valor mostrado.
  assert(pointsForTotal(new Prisma.Decimal('999.99')) === 0, 'Menos de $1.000 no genera puntos.');
  assert(pointsForTotal(new Prisma.Decimal('1000')) === 1, '$1.000 exactos generan un punto.');
  assert(
    pointsForTotal(new Prisma.Decimal('110000.01')) === 110,
    'El piso debe ignorar los centavos.',
  );
  assert(
    pointsForTotal(new Prisma.Decimal('110999.99')) === 110,
    'El piso no debe redondear al alza.',
  );
  assert(
    pointsForTotal(new Prisma.Decimal('999000')) === 999,
    'El total completo debe convertirse.',
  );
  assert(pointsForTotal(0) === 0, 'Un total en cero no genera puntos.');

  // Prefijo: se normaliza siempre en mayúsculas y con guion final.
  assert(siigoInvoicePrefixSchema.parse('fv-1') === 'FV-1-', 'El prefijo debe normalizarse.');
  assert(
    siigoInvoicePrefixSchema.parse(' fv-2- ') === 'FV-2-',
    'El prefijo no debe duplicar el guion.',
  );
  assert(
    siigoInvoicePrefixSchema.parse('') === null,
    'Un prefijo vacío debe quedar sin configurar.',
  );

  // Cuenta inexistente: 404 del proveedor es un resultado de negocio, no un 502.
  assert(
    JSON.stringify(
      await service.lookupAccount({ documentNumber: '999999999', documentType: '2' }),
    ) === '{"found":false}',
    'Una cuenta inexistente debe responder found:false.',
  );
  const encontrada = await service.lookupAccount({
    documentNumber: '1011237867',
    documentType: '2',
  });
  assert(
    encontrada.found && encontrada.balance.pointsAmount === 10900,
    'La cuenta UAT debe leerse.',
  );
  const deshabilitada = await service.lookupAccount({
    documentNumber: '0000000000',
    documentType: '2',
  });
  assert(
    deshabilitada.found && !deshabilitada.balance.allowAccrual,
    'allowAccrual false debe respetarse.',
  );

  // Búsqueda: el prefijo lo pone el backend desde el usuario, no el navegador.
  const preview = await service.search({ number: '846' }, admin);
  assert(preview.invoice.name === 'FV-1-846', 'La búsqueda debe resolver el prefijo del usuario.');
  assert(preview.invoice.points === 110, 'La vista previa debe aplicar la regla de puntos.');
  assert(preview.existingId === null, 'Una factura nueva no debe tener fila previa.');

  const sinPrefijoError = await rejects(
    service.search({ number: '846' }, sinPrefijo),
    'Un usuario sin prefijo no puede buscar facturas.',
  );
  assert(
    businessCode(sinPrefijoError) === 'POINTS_PREFIX_NOT_CONFIGURED',
    'Código de prefijo ausente.',
  );

  const otroSeller = await rejects(
    service.search({ number: '500' }, commercial),
    'Un comercial no puede consultar la factura de otro seller.',
  );
  assert(
    businessCode(otroSeller) === 'POINTS_INVOICE_NOT_OWNED',
    'Debe rechazarse la factura ajena.',
  );

  const adminEligeSeller = await service.search({ number: '500', sellerId: 821 }, admin);
  assert(
    adminEligeSeller.invoice.name === 'FV-2-500',
    'El administrador elige el seller en el buscador.',
  );

  // Registro: se revalida contra Siigo y no se duplica.
  const tooSmall = await rejects(
    service.register({ number: '100' }, admin),
    'Una factura por debajo del mínimo no debe registrarse.',
  );
  assert(
    businessCode(tooSmall) === 'POINTS_INVOICE_TOO_SMALL',
    'Código de factura demasiado pequeña.',
  );

  const registered = await service.register({ number: '846' }, admin);
  assert(registered.status === 'PENDING', 'La factura registrada queda pendiente.');
  const duplicated = await service.register({ number: '846' }, admin);
  assert(
    duplicated.id === registered.id,
    'Registrar dos veces la misma factura no debe duplicarla.',
  );

  // El nombre del vendedor sale primero del CRM. Solo cuando el `sellerId` no pertenece a ningún
  // usuario se consulta Siigo, que es el caso de las facturas históricas.
  const fromCrm = await service.detail(registered.id);
  assert(fromCrm.sellerName === 'Yohander Aguilar', 'El vendedor del CRM debe resolverse local.');
  assert(
    sellerNameRequests.length === 0,
    'Un vendedor que existe en el CRM no debe consultarse en Siigo.',
  );
  const withUnknownSeller = await service.register({ number: '500', sellerId: 821 }, admin);
  assert(
    withUnknownSeller.sellerName === 'Vendedor de Siigo',
    'Un vendedor que no está en el CRM debe resolverse contra Siigo.',
  );
  assert(
    sellerNameRequests.join(',') === '999',
    'Solo debe consultarse Siigo para el vendedor que no existe en el CRM.',
  );

  // Acumulación: la identidad del documento no basta, la cuenta se revalida antes de enviar.
  const noAccount = await rejects(
    service.accrue(registered.id, { documentNumber: '999999999', documentType: '2' }, admin),
    'Acumular con una cuenta inexistente debe fallar.',
  );
  assert(businessCode(noAccount) === 'POINTS_ACCOUNT_NOT_FOUND', 'Código de cuenta inexistente.');

  const notEnabled = await rejects(
    service.accrue(registered.id, { documentNumber: '0000000000', documentType: '2' }, admin),
    'Acumular en una cuenta deshabilitada debe fallar.',
  );
  assert(
    businessCode(notEnabled) === 'POINTS_ACCOUNT_NOT_ENABLED',
    'Código de cuenta deshabilitada.',
  );
  assert(sentSales() === 0, 'No debe enviarse ninguna venta en los rechazos previos.');

  const accrued = await service.accrue(
    registered.id,
    { documentNumber: '1011237867', documentType: '2' },
    admin,
  );
  assert(accrued.invoice.status === 'COMPLETED', 'La acumulación correcta debe quedar completada.');
  assert(accrued.pointsEarned === 110, 'Los puntos acreditados vienen del proveedor.');
  assert(balanceValues[0] === 65400, 'El saldo en pesos debe registrarse cuando se conoce.');

  const sale = salePayloads[0] as Record<string, unknown>;
  assert(sale.documentNo === '1011237867', 'El documento debe viajar en la venta.');
  assert(sale.documentType === '2', 'El tipo de documento debe viajar en la venta.');
  assert(sale.partnerCode === '901647454', 'El partner code sale de la configuración.');
  assert(sale.mainPoints === 110, 'Se envían los puntos calculados de la factura.');
  const identifier = sale.transactionIdentifier as Record<string, unknown>;
  assert(identifier.transactionId === 'FV-1-846', 'El identificador usa el nombre de la factura.');
  assert(identifier.terminalId === 'PCAliados-01', 'El terminal sale de la configuración.');
  assert(identifier.cashierId === 'Yohander-01', 'El cajero sale de la configuración.');
  assert(
    typeof identifier.transactionDate === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(identifier.transactionDate),
    'La fecha debe ir en hora de Colombia y sin zona.',
  );
  assert(
    logEntries.at(-1)?.code === 'POINTS_ACCRUED',
    'La acumulación correcta debe registrarse en logs.',
  );

  const twice = await rejects(
    service.accrue(registered.id, { documentNumber: '1011237867', documentType: '2' }, admin),
    'Una factura no puede acumular dos veces.',
  );
  assert(
    businessCode(twice) === 'POINTS_INVOICE_ALREADY_ACCRUED',
    'Código de factura ya acumulada.',
  );
  assert(sentSales() === 1, 'El reintento no debe volver a enviar la venta.');

  // Error ambiguo (5xx): queda por verificar y no se puede reenviar.
  const ambiguousRow = newRow({
    name: 'FV-1-900',
    siigoInvoiceId: 'siigo-900',
    total: '110000.00',
  });
  const ambiguous = await rejects(
    service.accrue(ambiguousRow.id, { documentNumber: '500500500', documentType: '2' }, admin),
    'Un 5xx del proveedor debe cerrar el intento como fallo.',
  );
  assert(
    businessCode(ambiguous) === 'POINTS_ACCRUAL_UNVERIFIED',
    'Un 5xx deja la acumulación por verificar.',
  );
  assert(
    invoices.get(ambiguousRow.id)?.status === 'UNVERIFIED',
    'La factura debe quedar UNVERIFIED.',
  );
  const blocked = await rejects(
    service.accrue(ambiguousRow.id, { documentNumber: '1011237867', documentType: '2' }, admin),
    'Una acumulación por verificar no puede reenviarse.',
  );
  assert(businessCode(blocked) === 'POINTS_ACCRUAL_UNVERIFIED', 'El bloqueo debe ser explícito.');

  // Transacción duplicada: el proveedor ya la conoce, así que no es un fallo definitivo ni un éxito.
  const duplicateRow = newRow({
    name: 'FV-1-901',
    siigoInvoiceId: 'siigo-901',
    total: '700000.00',
  });
  const duplicate = await rejects(
    service.accrue(duplicateRow.id, { documentNumber: '600600600', documentType: '2' }, admin),
    'Un duplicado reportado por el proveedor debe quedar por verificar.',
  );
  assert(
    businessCode(duplicate) === 'POINTS_ACCRUAL_UNVERIFIED',
    'POS_DUPLICATE_TRANSACTION no puede darse por fallo definitivo.',
  );
  assert(
    invoices.get(duplicateRow.id)?.status === 'UNVERIFIED',
    'El duplicado debe bloquear el reenvío hasta conciliar.',
  );

  // Factura de otro seller: el comercial no puede acumularla aunque conozca el id.
  const foreignRow = newRow({
    name: 'FV-2-501',
    siigoInvoiceId: 'siigo-501',
    total: '250000.00',
    sellerId: 999,
  });
  const foreign = await rejects(
    service.accrue(foreignRow.id, { documentNumber: '101123516', documentType: '2' }, commercial),
    'Un comercial no puede acumular la factura de otro seller.',
  );
  assert(businessCode(foreign) === 'POINTS_INVOICE_NOT_OWNED', 'Debe rechazarse por pertenencia.');

  // --- Anulación ---------------------------------------------------------------------------------

  // Una factura sin acumulación no puede revocarse: no hay nada acreditado que devolver.
  const notAccrued = await rejects(
    service.revoke(
      newRow({ name: 'FV-1-940', siigoInvoiceId: 'siigo-940', total: '110000.00' }).id,
      admin,
    ),
    'Una factura pendiente no puede revocarse.',
  );
  assert(
    businessCode(notAccrued) === 'POINTS_INVOICE_NOT_ACCRUED',
    'Código de factura sin acumular.',
  );

  // Revocar la factura que sí acumuló: los dos identificadores salen de lo que ya está guardado.
  const revoked = await service.revoke(registered.id, admin);
  assert(revoked.status === 'REVOKED', 'La factura revocada debe quedar en REVOKED.');
  assert(revoked.accrual?.revocationStatus === 'COMPLETED', 'La anulación debe quedar completada.');

  const cancellation = cancelPayloads[0] as Record<string, unknown>;
  assert(cancellation.partnerCode === '901647454', 'El partner code viaja en la anulación.');
  const requestIdentifier = cancellation.transactionIdentifier as Record<string, unknown>;
  const originalIdentifier = cancellation.originalTransactionIdentifier as Record<string, unknown>;
  assert(
    requestIdentifier.transactionId === 'FV-1-846',
    'La anulación identifica la factura por su nombre.',
  );
  assert(
    originalIdentifier.transactionId === 'FV-1-846',
    'El identificador original también es el de la factura.',
  );
  assert(
    // El original es el que se envió al acumular, no uno regenerado ahora.
    originalIdentifier.transactionDate === identifier.transactionDate,
    'El identificador original debe reutilizar la fecha con la que se acumuló.',
  );
  assert(
    typeof requestIdentifier.transactionDate === 'string' &&
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(requestIdentifier.transactionDate),
    'La fecha de la anulación va en hora de Colombia y sin zona.',
  );
  assert(
    originalIdentifier.nut === 'FV-1-846' && originalIdentifier.terminalId === 'PCAliados-01',
    'El identificador original viaja completo, no solo el id.',
  );
  assert(
    logEntries.at(-1)?.code === 'POINTS_REVOKED',
    'La anulación correcta debe registrarse en logs.',
  );

  const revokedTwice = await rejects(
    service.revoke(registered.id, admin),
    'Una factura no puede revocarse dos veces.',
  );
  assert(
    businessCode(revokedTwice) === 'POINTS_INVOICE_ALREADY_REVOKED',
    'Código de factura ya revocada.',
  );
  assert(cancelPayloads.length === 1, 'El reintento no debe volver a anular en el proveedor.');

  // Una factura revocada no se puede volver a acumular: los puntos ya se devolvieron en el programa
  // y repetir la venta los acreditaría dos veces.
  const salesBeforeRevoked = sentSales();
  const reaccrueRevoked = await rejects(
    service.accrue(registered.id, { documentNumber: '1011237867', documentType: '2' }, admin),
    'Una factura revocada no debe poder acumularse otra vez.',
  );
  assert(
    businessCode(reaccrueRevoked) === 'POINTS_INVOICE_REVOKED',
    'El intento de acumular una factura revocada debe tener su propio código.',
  );
  assert(
    sentSales() === salesBeforeRevoked,
    'El proveedor no debe recibir una segunda acumulación de la revocada.',
  );

  // 5xx al anular: no se sabe si el proveedor la aplicó, así que queda por verificar. Los puntos
  // siguen acreditados: la factura vuelve a Completado y el bloqueo vive en la anulación.
  const ambiguousCancellation = newRow({
    name: 'FV-1-950',
    siigoInvoiceId: 'siigo-950',
    total: '110000.00',
    status: 'COMPLETED',
  });
  ambiguousCancellation.accruals.push({
    id: nextAccrualId++,
    status: 'COMPLETED',
    documentNumber: '1011237867',
    documentType: '2',
    transactionIdentifier: identifier,
    pointsRequested: 110,
    pointsEarned: 110,
    user: { id: 'user-admin', name: 'Yohander Aguilar' },
  });
  const unverifiedCancellation = await rejects(
    service.revoke(ambiguousCancellation.id, admin),
    'Un 5xx al anular debe dejar la anulación por verificar.',
  );
  assert(
    businessCode(unverifiedCancellation) === 'POINTS_REVOCATION_UNVERIFIED',
    'Un 5xx de la anulación queda por verificar.',
  );
  assert(
    invoices.get(ambiguousCancellation.id)?.status === 'COMPLETED',
    'Un fallo al anular no puede deshacer los puntos ya acreditados.',
  );
  const blockedCancellation = await rejects(
    service.revoke(ambiguousCancellation.id, admin),
    'Una anulación por verificar no puede reenviarse.',
  );
  assert(
    businessCode(blockedCancellation) === 'POINTS_REVOCATION_UNVERIFIED',
    'El bloqueo de la anulación debe ser explícito.',
  );

  // Rechazo con código propio: es definitivo, así que se informa como fallo y se puede reintentar.
  const rejectedCancellation = newRow({
    name: 'FV-1-951',
    siigoInvoiceId: 'siigo-951',
    total: '110000.00',
    status: 'COMPLETED',
  });
  rejectedCancellation.accruals.push({
    id: nextAccrualId++,
    status: 'COMPLETED',
    documentNumber: '1011237867',
    documentType: '2',
    transactionIdentifier: identifier,
    pointsRequested: 110,
    pointsEarned: 110,
    user: { id: 'user-admin', name: 'Yohander Aguilar' },
  });
  const rejected = await rejects(
    service.revoke(rejectedCancellation.id, admin),
    'Un rechazo con código propio debe ser un fallo definitivo.',
  );
  assert(
    businessCode(rejected) === 'POINTS_REVOCATION_REJECTED',
    'Un resultCode de rechazo no puede darse por ambiguo.',
  );
  assert(
    rejectedCancellation.accruals.at(-1)?.revocationStatus === 'FAILED',
    'Un rechazo definitivo deja la anulación en FAILED, no en UNVERIFIED.',
  );
  assert(
    rejectedCancellation.accruals.at(-1)?.revocationErrorMessage === 'La transacción no existe.',
    'El mensaje del proveedor debe conservarse para diagnosticar.',
  );

  // Token rechazado: se renueva una sola vez y la operación continúa.
  const refreshesBefore = tokenRefreshes;
  const retried = await puntos.lookupAccount('401401401', '2');
  assert(retried.pointsAmount === 0, 'El reintento con token nuevo debe resolver la consulta.');
  assert(tokenRefreshes === refreshesBefore + 1, 'El 401 debe renovar el token una única vez.');

  console.log('Puntos Colombia: comprobaciones correctas.');
} finally {
  server.close();
}
