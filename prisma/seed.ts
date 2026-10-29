import { randomUUID } from 'node:crypto';
import { resolve } from 'node:path';
import { PrismaMariaDb } from '@prisma/adapter-mariadb';
import { hashPassword } from 'better-auth/crypto';
import { config } from 'dotenv';
import { PrismaClient, Role } from '../apps/api/src/generated/prisma/client.js';
import { parseMariaDbUrl } from '../apps/api/src/database/database-url.js';

config({ path: resolve(process.cwd(), '.env'), quiet: true });

const databaseUrl = process.env.DATABASE_URL;

if (!databaseUrl) {
  throw new Error('DATABASE_URL no está configurada.');
}

const adapter = new PrismaMariaDb(parseMariaDbUrl(databaseUrl));
const prisma = new PrismaClient({ adapter });

async function seedInitialAdmin() {
  const email = (process.env.INITIAL_ADMIN_EMAIL ?? 'disenoweb@sevale.com').trim().toLowerCase();
  const initialPassword = process.env.INITIAL_ADMIN_PASSWORD?.trim();

  const admin = await prisma.user.upsert({
    where: { email },
    update: {
      role: Role.ADMIN,
      active: true,
    },
    create: {
      id: randomUUID(),
      name: 'Administrador',
      email,
      emailVerified: true,
      role: Role.ADMIN,
      active: true,
    },
  });

  if (initialPassword) {
    if (initialPassword.length < 8 || initialPassword.length > 128) {
      throw new Error('INITIAL_ADMIN_PASSWORD debe contener entre 8 y 128 caracteres.');
    }

    const existingCredential = await prisma.account.findUnique({
      where: {
        issuer_accountId: {
          issuer: 'local:credential',
          accountId: admin.id,
        },
      },
      select: { id: true },
    });

    if (!existingCredential) {
      const passwordHash = await hashPassword(initialPassword);

      await prisma.account.create({
        data: {
          id: randomUUID(),
          userId: admin.id,
          issuer: 'local:credential',
          accountId: admin.id,
          providerId: 'credential',
          password: passwordHash,
        },
      });
    }
  }

  console.info('Administrador inicial preparado correctamente.');
}

/**
 * Cuatro facturas fijas para probar el panel de Puntos Colombia contra el ambiente UAT. Simulan la
 * fuente de la factura, no la respuesta del proveedor: el flujo llama a las APIs reales.
 *
 * Los nombres y documentos son los acordados con Puntos Colombia y no cambian entre ejecuciones; los
 * totales también son fijos para que las pruebas sean repetibles. Una factura de prueba nunca lleva
 * UUID de Siigo: se marca con `source` para que jamás se confunda con una real.
 */
const uatInvoices = [
  {
    name: 'FV-1-001',
    identification: '1011237866',
    documentType: '2',
    total: '110000.00',
    itemCount: 3,
  },
  {
    name: 'FV-1-002',
    identification: '1011237867',
    documentType: '2',
    total: '110999.99',
    itemCount: 2,
  },
  {
    name: 'FV-1-003',
    identification: '1011237868',
    documentType: '3',
    total: '250000.00',
    itemCount: 1,
  },
  {
    name: 'FV-1-004',
    identification: '101123516',
    documentType: '5',
    total: '999000.00',
    itemCount: 4,
  },
] as const;

/** Misma regla que el backend: cada $1.000 valen un punto, hacia abajo. */
function pointsForTotal(total: string): number {
  return Math.floor(Number(total) / 1000);
}

async function seedPointsUatInvoices() {
  // Solo en pruebas: en producción el seed no debe dejar facturas de mentira en el panel.
  if (process.env.NODE_ENV === 'production') {
    console.info('Seed UAT de Puntos Colombia omitido: NODE_ENV=production.');
    return;
  }

  for (const invoice of uatInvoices) {
    await prisma.pointsInvoice.upsert({
      where: { name: invoice.name },
      update: {},
      create: {
        source: 'UAT_SEED',
        siigoInvoiceId: null,
        name: invoice.name,
        invoiceDate: new Date('2026-10-01T00:00:00.000Z'),
        sellerId: null,
        customerIdentification: invoice.identification,
        customerDocumentType: invoice.documentType,
        total: invoice.total,
        itemCount: invoice.itemCount,
        points: pointsForTotal(invoice.total),
        status: 'PENDING',
      },
    });
  }
  console.info('Facturas UAT de Puntos Colombia preparadas correctamente.');
}

try {
  await seedInitialAdmin();
  await seedPointsUatInvoices();
} finally {
  await prisma.$disconnect();
}
