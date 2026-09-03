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

try {
  await seedInitialAdmin();
} finally {
  await prisma.$disconnect();
}
