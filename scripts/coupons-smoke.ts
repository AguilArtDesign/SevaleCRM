import '../apps/api/src/config/load-environment.js';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword } from 'better-auth/crypto';
import { couponTypes, resolveCouponType } from '@sevale/shared';
import { AppModule } from '../apps/api/src/app.module.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { Role } from '../apps/api/src/generated/prisma/client.js';

process.env.BETTER_AUTH_SECRET ||= 'local-coupons-smoke-secret-at-least-32-characters';

type Store = 'SERATUS' | 'PALI';
type RecordedRequest = { store: Store; url: string; method: string; body: Record<string, unknown> };

// Las tiendas se simulan: esta prueba nunca debe crear ni borrar cupones reales en Seratus y Pali.
// El mock solo intercepta los hosts de las tiendas, así que las peticiones al propio CRM bajo
// prueba siguen usando fetch real.
const wooRequests: RecordedRequest[] = [];
const forcedByStore = new Map<Store, Response[]>();
let nextWooCouponId = 1000;

const realFetch = globalThis.fetch;

function requestUrl(input: string | URL | Request): string {
  if (typeof input === 'string') return input;
  return input instanceof URL ? input.href : input.url;
}

function requestBody(body: BodyInit | null | undefined): Record<string, unknown> {
  if (typeof body !== 'string') return {};
  try {
    return JSON.parse(body) as Record<string, unknown>;
  } catch {
    return {};
  }
}

function storeOf(url: URL): Store | null {
  if (url.hostname === 'seratus.test') return 'SERATUS';
  if (url.hostname === 'pali.test') return 'PALI';
  return null;
}

// Encola una respuesta concreta para la próxima petición de esa tienda. Así se simula el rechazo
// del proveedor y el cupón que ya no existe sin depender del orden en que respondan las dos.
function failStore(store: Store, response: Response): void {
  forcedByStore.set(store, [...(forcedByStore.get(store) ?? []), response]);
}

function wooCouponResponse(
  store: Store,
  url: URL,
  method: string,
  body: Record<string, unknown>,
): Response {
  const forced = forcedByStore.get(store)?.shift();
  if (forced) return forced;
  const segments = url.pathname.split('/').filter(Boolean);
  const identifier = Number(segments.at(-1));
  if (method === 'POST') {
    return Response.json({ id: nextWooCouponId++, code: body.code ?? '' }, { status: 201 });
  }
  if (method === 'PUT') {
    return Response.json({ id: identifier, code: body.code ?? '' });
  }
  if (method === 'DELETE') {
    return Response.json({ deleted: true, previous: { id: identifier } });
  }
  throw new Error(`Petición inesperada a la tienda: ${method} ${url.href}`);
}

globalThis.fetch = (input: string | URL | Request, init?: RequestInit) => {
  const url = new URL(requestUrl(input));
  const store = storeOf(url);
  if (!store) return realFetch(input, init);
  const method = (init?.method ?? 'GET').toUpperCase();
  const body = requestBody(init?.body);
  wooRequests.push({ store, url: url.href, method, body });
  return Promise.resolve(wooCouponResponse(store, url, method, body));
};

process.env.SERATUS_API_URL = 'https://seratus.test/wp-json/wc/v3';
process.env.WOOCOMMERCE_SERATUS_CK = 'seratus-key';
process.env.WOOCOMMERCE_SERATUS_CS = 'seratus-secret';
process.env.PALI_API_URL = 'https://pali.test/wp-json/wc/v3';
process.env.WOOCOMMERCE_PALI_CK = 'pali-key';
process.env.WOOCOMMERCE_PALI_CS = 'pali-secret';
process.env.WOOCOMMERCE_USERNAME = 'sevale-crm';
process.env.SERATUS_PASSWORD = 'seratus-crm-password';
process.env.PALI_PASSWORD = 'pali-crm-password';

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
  logger: false,
});
app.setGlobalPrefix('api');
app.enableCors({
  origin: process.env.FRONTEND_URL || 'http://localhost:5173',
  credentials: true,
});
await app.listen(0, '127.0.0.1');

const prisma = app.get(PrismaService);
const origin = process.env.FRONTEND_URL || 'http://localhost:5173';
const baseUrl = await app.getUrl();
const runId = randomUUID();
const adminId = randomUUID();
const commercialId = randomUUID();
const couponCode = `smoke-${runId}`;
const password = `S-${randomUUID()}-9a!`;

function expectStatus(response: Response, status: number, context: string) {
  if (response.status !== status) {
    throw new Error(`${context}: se esperaba ${status} y se recibió ${response.status}.`);
  }
}

function cookieFrom(response: Response): string {
  const cookie = response.headers.getSetCookie()[0]?.split(';')[0];
  if (!cookie) throw new Error('Better Auth no creó la cookie de sesión.');
  return cookie;
}

async function login(email: string): Promise<string> {
  const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      'x-captcha-response': 'XXXX.DUMMY.TOKEN.XXXX',
    },
    body: JSON.stringify({ email, password }),
  });
  expectStatus(response, 200, `Inicio de sesión de ${email}`);
  return cookieFrom(response);
}

async function api(path: string, cookie?: string, init?: RequestInit) {
  return fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      ...(init?.body ? { 'content-type': 'application/json' } : {}),
      origin,
      ...(cookie ? { cookie } : {}),
      ...init?.headers,
    },
  });
}

function couponPayload(overrides: Record<string, unknown> = {}) {
  return {
    coupon: couponCode,
    description: 'Cupón smoke',
    type: 'percent',
    amount: 20,
    dateExpires: null,
    individualUse: false,
    excludeSaleItems: false,
    usageLimit: null,
    usageLimitPerUser: null,
    ...overrides,
  };
}

try {
  if (couponTypes.length !== 1 || resolveCouponType('percent')?.title !== 'Porcentaje') {
    throw new Error('El catálogo de tipos de cupón no contiene los valores esperados.');
  }
  if (resolveCouponType('fixed') !== null) {
    throw new Error('El catálogo de tipos de cupón aceptó un tipo inexistente.');
  }

  const passwordHash = await hashPassword(password);
  const adminEmail = `coupons-admin-${runId}@example.invalid`;
  const commercialEmail = `coupons-commercial-${runId}@example.invalid`;
  await prisma.user.create({
    data: {
      id: adminId,
      name: 'Coupons Smoke Admin',
      email: adminEmail,
      emailVerified: true,
      role: Role.ADMIN,
      active: true,
      accounts: {
        create: {
          id: randomUUID(),
          accountId: adminId,
          providerId: 'credential',
          issuer: 'local:credential',
          password: passwordHash,
        },
      },
    },
  });
  await prisma.user.create({
    data: {
      id: commercialId,
      name: 'Coupons Smoke Commercial',
      email: commercialEmail,
      emailVerified: true,
      role: Role.COMMERCIAL,
      active: true,
      accounts: {
        create: {
          id: randomUUID(),
          accountId: commercialId,
          providerId: 'credential',
          issuer: 'local:credential',
          password: passwordHash,
        },
      },
    },
  });

  expectStatus(await api('/api/coupons'), 401, 'Listado anónimo');
  const adminCookie = await login(adminEmail);
  const commercialCookie = await login(commercialEmail);
  expectStatus(
    await api('/api/coupons?search=&page=1&pageSize=20', commercialCookie),
    200,
    'Listado como comercial',
  );

  // El comercial solo consulta: crear, editar, sincronizar y borrar son exclusivos del admin.
  expectStatus(
    await api('/api/coupons', commercialCookie, {
      method: 'POST',
      body: JSON.stringify(couponPayload()),
    }),
    403,
    'Creación como comercial',
  );
  expectStatus(
    await api('/api/coupons/1', commercialCookie, {
      method: 'PATCH',
      body: JSON.stringify({ amount: 15 }),
    }),
    403,
    'Edición como comercial',
  );
  expectStatus(
    await api('/api/coupons/1/sync', commercialCookie, { method: 'POST' }),
    403,
    'Sincronización como comercial',
  );
  expectStatus(
    await api('/api/coupons/1', commercialCookie, { method: 'DELETE' }),
    403,
    'Eliminación como comercial',
  );

  expectStatus(
    await api('/api/coupons', adminCookie, {
      method: 'POST',
      body: JSON.stringify(couponPayload({ amount: 0 })),
    }),
    400,
    'Porcentaje cero',
  );
  expectStatus(
    await api('/api/coupons', adminCookie, {
      method: 'POST',
      body: JSON.stringify(couponPayload({ amount: 101 })),
    }),
    400,
    'Porcentaje mayor a cien',
  );
  expectStatus(
    await api('/api/coupons', adminCookie, {
      method: 'POST',
      body: JSON.stringify(couponPayload({ type: 'fixed' })),
    }),
    400,
    'Tipo no permitido',
  );
  expectStatus(
    await api('/api/coupons', adminCookie, {
      method: 'POST',
      body: JSON.stringify(couponPayload({ coupon: '' })),
    }),
    400,
    'Código vacío',
  );

  // Crear un cupón solo escribe el registro local: las tiendas se actualizan con Sincronizar.
  const createResponse = await api('/api/coupons', adminCookie, {
    method: 'POST',
    body: JSON.stringify(couponPayload({ coupon: couponCode.toUpperCase() })),
  });
  expectStatus(createResponse, 201, 'Creación de cupón');
  const created = (await createResponse.json()) as {
    id: number;
    coupon: string;
    amount: number;
    syncStatus: string;
    seratusCouponId: number | null;
    paliCouponId: number | null;
  };
  if (created.coupon !== couponCode || created.amount !== 20) {
    throw new Error('El cupón creado no fue normalizado o serializado correctamente.');
  }
  if (
    created.syncStatus !== 'PENDING' ||
    created.seratusCouponId !== null ||
    created.paliCouponId !== null
  ) {
    throw new Error('El cupón creado no quedó pendiente de sincronización.');
  }
  if (wooRequests.length > 0) {
    throw new Error('Crear un cupón no debe enviarlo a las tiendas.');
  }

  expectStatus(
    await api('/api/coupons', adminCookie, {
      method: 'POST',
      body: JSON.stringify(couponPayload({ description: 'Duplicado' })),
    }),
    409,
    'Código duplicado',
  );

  const listResponse = await api(
    `/api/coupons?search=${encodeURIComponent(runId)}&page=1&pageSize=1&sort=coupon&order=asc`,
    commercialCookie,
  );
  expectStatus(listResponse, 200, 'Búsqueda y paginación');
  const list = (await listResponse.json()) as {
    data: Array<{ id: number; usageCount: number }>;
    pagination: { total: number; pageSize: number };
  };
  if (
    list.pagination.total !== 1 ||
    list.pagination.pageSize !== 1 ||
    list.data[0]?.id !== created.id ||
    list.data[0].usageCount !== 0
  ) {
    throw new Error('El listado no respetó la búsqueda, el tamaño de página ni el orden.');
  }

  const updateResponse = await api(`/api/coupons/${created.id}`, adminCookie, {
    method: 'PATCH',
    body: JSON.stringify({ description: 'Cupón smoke editado', amount: 15, individualUse: true }),
  });
  expectStatus(updateResponse, 200, 'Edición de cupón');
  const updated = (await updateResponse.json()) as {
    description: string;
    amount: number;
    individualUse: boolean;
    syncStatus: string;
  };
  if (
    updated.description !== 'Cupón smoke editado' ||
    updated.amount !== 15 ||
    !updated.individualUse
  ) {
    throw new Error('La edición del cupón no persistió los valores esperados.');
  }
  if (updated.syncStatus !== 'PENDING') {
    throw new Error('Una edición local debe devolver el cupón a pendiente.');
  }

  // Primera sincronización: no hay identificadores, así que se crea el cupón en cada tienda.
  const syncResponse = await api(`/api/coupons/${created.id}/sync`, adminCookie, {
    method: 'POST',
  });
  expectStatus(syncResponse, 201, 'Sincronización de cupón');
  const synchronized = (await syncResponse.json()) as {
    syncStatus: string;
    seratusCouponId: number | null;
    paliCouponId: number | null;
    sync: Array<{ store: Store; action: string }>;
  };
  const syncActions = synchronized.sync.map((outcome) => `${outcome.store}:${outcome.action}`);
  if (
    synchronized.syncStatus !== 'SYNCED' ||
    syncActions.join() !== 'SERATUS:CREATED,PALI:CREATED'
  ) {
    throw new Error(
      `La primera sincronización debía crear el cupón en ambas tiendas: ${syncActions.join(', ')}`,
    );
  }
  if (synchronized.seratusCouponId === null || synchronized.paliCouponId === null) {
    throw new Error('La sincronización no guardó los identificadores de las dos tiendas.');
  }

  const createRequests = wooRequests.filter((request) => request.method === 'POST');
  if (
    createRequests.length !== 2 ||
    new Set(createRequests.map((request) => request.store)).size !== 2
  ) {
    throw new Error('La creación debía llegar a las dos tiendas una sola vez.');
  }
  const seratusCreate = createRequests.find((request) => request.store === 'SERATUS');
  if (
    seratusCreate?.body.code !== couponCode ||
    seratusCreate.body.discount_type !== 'percent' ||
    seratusCreate.body.amount !== '15.00' ||
    seratusCreate.body.individual_use !== true ||
    seratusCreate.body.exclude_sale_items !== false ||
    // Sin caducidad se envía cadena vacía y sin límite un 0: es lo que acepta WooCommerce.
    seratusCreate.body.date_expires !== '' ||
    seratusCreate.body.usage_limit !== 0 ||
    seratusCreate.body.usage_limit_per_user !== 0
  ) {
    throw new Error('El payload enviado a WooCommerce no respetó las reglas de la integración.');
  }

  // Con identificador ya guardado la sincronización actualiza en lugar de crear.
  wooRequests.length = 0;
  const resyncResponse = await api(`/api/coupons/${created.id}/sync`, adminCookie, {
    method: 'POST',
  });
  expectStatus(resyncResponse, 201, 'Resincronización de cupón');
  const resynced = (await resyncResponse.json()) as { sync: Array<{ action: string }> };
  if (resynced.sync.map((outcome) => outcome.action).join() !== 'UPDATED,UPDATED') {
    throw new Error('Una tienda con identificador debe actualizar el cupón en lugar de crearlo.');
  }
  if (wooRequests.some((request) => request.method !== 'PUT')) {
    throw new Error('La resincronización usó un método distinto de PUT.');
  }

  // Una tienda puede rechazar la actualización: el resumen queda parcial y el motivo se conserva
  // por tienda para que un administrador pueda revisarlo mucho después del intento.
  failStore(
    'PALI',
    Response.json(
      { code: 'woocommerce_rest_invalid_coupon', message: 'El cupón no es válido en Pali.' },
      { status: 400 },
    ),
  );
  const partialResponse = await api(`/api/coupons/${created.id}/sync`, adminCookie, {
    method: 'POST',
  });
  expectStatus(partialResponse, 201, 'Sincronización parcial');
  const partial = (await partialResponse.json()) as {
    syncStatus: string;
    sync: Array<{
      store: Store;
      action: string;
      errorCode: string | null;
      errorMessage: string | null;
    }>;
  };
  const paliOutcome = partial.sync.find((outcome) => outcome.store === 'PALI');
  if (partial.syncStatus !== 'PARTIAL') {
    throw new Error(
      `Una sola tienda con fallo debía dejar el cupón parcial: ${partial.syncStatus}`,
    );
  }
  if (
    paliOutcome?.action !== 'FAILED' ||
    paliOutcome.errorCode !== 'INTEGRATION_REQUEST_FAILED' ||
    !paliOutcome.errorMessage?.includes('El cupón no es válido en Pali.')
  ) {
    throw new Error('La sincronización no informó el motivo que devolvió la tienda.');
  }

  const stored = await prisma.coupon.findUnique({ where: { id: created.id } });
  if (
    stored?.syncStatus !== 'PARTIAL' ||
    stored.paliLastErrorCode !== 'INTEGRATION_REQUEST_FAILED' ||
    stored.paliLastErrorMessage?.includes('El cupón no es válido en Pali.') !== true ||
    stored.seratusLastErrorMessage !== null ||
    stored.lastSyncAt === null
  ) {
    throw new Error('El diagnóstico del intento no quedó guardado por tienda.');
  }

  // El detalle es técnico: solo lo recibe un administrador.
  type ListedCoupon = {
    paliLastErrorCode: string | null;
    paliLastErrorMessage: string | null;
  };
  const adminList = (await (
    await api(`/api/coupons?search=${encodeURIComponent(runId)}&page=1&pageSize=20`, adminCookie)
  ).json()) as { data: ListedCoupon[] };
  const commercialList = (await (
    await api(
      `/api/coupons?search=${encodeURIComponent(runId)}&page=1&pageSize=20`,
      commercialCookie,
    )
  ).json()) as { data: ListedCoupon[] };
  if (
    adminList.data[0]?.paliLastErrorMessage?.includes('El cupón no es válido en Pali.') !== true
  ) {
    throw new Error('El administrador no recibió el diagnóstico de la integración.');
  }
  if (
    commercialList.data[0]?.paliLastErrorMessage !== null ||
    commercialList.data[0]?.paliLastErrorCode !== null
  ) {
    throw new Error('El listado expuso el diagnóstico técnico a un comercial.');
  }

  // Editar invalida el intento anterior, así que su diagnóstico deja de aplicar.
  expectStatus(
    await api(`/api/coupons/${created.id}`, adminCookie, {
      method: 'PATCH',
      body: JSON.stringify({ description: 'Cupón smoke sin diagnóstico' }),
    }),
    200,
    'Edición posterior al fallo',
  );
  const cleared = await prisma.coupon.findUnique({ where: { id: created.id } });
  if (cleared?.syncStatus !== 'PENDING' || cleared.paliLastErrorMessage !== null) {
    throw new Error('La edición no limpió el estado ni el diagnóstico anterior.');
  }

  // Un fallo real conserva el cupón y explica la causa dentro de la respuesta de error.
  failStore(
    'SERATUS',
    Response.json(
      { code: 'woocommerce_rest_cannot_delete', message: 'Seratus no permite borrar este cupón.' },
      { status: 400 },
    ),
  );
  const deleteFailed = await api(`/api/coupons/${created.id}`, adminCookie, { method: 'DELETE' });
  expectStatus(deleteFailed, 409, 'Eliminación incompleta');
  const deleteFailedBody = (await deleteFailed.json()) as {
    error?: {
      code?: string;
      details?: Array<{ store: Store; action: string; errorMessage: string | null }>;
    };
  };
  const deleteFailure = deleteFailedBody.error?.details?.find(
    (outcome) => outcome.store === 'SERATUS',
  );
  if (deleteFailedBody.error?.code !== 'COUPON_DELETE_INCOMPLETE') {
    throw new Error('La eliminación incompleta no informó su código de error.');
  }
  if (
    deleteFailure?.action !== 'FAILED' ||
    !deleteFailure.errorMessage?.includes('no permite borrar')
  ) {
    throw new Error('La eliminación incompleta no explicó el motivo del fallo.');
  }
  if ((await prisma.coupon.findUnique({ where: { id: created.id } })) === null) {
    throw new Error('El cupón se borró aunque una tienda no pudo eliminarlo.');
  }

  // Si la tienda responde que el cupón ya no existe, la eliminación está hecha: contarlo como
  // fallo dejaría el cupón atascado en el CRM para siempre.
  failStore(
    'SERATUS',
    Response.json(
      { code: 'woocommerce_rest_coupon_invalid_id', message: 'Invalid ID.' },
      { status: 404 },
    ),
  );
  const deleteResponse = await api(`/api/coupons/${created.id}`, adminCookie, { method: 'DELETE' });
  expectStatus(deleteResponse, 200, 'Eliminación con la tienda sin el cupón');
  const deleted = (await deleteResponse.json()) as {
    deleted: boolean;
    sync: Array<{ store: Store; action: string }>;
  };
  const deleteActions = deleted.sync.map((outcome) => `${outcome.store}:${outcome.action}`);
  if (deleted.deleted !== true || deleteActions.join() !== 'SERATUS:MISSING,PALI:DELETED') {
    throw new Error(
      `La eliminación no resolvió cada tienda como se esperaba: ${deleteActions.join(', ')}`,
    );
  }
  if ((await prisma.coupon.findUnique({ where: { id: created.id } })) !== null) {
    throw new Error('El cupón continuó en la base de datos después de borrarlo.');
  }

  process.stdout.write(
    'Coupons smoke: auth, RBAC, validation, local creation, payload contract, sync, partial diagnostics, admin only detail and physical deletion checks passed.\n',
  );
} finally {
  await prisma.coupon.deleteMany({ where: { coupon: { startsWith: 'smoke-' } } });
  await prisma.user.deleteMany({ where: { id: { in: [adminId, commercialId] } } });
  globalThis.fetch = realFetch;
  await app.close();
}
