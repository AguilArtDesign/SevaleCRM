import '../apps/api/src/config/load-environment.js';
import { randomUUID } from 'node:crypto';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword } from 'better-auth/crypto';
import { AppModule } from '../apps/api/src/app.module.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { Role } from '../apps/api/src/generated/prisma/client.js';

process.env.BETTER_AUTH_SECRET ||= 'local-agreements-smoke-secret-at-least-32-chars';

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
const password = `A-${randomUUID()}-9a!`;

const adminId = randomUUID();
const commercialId = randomUUID();
const logisticsId = randomUUID();
const createdUserIds: string[] = [adminId, commercialId, logisticsId];

// El NIT es único, así que cada corrida usa uno derivado del runId.
const nitSeed = runId.replace(/\D/g, '').slice(0, 9).padEnd(9, '7');
const nit = `9${nitSeed}`;
const companyName = `Convenio Smoke ${runId.slice(0, 8)}`;

type AgreementBody = {
  id: number;
  companyName: string;
  nit: string | null;
  country: string;
  countryName: string | null;
  region: string | null;
  regionName: string | null;
  cityCode: string | null;
  cityName: string | null;
  validUntil: string | null;
  contactName: string | null;
  contactPosition: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  active: boolean;
  pendingTasks: number;
  completedTasks: number;
  cancelledTasks: number;
  commentsCount: number;
  createdBy: { id: string; name: string } | null;
};

type CommentBody = {
  id: number;
  comment: string;
  author: { id: string; name: string } | null;
};

type TaskBody = {
  id: number;
  title: string;
  status: 'PENDING' | 'COMPLETED' | 'CANCELLED';
  completedAt: string | null;
  assignedUser: { id: string; name: string } | null;
};

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

async function json<T>(response: Response, context: string, status = 200): Promise<T> {
  expectStatus(response, status, context);
  return (await response.json()) as T;
}

async function expectError(
  response: Response,
  status: number,
  code: string | null,
  context: string,
) {
  expectStatus(response, status, context);
  const body = (await response.json()) as { error?: { code?: string } };
  if (code !== null && body.error?.code !== code) {
    throw new Error(`${context}: se esperaba el código ${code} y llegó ${body.error?.code}.`);
  }
}

try {
  const passwordHash = await hashPassword(password);
  const users: Array<{ id: string; name: string; email: string; role: Role }> = [
    {
      id: adminId,
      name: 'Agreements Smoke Admin',
      email: `agreements-admin-${runId}@example.invalid`,
      role: Role.ADMIN,
    },
    {
      id: commercialId,
      name: 'Agreements Smoke Commercial',
      email: `agreements-commercial-${runId}@example.invalid`,
      role: Role.COMMERCIAL,
    },
    {
      id: logisticsId,
      name: 'Agreements Smoke Logistics',
      email: `agreements-logistics-${runId}@example.invalid`,
      role: Role.LOGISTICS,
    },
  ];
  for (const [index, user] of users.entries()) {
    await prisma.user.create({
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: true,
        role: user.role,
        active: true,
        sellerId: 20_000_000 + (Number.parseInt(nitSeed, 10) % 100_000) * 3 + index,
        accounts: {
          create: {
            id: randomUUID(),
            accountId: user.id,
            providerId: 'credential',
            issuer: 'local:credential',
            password: passwordHash,
          },
        },
      },
    });
  }

  // --- Autenticación y RBAC --------------------------------------------------------------
  expectStatus(await api('/api/agreements'), 401, 'Listado anónimo');
  const adminCookie = await login(users[0]!.email);
  const commercialCookie = await login(users[1]!.email);
  const logisticsCookie = await login(users[2]!.email);
  expectStatus(await api('/api/agreements', logisticsCookie), 403, 'Listado como logística');

  // --- Alta mínima: solo el nombre de la empresa -----------------------------------------
  const minimal = await json<AgreementBody>(
    await api('/api/agreements', commercialCookie, {
      method: 'POST',
      body: JSON.stringify({ companyName: `  ${companyName} mínima  ` }),
    }),
    'Alta mínima',
    201,
  );
  if (minimal.companyName !== `${companyName} mínima`) {
    throw new Error('El nombre de la empresa no se recortó.');
  }
  if (minimal.nit !== null || minimal.pendingTasks !== 0 || minimal.active !== true) {
    throw new Error('El alta mínima no dejó los valores por defecto esperados.');
  }
  if (minimal.country !== 'CO' || minimal.countryName !== 'Colombia') {
    throw new Error('Un alta sin país no quedó como convenio colombiano.');
  }
  if (minimal.createdBy?.id !== commercialId) {
    throw new Error('El convenio no registró al comercial como creador.');
  }

  // --- Alta completa ---------------------------------------------------------------------
  const full = await json<AgreementBody>(
    await api('/api/agreements', adminCookie, {
      method: 'POST',
      body: JSON.stringify({
        companyName,
        nit,
        region: 'CO-ANT',
        cityCode: '05001',
        postalCode: '050040',
        addressLine1: 'Carrera 43A #1-50',
        addressLine2: 'Torre Sur',
        contactName: 'Laura Gómez',
        contactPosition: 'Coordinadora de Bienestar',
        contactEmail: 'LAURA@Example.INVALID',
        contactPhone: '3001234567',
        validUntil: '2030-12-31',
        description: 'Convenio de prueba',
      }),
    }),
    'Alta completa',
    201,
  );
  if (full.regionName !== 'Antioquia' || full.cityName !== 'Medellín') {
    throw new Error('El listado no resolvió los nombres de la ubicación colombiana.');
  }
  // La vigencia se guarda como fecha sin hora: debe volver el mismo día que se envió.
  if (full.validUntil !== '2030-12-31') {
    throw new Error('La fecha de vigencia no se guardó como fecha sin hora.');
  }
  if (full.contactPhone !== '+573001234567' || full.contactEmail !== 'laura@example.invalid') {
    throw new Error('El teléfono o el correo del contacto no se normalizaron.');
  }
  if (full.createdBy?.id !== adminId) {
    throw new Error('El convenio no registró al administrador como creador.');
  }

  // --- Convenio internacional: región de catálogo y ciudad de texto libre ------------------
  const abroad = await json<AgreementBody>(
    await api('/api/agreements', adminCookie, {
      method: 'POST',
      body: JSON.stringify({
        companyName: `${companyName} MX`,
        country: 'MX',
        region: 'DF',
        cityName: 'Ciudad de México',
        contactPhone: '5512345678',
      }),
    }),
    'Alta internacional',
    201,
  );
  if (
    abroad.country !== 'MX' ||
    abroad.regionName !== 'Ciudad de México' ||
    abroad.cityName !== 'Ciudad de México'
  ) {
    throw new Error('El convenio internacional no resolvió su ubicación.');
  }
  if (abroad.cityCode !== null) {
    throw new Error('Un convenio internacional guardó un código de ciudad colombiano.');
  }
  if (abroad.contactPhone !== '+525512345678') {
    throw new Error('El teléfono internacional no se normalizó contra su país.');
  }

  // --- NIT único cuando existe ------------------------------------------------------------
  await expectError(
    await api('/api/agreements', adminCookie, {
      method: 'POST',
      body: JSON.stringify({ companyName: 'Duplicado', nit }),
    }),
    409,
    'AGREEMENT_NIT_TAKEN',
    'NIT duplicado',
  );
  const withoutNit: AgreementBody[] = [];
  for (const suffix of ['A', 'B']) {
    withoutNit.push(
      await json<AgreementBody>(
        await api('/api/agreements', adminCookie, {
          method: 'POST',
          body: JSON.stringify({ companyName: `${companyName} sin NIT ${suffix}` }),
        }),
        `Alta sin NIT ${suffix}`,
        201,
      ),
    );
  }
  if (withoutNit.some((agreement) => agreement.nit !== null)) {
    throw new Error('Un convenio sin NIT terminó con NIT.');
  }

  // --- Validaciones de ubicación y teléfono ------------------------------------------------
  await expectError(
    await api('/api/agreements', adminCookie, {
      method: 'POST',
      body: JSON.stringify({ companyName: 'Sin región', cityCode: '05001' }),
    }),
    400,
    'AGREEMENT_REGION_REQUIRED',
    'Ciudad sin departamento',
  );
  await expectError(
    await api('/api/agreements', adminCookie, {
      method: 'POST',
      body: JSON.stringify({ companyName: 'Región mala', region: 'CO-NO-EXISTE' }),
    }),
    400,
    'AGREEMENT_REGION_INVALID',
    'Departamento inexistente',
  );
  await expectError(
    await api('/api/agreements', adminCookie, {
      method: 'POST',
      body: JSON.stringify({ companyName: 'Ciudad mala', region: 'CO-ANT', cityCode: '11001' }),
    }),
    400,
    'AGREEMENT_CITY_INVALID',
    'Ciudad de otro departamento',
  );
  await expectError(
    await api('/api/agreements', adminCookie, {
      method: 'POST',
      body: JSON.stringify({ companyName: 'Teléfono malo', contactPhone: '123' }),
    }),
    400,
    'AGREEMENT_PHONE_INVALID',
    'Teléfono inválido',
  );
  await expectError(
    await api('/api/agreements', adminCookie, {
      method: 'POST',
      body: JSON.stringify({ companyName: 'País malo', country: 'ZZ' }),
    }),
    400,
    'AGREEMENT_COUNTRY_INVALID',
    'País fuera del catálogo',
  );
  await expectError(
    await api('/api/agreements', adminCookie, {
      method: 'POST',
      body: JSON.stringify({ companyName: 'Región de otro país', country: 'MX', region: 'CO-ANT' }),
    }),
    400,
    'AGREEMENT_REGION_INVALID',
    'Región que no pertenece al país',
  );
  await expectError(
    await api('/api/agreements', adminCookie, {
      method: 'POST',
      body: JSON.stringify({ companyName: 'Vigencia mala', validUntil: '31/12/2030' }),
    }),
    400,
    null,
    'Vigencia con formato inválido',
  );
  await expectError(
    await api(`/api/agreements/${full.id}`, adminCookie, {
      method: 'PATCH',
      body: JSON.stringify({ region: null }),
    }),
    400,
    'AGREEMENT_REGION_REQUIRED',
    'Borrar el departamento dejando la ciudad',
  );

  // --- Edición y activación ---------------------------------------------------------------
  const deactivated = await json<AgreementBody>(
    await api(`/api/agreements/${full.id}`, commercialCookie, {
      method: 'PATCH',
      body: JSON.stringify({ active: false, contactPosition: 'Directora' }),
    }),
    'Desactivar convenio',
  );
  if (deactivated.active !== false || deactivated.contactPosition !== 'Directora') {
    throw new Error('La edición no aplicó el estado ni el cargo.');
  }
  const reactivated = await json<AgreementBody>(
    await api(`/api/agreements/${full.id}`, commercialCookie, {
      method: 'PATCH',
      body: JSON.stringify({ active: true }),
    }),
    'Reactivar convenio',
  );
  if (!reactivated.active) throw new Error('El convenio no se reactivó.');

  // No existe DELETE: la ruta responde 404, no 405, porque el controlador no la declara.
  expectStatus(
    await api(`/api/agreements/${full.id}`, adminCookie, { method: 'DELETE' }),
    404,
    'DELETE inexistente',
  );

  // --- Listado, búsqueda, filtros y paginación --------------------------------------------
  const byCompany = await json<{ data: AgreementBody[]; pagination: { total: number } }>(
    await api(`/api/agreements?search=${encodeURIComponent(companyName)}`, adminCookie),
    'Búsqueda por empresa',
  );
  if (!byCompany.data.some((agreement) => agreement.id === full.id)) {
    throw new Error('La búsqueda por empresa no encontró el convenio.');
  }
  const byNit = await json<{ data: AgreementBody[] }>(
    await api(`/api/agreements?search=${nit}`, adminCookie),
    'Búsqueda por NIT',
  );
  if (byNit.data.length !== 1 || byNit.data[0]?.id !== full.id) {
    throw new Error('La búsqueda por NIT no devolvió solo el convenio esperado.');
  }
  const byContact = await json<{ data: AgreementBody[] }>(
    await api('/api/agreements?search=Laura', adminCookie),
    'Búsqueda por contacto',
  );
  if (!byContact.data.some((agreement) => agreement.id === full.id)) {
    throw new Error('La búsqueda por contacto no encontró el convenio.');
  }
  const inactiveFilter = await json<{ data: AgreementBody[] }>(
    await api('/api/agreements?active=inactive', adminCookie),
    'Filtro de inactivos',
  );
  if (inactiveFilter.data.some((agreement) => agreement.active)) {
    throw new Error('El filtro de inactivos devolvió convenios activos.');
  }
  const activeFilter = await json<{ data: AgreementBody[] }>(
    await api('/api/agreements?active=active&pageSize=1', adminCookie),
    'Filtro de activos',
  );
  if (activeFilter.data.length !== 1) {
    throw new Error('La paginación no respetó el tamaño de página.');
  }
  const byCity = await json<{ data: AgreementBody[] }>(
    await api('/api/agreements?region=CO-ANT&cityCode=05001', adminCookie),
    'Filtro por ubicación',
  );
  if (!byCity.data.some((agreement) => agreement.id === full.id)) {
    throw new Error('El filtro por ubicación no encontró el convenio.');
  }
  await expectError(
    await api('/api/agreements/999999999', adminCookie),
    404,
    'AGREEMENT_NOT_FOUND',
    'Convenio inexistente',
  );

  // --- Comentarios: se crean y se leen, no se editan ni se borran -------------------------
  const firstComment = await json<CommentBody>(
    await api(`/api/agreements/${full.id}/comments`, commercialCookie, {
      method: 'POST',
      body: JSON.stringify({ comment: '  Se realizó visita a la empresa.  ' }),
    }),
    'Comentario 1',
    201,
  );
  if (firstComment.comment !== 'Se realizó visita a la empresa.') {
    throw new Error('El comentario no se recortó.');
  }
  if (firstComment.author?.id !== commercialId) {
    throw new Error('El comentario no registró al autor.');
  }
  await json<CommentBody>(
    await api(`/api/agreements/${full.id}/comments`, adminCookie, {
      method: 'POST',
      body: JSON.stringify({ comment: 'Segundo comentario' }),
    }),
    'Comentario 2',
    201,
  );
  await expectError(
    await api(`/api/agreements/${full.id}/comments`, adminCookie, {
      method: 'POST',
      body: JSON.stringify({ comment: '   ' }),
    }),
    400,
    'VALIDATION_ERROR',
    'Comentario vacío',
  );
  const comments = await json<{ data: CommentBody[]; pagination: { total: number } }>(
    await api(`/api/agreements/${full.id}/comments`, adminCookie),
    'Listado de comentarios',
  );
  if (
    comments.pagination.total !== 2 ||
    comments.data[0]?.comment !== 'Se realizó visita a la empresa.'
  ) {
    throw new Error('El historial de comentarios no salió en orden cronológico.');
  }
  expectStatus(
    await api(`/api/agreements/${full.id}/comments/${firstComment.id}`, adminCookie, {
      method: 'PATCH',
      body: JSON.stringify({ comment: 'editado' }),
    }),
    404,
    'PATCH inexistente en comentarios',
  );
  expectStatus(
    await api(`/api/agreements/${full.id}/comments/${firstComment.id}`, adminCookie, {
      method: 'DELETE',
    }),
    404,
    'DELETE inexistente en comentarios',
  );

  // --- Tareas: crear, asignar, completar, cancelar y reabrir ------------------------------
  const task = await json<TaskBody>(
    await api(`/api/agreements/${full.id}/tasks`, commercialCookie, {
      method: 'POST',
      body: JSON.stringify({
        title: 'Llamar a Laura',
        description: 'Confirmar la visita',
        scheduledAt: new Date(Date.now() + 86_400_000).toISOString(),
        assignedUserId: adminId,
      }),
    }),
    'Tarea creada',
    201,
  );
  if (task.status !== 'PENDING' || task.assignedUser?.id !== adminId) {
    throw new Error('La tarea no nació pendiente y asignada.');
  }
  await expectError(
    await api(`/api/agreements/${full.id}/tasks`, commercialCookie, {
      method: 'POST',
      body: JSON.stringify({ title: 'Sin fecha' }),
    }),
    400,
    'VALIDATION_ERROR',
    'Tarea sin fecha',
  );
  await expectError(
    await api(`/api/agreements/${full.id}/tasks`, commercialCookie, {
      method: 'POST',
      body: JSON.stringify({
        title: 'Asignado inexistente',
        scheduledAt: new Date().toISOString(),
        assignedUserId: randomUUID(),
      }),
    }),
    400,
    'AGREEMENT_TASK_ASSIGNEE_NOT_FOUND',
    'Tarea asignada a un usuario inexistente',
  );

  const completed = await json<TaskBody>(
    await api(`/api/agreements/${full.id}/tasks/${task.id}/complete`, commercialCookie, {
      method: 'POST',
    }),
    'Completar tarea',
  );
  if (completed.status !== 'COMPLETED' || !completed.completedAt) {
    throw new Error('Completar no fijó el estado y la fecha.');
  }
  const cancelled = await json<TaskBody>(
    await api(`/api/agreements/${full.id}/tasks/${task.id}/cancel`, commercialCookie, {
      method: 'POST',
    }),
    'Cancelar tarea',
  );
  if (cancelled.status !== 'CANCELLED' || cancelled.completedAt !== null) {
    throw new Error('Cancelar no cambió el estado o no limpió la fecha de completado.');
  }
  const reopened = await json<TaskBody>(
    await api(`/api/agreements/${full.id}/tasks/${task.id}/reopen`, commercialCookie, {
      method: 'POST',
    }),
    'Reabrir tarea',
  );
  if (reopened.status !== 'PENDING') throw new Error('Reabrir no volvió a pendiente.');

  const editedTask = await json<TaskBody>(
    await api(`/api/agreements/${full.id}/tasks/${task.id}`, commercialCookie, {
      method: 'PATCH',
      body: JSON.stringify({ title: 'Llamar a Laura (reprogramada)', assignedUserId: null }),
    }),
    'Editar tarea pendiente',
  );
  if (editedTask.title !== 'Llamar a Laura (reprogramada)' || editedTask.assignedUser !== null) {
    throw new Error('La edición de la tarea no aplicó los cambios.');
  }
  const pendingFilter = await json<{ data: TaskBody[] }>(
    await api(`/api/agreements/${full.id}/tasks?status=PENDING`, adminCookie),
    'Filtro de tareas pendientes',
  );
  if (!pendingFilter.data.some((item) => item.id === task.id)) {
    throw new Error('El filtro de pendientes no devolvió la tarea.');
  }
  const cancelledFilter = await json<{ data: TaskBody[] }>(
    await api(`/api/agreements/${full.id}/tasks?status=CANCELLED`, adminCookie),
    'Filtro de tareas canceladas',
  );
  if (cancelledFilter.data.length !== 0) {
    throw new Error('El filtro de canceladas devolvió una tarea reabierta.');
  }
  await expectError(
    await api(`/api/agreements/999999999/tasks/${task.id}/complete`, adminCookie, {
      method: 'POST',
    }),
    404,
    'AGREEMENT_NOT_FOUND',
    'Completar tarea de un convenio inexistente',
  );

  // --- Contadores calculados en la ficha ---------------------------------------------------
  const detail = await json<AgreementBody>(
    await api(`/api/agreements/${full.id}`, adminCookie),
    'Detalle con contadores',
  );
  if (detail.pendingTasks !== 1 || detail.commentsCount !== 2) {
    throw new Error(
      `Los contadores de la ficha no cuadran: pendientes=${detail.pendingTasks}, comentarios=${detail.commentsCount}.`,
    );
  }

  // Los tres estados se cuentan por separado: el listado muestra pendientes, completadas y
  // canceladas, así que un contador que solo sume pendientes dejaría dos columnas siempre en cero.
  const withCounters = await json<{
    data: { id: number; pendingTasks: number; completedTasks: number; cancelledTasks: number }[];
  }>(await api('/api/agreements?pageSize=100', adminCookie), 'Listado con contadores');
  const fullRow = withCounters.data.find((row) => row.id === full.id);
  if (!fullRow) throw new Error('El convenio no aparece en el listado con contadores.');
  const taskStatuses = await prisma.agreementTask.groupBy({
    by: ['status'],
    where: { agreementId: full.id },
    _count: { _all: true },
  });
  const expected = { PENDING: 0, COMPLETED: 0, CANCELLED: 0 };
  for (const group of taskStatuses) expected[group.status] = group._count._all;
  if (
    fullRow.pendingTasks !== expected.PENDING ||
    fullRow.completedTasks !== expected.COMPLETED ||
    fullRow.cancelledTasks !== expected.CANCELLED
  ) {
    throw new Error(
      `El listado no cuenta los tres estados: pendientes=${fullRow.pendingTasks}/${expected.PENDING}, ` +
        `completadas=${fullRow.completedTasks}/${expected.COMPLETED}, canceladas=${fullRow.cancelledTasks}/${expected.CANCELLED}.`,
    );
  }
  // Un convenio sin tareas debe devolver ceros, no `undefined`, para que la tabla no muestre huecos.
  const bare = await json<AgreementBody>(
    await api(`/api/agreements/${minimal.id}`, adminCookie),
    'Detalle sin tareas',
  );
  if (bare.completedTasks !== 0 || bare.cancelledTasks !== 0) {
    throw new Error('Un convenio sin tareas debe contar cero completadas y cero canceladas.');
  }

  // --- Borrado de usuario: el historial sobrevive y el autor queda vacío -------------------
  await prisma.user.delete({ where: { id: commercialId } });
  createdUserIds.splice(createdUserIds.indexOf(commercialId), 1);
  const afterDelete = await json<{ data: CommentBody[] }>(
    await api(`/api/agreements/${full.id}/comments`, adminCookie),
    'Comentarios tras borrar al autor',
  );
  if (afterDelete.data[0]?.author !== null) {
    throw new Error('El comentario no sobrevivió al borrado de su autor.');
  }
  const agreementAfterDelete = await json<AgreementBody>(
    await api(`/api/agreements/${minimal.id}`, adminCookie),
    'Convenio tras borrar al creador',
  );
  if (agreementAfterDelete.createdBy !== null) {
    throw new Error('El convenio no sobrevivió al borrado de su creador.');
  }

  process.stdout.write(
    'Agreements smoke: auth, RBAC, minimal and full create, unique NIT, location and phone validation, edit, activate/deactivate, no delete routes, search, filters, pagination, comments (immutable, chronological), tasks (assign, complete, cancel, reopen, edit), computed counters and author survival after user deletion passed.\n',
  );
} finally {
  // La limpieza es directa en base porque el módulo no expone borrado de convenios.
  await prisma.agreement.deleteMany({ where: { companyName: { contains: companyName } } });
  await prisma.user.deleteMany({ where: { id: { in: createdUserIds } } });
  await app.close();
}
