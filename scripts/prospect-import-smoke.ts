import { randomUUID } from 'node:crypto';
import '../apps/api/src/config/load-environment.js';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import { hashPassword } from 'better-auth/crypto';
import { AppModule } from '../apps/api/src/app.module.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import { Role } from '../apps/api/src/generated/prisma/client.js';

process.env.BETTER_AUTH_SECRET ||= 'local-prospect-import-smoke-secret-at-least-32-chars';
process.env.PROSPECT_IMPORT_ENABLED = 'true';

const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
  logger: false,
  abortOnError: false,
});
app.setGlobalPrefix('api');
await app.listen(0, '127.0.0.1');

const prisma = app.get(PrismaService);
const baseUrl = await app.getUrl();
const origin = process.env.FRONTEND_URL || 'http://localhost:5173';
const runId = randomUUID();
const userIds = [randomUUID(), randomUUID(), randomUUID()] as const;
const emails = [
  `prospect-import-admin-${runId}@example.invalid`,
  `prospect-import-logistics-${runId}@example.invalid`,
  `prospect-import-commercial-${runId}@example.invalid`,
] as const;
const password = `P-${randomUUID()}-9a!`;
const existingDocument = `9${runId.replace(/\D/g, '').slice(0, 9)}`;
const newDocument = `8${runId.replace(/\D/g, '').slice(0, 9)}`;
// Documentos únicos para las pruebas de traducción de tipo de documento.
const aliasDocuments = ['1010', '2020', '3030', '4040', '5050'].map(
  (prefix, index) => `${prefix}${runId.replace(/\D/g, '').slice(index, index + 5)}`,
);
const prospectIds: number[] = [];
const agreementIds: number[] = [];

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

async function login(email: string) {
  const response = await fetch(`${baseUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      origin,
      'x-captcha-response': 'XXXX.DUMMY.TOKEN.XXXX',
    },
    body: JSON.stringify({ email, password }),
  });
  if (response.status !== 200) {
    throw new Error(
      `Inicio de sesión de ${email}: se esperaba 200 y se recibió ${response.status}.`,
    );
  }
  const cookie = response.headers.getSetCookie()[0]?.split(';')[0];
  if (!cookie) throw new Error('Better Auth no creó la cookie de sesión.');
  return cookie;
}

function api(path: string, method: 'GET' | 'POST', cookie?: string, body?: unknown) {
  return fetch(`${baseUrl}${path}`, {
    method,
    headers: {
      origin,
      ...(cookie ? { cookie } : {}),
      ...(body ? { 'content-type': 'application/json' } : {}),
    },
    ...(body ? { body: JSON.stringify(body) } : {}),
  });
}

function expectStatus(response: Response, status: number, context: string) {
  if (response.status !== status) {
    throw new Error(`${context}: se esperaba ${status} y se recibió ${response.status}.`);
  }
}

async function errorCode(response: Response) {
  const body = (await response.json()) as { error?: { code?: string } };
  return body.error?.code ?? null;
}

try {
  const passwordHash = await hashPassword(password);
  for (const user of [
    { id: userIds[0], email: emails[0], role: Role.ADMIN, name: 'Import Prospect Admin' },
    {
      id: userIds[1],
      email: emails[1],
      role: Role.LOGISTICS,
      name: 'Import Prospect Logistics',
    },
    {
      id: userIds[2],
      email: emails[2],
      role: Role.COMMERCIAL,
      name: 'Import Prospect Commercial',
    },
  ] as const) {
    await prisma.user.create({
      data: {
        id: user.id,
        name: user.name,
        email: user.email,
        emailVerified: true,
        role: user.role,
        active: true,
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

  // Un prospecto previo con el mismo documento: la vista previa debe detectarlo como duplicado.
  const existing = await prisma.prospect.create({
    data: {
      displayName: 'Prospecto existente',
      firstName: 'Prospecto',
      lastName: 'Existente',
      documentType: '13',
      documentNumber: existingDocument,
    },
  });
  prospectIds.push(existing.id);

  expectStatus(await api('/api/prospects/import/status', 'GET'), 401, 'Estado anónimo');
  const adminCookie = await login(emails[0]);
  const logisticsCookie = await login(emails[1]);
  const commercialCookie = await login(emails[2]);
  expectStatus(
    await api('/api/prospects/import/status', 'GET', logisticsCookie),
    403,
    'Estado logística',
  );
  // La importación es exclusiva del administrador: el comercial puede leer prospectos, pero
  // no cargarlos en lote.
  expectStatus(
    await api('/api/prospects/import/status', 'GET', commercialCookie),
    403,
    'Estado comercial',
  );
  expectStatus(
    await api('/api/prospects/import/preview', 'POST', commercialCookie, { csv: 'nombre\nAna' }),
    403,
    'Vista previa comercial',
  );
  expectStatus(
    await api('/api/prospects/import', 'POST', commercialCookie, { csv: 'nombre\nAna' }),
    403,
    'Importación comercial',
  );

  const statusResponse = await api('/api/prospects/import/status', 'GET', adminCookie);
  expectStatus(statusResponse, 200, 'Estado administrador');
  const status = (await statusResponse.json()) as { enabled: boolean; template: string };
  assert(status.enabled, 'La API no informó que la importación está habilitada.');
  assert(status.template.includes('nombre'), 'La plantilla no describe las columnas.');

  // Encabezados en otro orden, con acentos y con un alias de columna (`celular`): todo debe
  // reconocerse. El tipo de documento va con el nombre del selector, no con una abreviatura.
  const csv = [
    'Correo,Documento,Celular,Nombre,Apellido,Empresa,Tipo de documento',
    `nueva-${runId}@example.invalid,${newDocument},+57 300 123 4567,Ana,Pérez,Comercializadora ABC SAS,Cédula de ciudadanía`,
    `existente-${runId}@example.invalid,${existingDocument},,Prospecto,Duplicado,,NIT`,
  ].join('\r\n');

  const previewResponse = await api('/api/prospects/import/preview', 'POST', adminCookie, { csv });
  expectStatus(previewResponse, 201, 'Vista previa');
  const preview = (await previewResponse.json()) as {
    totalRows: number;
    validRows: number;
    newProspects: number;
    duplicates: number;
    errorCount: number;
    canImport: boolean;
  };
  assert(preview.totalRows === 2, 'La vista previa no contó las filas de datos.');
  assert(preview.validRows === 2, 'La vista previa rechazó filas válidas.');
  assert(preview.duplicates === 1, 'La vista previa no detectó el documento ya existente.');
  assert(preview.newProspects === 1, 'La vista previa no contó la fila nueva.');
  assert(
    preview.errorCount === 0 && preview.canImport,
    'La vista previa bloqueó un archivo válido.',
  );

  // Dos filas con datos inválidos: un correo mal escrito y un teléfono que no es un número.
  const invalidCsv = [
    'nombre,apellido,correo,telefono',
    `Incompleto,${runId},no-es-un-correo,`,
    'Otra,Fila,valida@example.invalid,abc',
  ].join('\n');
  const invalidResponse = await api('/api/prospects/import/preview', 'POST', adminCookie, {
    csv: invalidCsv,
  });
  expectStatus(invalidResponse, 201, 'Vista previa inválida');
  const invalid = (await invalidResponse.json()) as {
    errorCount: number;
    canImport: boolean;
    errors: { row: number }[];
  };
  assert(invalid.errorCount === 2, 'La vista previa no marcó las filas inválidas.');
  assert(!invalid.canImport, 'La vista previa permitió importar un archivo con errores.');
  assert(invalid.errors[0]?.row === 2, 'El error no apunta a la fila del archivo.');

  expectStatus(
    await api('/api/prospects/import', 'POST', adminCookie, { csv: invalidCsv }),
    422,
    'Importación con errores',
  );

  expectStatus(
    await api('/api/prospects/import/preview', 'POST', adminCookie, { csv: 'solo,columnas\n1,2' }),
    400,
    'Encabezados desconocidos',
  );
  assert(
    (await errorCode(
      await api('/api/prospects/import/preview', 'POST', adminCookie, {
        csv: 'nombre\n"sin cerrar',
      }),
    )) === 'INVALID_CSV',
    'Un CSV mal formado no devolvió INVALID_CSV.',
  );

  const importResponse = await api('/api/prospects/import', 'POST', adminCookie, { csv });
  expectStatus(importResponse, 201, 'Importación');
  const imported = (await importResponse.json()) as {
    imported: number;
    duplicates: number;
    totalRows: number;
  };
  assert(imported.imported === 1, 'La importación no insertó la fila nueva.');
  assert(imported.duplicates === 1, 'La importación no omitió la fila duplicada.');

  const stored = await prisma.prospect.findFirst({
    where: { documentNumber: newDocument },
  });
  assert(stored, 'El prospecto importado no se guardó.');
  prospectIds.push(stored.id);
  assert(
    stored.displayName === 'Ana Pérez',
    `El nombre visible no se derivó del archivo: ${stored.displayName}.`,
  );
  assert(
    stored.phone === '+573001234567',
    `El teléfono no se normalizó a formato internacional: ${stored.phone}.`,
  );
  assert(stored.email === `nueva-${runId}@example.invalid`, 'El correo no se conservó.');
  assert(stored.company === 'Comercializadora ABC SAS', 'La empresa no se conservó.');
  assert(stored.personType === 'PERSON', 'El prospecto importado no nació como persona.');
  assert(
    stored.documentType === '13',
    `«Cédula de ciudadanía» no se tradujo al código 13: ${stored.documentType}.`,
  );

  // Las etiquetas del selector deben llegar al código, sin importar acentos ni mayúsculas; un valor
  // que no está en el catálogo se avisa en la columna.
  const labelsResponse = await api('/api/prospects/import/preview', 'POST', adminCookie, {
    csv: [
      'nombre,documento,tipo_documento',
      `Etiqueta Uno,${aliasDocuments[0]},Cédula de ciudadanía`,
      `Etiqueta Dos,${aliasDocuments[1]},nit`,
      `Etiqueta Tres,${aliasDocuments[2]},Pasaporte`,
      `Etiqueta Cuatro,${aliasDocuments[3]},13`,
    ].join('\n'),
  });
  expectStatus(labelsResponse, 201, 'Vista previa con etiquetas del selector');
  const labelsPreview = (await labelsResponse.json()) as {
    errorCount: number;
    canImport: boolean;
  };
  assert(
    labelsPreview.errorCount === 0 && labelsPreview.canImport,
    'La vista previa rechazó etiquetas válidas del selector de tipo de documento.',
  );

  const badDocResponse = await api('/api/prospects/import/preview', 'POST', adminCookie, {
    csv: ['nombre,documento,tipo_documento', `Malo,${aliasDocuments[4]},CC`].join('\n'),
  });
  expectStatus(badDocResponse, 201, 'Vista previa con tipo fuera del catálogo');
  const badDoc = (await badDocResponse.json()) as {
    errorCount: number;
    errors: { field: string; message: string }[];
  };
  assert(badDoc.errorCount === 1, 'Un tipo fuera del catálogo no fue rechazado.');
  assert(
    badDoc.errors[0]?.field === 'tipo_documento',
    'El error no apunta a la columna tipo_documento.',
  );

  // La columna `convenio` se resuelve por nombre contra el catálogo, sin importar mayúsculas ni
  // tildes: es lo que permite subir una base entera de un convenio sin tocar cada fila.
  const agreementName = `Convenio Smöke ${runId.slice(0, 8)}`;
  const agreement = await prisma.agreement.create({
    data: { companyName: agreementName, nit: `NIT-${runId.slice(0, 12)}`, active: true },
  });
  agreementIds.push(agreement.id);

  const agreementCsv = [
    'nombre,documento,tipo_documento,pais,convenio',
    `Con Convenio,${aliasDocuments[0]},Cédula de ciudadanía,colombia,${agreementName.toUpperCase()}`,
    `Sin Convenio,${aliasDocuments[1]},Cédula de ciudadanía,,`,
    `Con Pais,${aliasDocuments[4]},Cédula de ciudadanía,COLOMBIA,`,
  ].join('\n');
  const agreementPreviewResponse = await api('/api/prospects/import/preview', 'POST', adminCookie, {
    csv: agreementCsv,
  });
  expectStatus(agreementPreviewResponse, 201, 'Vista previa con convenio');
  const agreementPreview = (await agreementPreviewResponse.json()) as {
    errorCount: number;
    canImport: boolean;
    newProspects: number;
  };
  assert(
    agreementPreview.errorCount === 0 && agreementPreview.newProspects === 3,
    'La vista previa no aceptó el convenio en mayúsculas ni el país en minúsculas.',
  );

  expectStatus(
    await api('/api/prospects/import', 'POST', adminCookie, { csv: agreementCsv }),
    201,
    'Importación con convenio',
  );
  const withAgreement = await prisma.prospect.findFirst({
    where: { documentNumber: aliasDocuments[0] },
    select: { agreementId: true, country: true },
  });
  assert(
    withAgreement?.agreementId === agreement.id,
    'El prospecto no quedó ligado al convenio del archivo.',
  );
  // El país se guarda como código del catálogo (`CO`), no como el texto que trae el archivo.
  assert(
    withAgreement?.country === 'CO',
    `«colombia» no se tradujo al código de país: ${withAgreement?.country}.`,
  );
  assert(
    (await prisma.prospect.findFirst({ where: { documentNumber: aliasDocuments[1] } }))
      ?.agreementId === null,
    'Una celda de convenio vacía no debe inventar un convenio.',
  );

  // Un país fuera del catálogo invalida el archivo, igual que un convenio inexistente.
  const unknownCountryResponse = await api('/api/prospects/import/preview', 'POST', adminCookie, {
    csv: [
      'nombre,documento,tipo_documento,pais',
      `Pais Fantasma,${aliasDocuments[2]},Cédula de ciudadanía,ATLANTIDA`,
    ].join('\n'),
  });
  expectStatus(unknownCountryResponse, 201, 'Vista previa con país inexistente');
  const unknownCountry = (await unknownCountryResponse.json()) as {
    errorCount: number;
    canImport: boolean;
    errors: { field: string; message: string }[];
  };
  assert(unknownCountry.errorCount === 1, 'Un país fuera del catálogo no fue rechazado.');
  assert(!unknownCountry.canImport, 'La vista previa permitió importar un país inexistente.');
  assert(unknownCountry.errors[0]?.field === 'pais', 'El error no apunta a la columna pais.');

  // Un convenio que no existe invalida el archivo: se informa una sola vez aunque afecte a todas las
  // filas, para no repetir el mismo mensaje y ocultar el resto de problemas.
  const unknownAgreementCsv = [
    'nombre,documento,tipo_documento,convenio',
    `Fantasma Uno,${aliasDocuments[2]},Cédula de ciudadanía,FLAMINGO INEXISTENTE`,
    `Fantasma Dos,${aliasDocuments[3]},NIT,FLAMINGO INEXISTENTE`,
  ].join('\n');
  const unknownResponse = await api('/api/prospects/import/preview', 'POST', adminCookie, {
    csv: unknownAgreementCsv,
  });
  expectStatus(unknownResponse, 201, 'Vista previa con convenio inexistente');
  const unknown = (await unknownResponse.json()) as {
    errorCount: number;
    canImport: boolean;
    errors: { row: number; field: string; message: string }[];
  };
  assert(
    unknown.errorCount === 2,
    'Las dos filas con convenio inexistente deben contar como error.',
  );
  assert(!unknown.canImport, 'La vista previa permitió importar un convenio inexistente.');
  assert(
    unknown.errors.filter((issue) => issue.field === 'convenio').length === 1,
    'El convenio inexistente se repitió en lugar de informarse una sola vez.',
  );
  expectStatus(
    await api('/api/prospects/import', 'POST', adminCookie, { csv: unknownAgreementCsv }),
    422,
    'Importación con convenio inexistente',
  );
  assert(
    (await prisma.prospect.count({
      where: { documentNumber: { in: [aliasDocuments[2]!, aliasDocuments[3]!] } },
    })) === 0,
    'Un convenio inexistente no debe insertar ninguna fila.',
  );

  // Volver a subir el mismo archivo no debe duplicar nada: todas las filas son duplicados. Un lote
  // sin filas nuevas no es un error, porque un archivo grande se envía por lotes y alguno puede
  // quedarse sin novedades.
  const repeatedResponse = await api('/api/prospects/import', 'POST', adminCookie, { csv });
  expectStatus(repeatedResponse, 201, 'Importación repetida');
  const repeated = (await repeatedResponse.json()) as { imported: number };
  assert(repeated.imported === 0, 'La segunda importación duplicó prospectos.');
  assert(
    (await prisma.prospect.count({ where: { documentNumber: newDocument } })) === 1,
    'La segunda importación creó una fila extra.',
  );

  process.env.PROSPECT_IMPORT_ENABLED = 'false';
  expectStatus(
    await api('/api/prospects/import/preview', 'POST', adminCookie, { csv }),
    404,
    'Importación deshabilitada',
  );
  process.env.PROSPECT_IMPORT_ENABLED = 'true';

  process.stdout.write(
    'Prospect import smoke: feature flag, auth, RBAC, header aliases, preview, duplicates, row errors, document type mapping, agreement by name, normalization, idempotency and disabled state checks passed.\n',
  );
} finally {
  process.env.PROSPECT_IMPORT_ENABLED = 'true';
  // Se limpia por documento además de por id: varias pruebas crean filas cuyo id no se recolecta.
  const testDocuments = [existingDocument, newDocument, ...aliasDocuments];
  await prisma.prospect.deleteMany({ where: { documentNumber: { in: testDocuments } } });
  if (prospectIds.length > 0) {
    await prisma.prospect.deleteMany({ where: { id: { in: prospectIds } } });
  }
  if (agreementIds.length > 0) {
    await prisma.agreement.deleteMany({ where: { id: { in: agreementIds } } });
  }
  await prisma.user.deleteMany({ where: { id: { in: [...userIds] } } });
  await app.close();
}
