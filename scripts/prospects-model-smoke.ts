import '../apps/api/src/config/load-environment.js';
import { PrismaService } from '../apps/api/src/database/prisma.service.js';
import {
  CustomerPersonType,
  ProspectSource,
  ProspectStatus,
} from '../apps/api/src/generated/prisma/client.js';
import type { Agreement, Customer, User } from '../apps/api/src/generated/prisma/client.js';

const prisma = new PrismaService();
await prisma.$connect();

const suffix = Date.now();
const created: {
  prospects: number[];
  tags: number[];
  users: string[];
  agreements: number[];
  customers: number[];
} = { prospects: [], tags: [], users: [], agreements: [], customers: [] };

async function createUser(label: string): Promise<User> {
  const user = await prisma.user.create({
    data: {
      name: `Smoke ${label}`,
      email: `smoke-prospect-${label}-${suffix}@example.invalid`,
      role: 'COMMERCIAL',
    },
  });
  created.users.push(user.id);
  return user;
}

async function createAgreement(): Promise<Agreement> {
  const agreement = await prisma.agreement.create({
    data: { companyName: `Convenio smoke ${suffix}` },
  });
  created.agreements.push(agreement.id);
  return agreement;
}

async function createCustomer(documentNumber: string): Promise<Customer> {
  const customer = await prisma.customer.create({
    data: {
      personType: CustomerPersonType.PERSON,
      displayName: 'Cliente smoke prospecto',
      documentType: '13',
      documentNumber,
      fiscalResponsibilities: ['R-99-PN'],
    },
  });
  created.customers.push(customer.id);
  return customer;
}

async function createProspect(data: Parameters<typeof prisma.prospect.create>[0]['data']) {
  const prospect = await prisma.prospect.create({ data });
  created.prospects.push(prospect.id);
  return prospect;
}

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

try {
  const assignee = await createUser('assignee');
  const author = await createUser('author');
  const agreement = await createAgreement();

  const minimal = await createProspect({
    displayName: '+573001112233',
    phone: '+573001112233',
    source: ProspectSource.MANUAL,
  });
  assert(minimal.status === ProspectStatus.NEW, 'El estado inicial del prospecto no es NEW.');
  assert(minimal.source === ProspectSource.MANUAL, 'El origen por defecto no es MANUAL.');
  assert(
    minimal.assignedUserId === null && minimal.agreementId === null,
    'Un prospecto debe poder existir sin comercial y sin convenio.',
  );
  assert(minimal.personType === null, 'personType debe poder desconocerse.');

  const complete = await createProspect({
    personType: CustomerPersonType.COMPANY,
    firstName: 'Ana',
    lastName: 'Pérez',
    displayName: 'Ana Pérez',
    company: 'Comercializadora Smoke SAS',
    documentType: '31',
    documentNumber: `9${suffix}`.slice(0, 20),
    checkDigit: '7',
    email: `prospect-${suffix}@example.invalid`,
    phone: '+573004445566',
    country: 'CO',
    region: 'CO-ANT',
    cityCode: '05001',
    agreementId: agreement.id,
    assignedUserId: assignee.id,
    createdByUserId: author.id,
    status: ProspectStatus.QUALIFIED,
  });
  assert(complete.cityName === null, 'Colombia debe guardar city_code, no city_name.');

  const international = await prisma.prospect.update({
    where: { id: complete.id },
    data: { country: 'PA', region: 'PA-8', cityCode: null, cityName: 'Ciudad de Panamá' },
  });
  assert(
    international.cityName === 'Ciudad de Panamá' && international.cityCode === null,
    'El prospecto internacional no conservó la ciudad libre esperada.',
  );

  const tag = await prisma.tag.create({ data: { name: `MAYORISTA-${suffix}` } });
  created.tags.push(tag.id);
  const secondTag = await prisma.tag.create({ data: { name: `VIP-${suffix}` } });
  created.tags.push(secondTag.id);

  let duplicateTagRejected = false;
  try {
    await prisma.tag.create({ data: { name: `mayorista-${suffix}` } });
  } catch (error) {
    duplicateTagRejected =
      typeof error === 'object' && error !== null && (error as { code?: string }).code === 'P2002';
  }
  assert(duplicateTagRejected, 'tags.name permitió duplicados que solo difieren en mayúsculas.');

  await prisma.prospectTag.createMany({
    data: [
      { prospectId: complete.id, tagId: tag.id },
      { prospectId: complete.id, tagId: secondTag.id },
    ],
  });
  const tagged = await prisma.prospect.findUniqueOrThrow({
    where: { id: complete.id },
    include: { tags: true },
  });
  assert(tagged.tags.length === 2, 'El prospecto no conservó sus dos etiquetas.');

  // Borrar el usuario asignado y el creador no debe borrar ni bloquear el prospecto.
  await prisma.user.delete({ where: { id: assignee.id } });
  await prisma.user.delete({ where: { id: author.id } });
  created.users = created.users.filter((id) => id !== assignee.id && id !== author.id);
  const afterUserDelete = await prisma.prospect.findUniqueOrThrow({
    where: { id: complete.id },
  });
  assert(
    afterUserDelete.assignedUserId === null && afterUserDelete.createdByUserId === null,
    'Las FK a usuarios no aplicaron SetNull al borrar un usuario.',
  );

  // Borrar el convenio conserva el prospecto y anula el vínculo.
  await prisma.agreement.delete({ where: { id: agreement.id } });
  created.agreements = created.agreements.filter((id) => id !== agreement.id);
  const afterAgreementDelete = await prisma.prospect.findUniqueOrThrow({
    where: { id: complete.id },
  });
  assert(
    afterAgreementDelete.agreementId === null,
    'La FK de convenio no aplicó SetNull al borrar un convenio.',
  );

  // Convertir: el cliente se puede borrar sin arrastrar ni bloquear el prospecto histórico.
  const customer = await createCustomer(`PROSPECT-${suffix}`.slice(0, 20));
  const converted = await prisma.prospect.update({
    where: { id: complete.id },
    data: {
      status: ProspectStatus.CONVERTED,
      convertedCustomerId: customer.id,
      convertedAt: new Date(),
    },
  });
  assert(converted.status === ProspectStatus.CONVERTED, 'El prospecto no quedó en CONVERTED.');

  await prisma.customer.delete({ where: { id: customer.id } });
  created.customers = created.customers.filter((id) => id !== customer.id);
  const afterCustomerDelete = await prisma.prospect.findUniqueOrThrow({
    where: { id: complete.id },
  });
  assert(
    afterCustomerDelete.convertedCustomerId === null &&
      afterCustomerDelete.status === ProspectStatus.CONVERTED,
    'Borrar el cliente debe anular converted_customer_id sin revertir el estado CONVERTED.',
  );

  // Borrar el prospecto limpia la tabla puente y no toca las etiquetas.
  await prisma.prospect.delete({ where: { id: complete.id } });
  created.prospects = created.prospects.filter((id) => id !== complete.id);
  const links = await prisma.prospectTag.count({ where: { prospectId: complete.id } });
  assert(links === 0, 'prospect_tags no se borró en cascada con el prospecto.');
  const survivingTags = await prisma.tag.count({
    where: { id: { in: [tag.id, secondTag.id] } },
  });
  assert(survivingTags === 2, 'Borrar un prospecto no debe borrar sus etiquetas.');

  // La tabla no debe tener soft delete: el borrado es físico.
  const columns = await prisma.$queryRaw<{ column_name: string }[]>`
    SELECT COLUMN_NAME AS column_name
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prospects'
  `;
  const columnNames = columns.map((column) => column.column_name);
  assert(
    !columnNames.includes('deleted_at'),
    'prospects no debe tener deleted_at (sin soft delete).',
  );
  assert(
    columnNames.includes('converted_customer_id') && columnNames.includes('assigned_user_id'),
    'Faltan columnas clave en prospects.',
  );

  const userColumn = await prisma.$queryRaw<{ COLUMN_TYPE: string }[]>`
    SELECT COLUMN_TYPE
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = DATABASE() AND TABLE_NAME = 'prospects'
      AND COLUMN_NAME = 'assigned_user_id'
  `;
  assert(
    userColumn[0]?.COLUMN_TYPE === 'varchar(36)',
    'assigned_user_id debe ser varchar(36) para coincidir con users.id.',
  );

  process.stdout.write(
    'Prospects model smoke: minimal/complete prospect, tags, SetNull FKs, cascade and no-soft-delete checks passed.\n',
  );
} finally {
  if (created.prospects.length) {
    await prisma.prospect.deleteMany({ where: { id: { in: created.prospects } } });
  }
  if (created.tags.length) await prisma.tag.deleteMany({ where: { id: { in: created.tags } } });
  if (created.customers.length) {
    await prisma.customer.deleteMany({ where: { id: { in: created.customers } } });
  }
  if (created.agreements.length) {
    await prisma.agreement.deleteMany({ where: { id: { in: created.agreements } } });
  }
  if (created.users.length) await prisma.user.deleteMany({ where: { id: { in: created.users } } });
  await prisma.$disconnect();
}
