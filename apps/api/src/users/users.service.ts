import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateUserInput, UpdateUserInput, UserListQuery } from '@sevale/validation';
import { PrismaService } from '../database/prisma.service.js';

const userSelect = {
  id: true,
  name: true,
  email: true,
  sellerId: true,
  role: true,
  active: true,
  createdAt: true,
  lastLoginAt: true,
} as const;

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

function uniqueConflictMessage(error: unknown): { code: string; message: string } {
  const details = error as {
    message?: unknown;
    meta?: {
      target?: unknown;
      driverAdapterError?: { cause?: { constraint?: { index?: unknown } } };
    };
  };
  const target = details.meta?.target;
  const constraint = details.meta?.driverAdapterError?.cause?.constraint?.index;
  // El adaptador de MariaDB no expone `meta.target`: el índice violado llega en
  // `driverAdapterError` y en el mensaje, así que se inspeccionan los tres.
  const hint = [
    Array.isArray(target) ? target.join(',') : typeof target === 'string' ? target : '',
    typeof constraint === 'string' ? constraint : '',
    typeof details.message === 'string' ? details.message : '',
  ]
    .join(' ')
    .toLowerCase();
  if (hint.includes('seller')) {
    return {
      code: 'SELLER_ID_TAKEN',
      message: 'Ese seller id de Siigo ya está asignado a otro usuario.',
    };
  }
  if (hint.includes('email')) {
    return {
      code: 'EMAIL_TAKEN',
      message: 'Ya existe un usuario con ese correo electrónico.',
    };
  }
  return {
    code: 'USER_CONFLICT',
    message: 'Ya existe un usuario con ese correo electrónico o seller id de Siigo.',
  };
}

function userConflict(error: unknown): ConflictException {
  return new ConflictException({ success: false, error: uniqueConflictMessage(error) });
}

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list({ search, role, page, pageSize }: UserListQuery) {
    const where = {
      ...(role ? { role } : {}),
      ...(search ? { OR: [{ name: { contains: search } }, { email: { contains: search } }] } : {}),
    };
    const [users, total] = await this.prisma.$transaction([
      this.prisma.user.findMany({
        where,
        select: userSelect,
        orderBy: [{ active: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
      }),
      this.prisma.user.count({ where }),
    ]);

    return {
      data: users,
      pagination: { page, pageSize, total, totalPages: Math.max(1, Math.ceil(total / pageSize)) },
    };
  }

  async create(input: CreateUserInput) {
    try {
      return await this.prisma.user.create({
        data: {
          name: input.name,
          email: input.email,
          sellerId: input.sellerId,
          role: input.role,
          active: input.active,
          // Los usuarios del CRM son provisionados por un administrador y el
          // acceso sigue requiriendo demostrar posesión del correo mediante OTP.
          emailVerified: true,
        },
        select: userSelect,
      });
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw userConflict(error);
      }
      throw error;
    }
  }

  async update(id: string, input: UpdateUserInput, actorId: string) {
    const current = await this.prisma.user.findUnique({ where: { id }, select: userSelect });
    if (!current) throw new NotFoundException('El usuario no existe.');

    const changesOwnAccess =
      id === actorId &&
      ((input.role !== undefined && input.role !== current.role) ||
        (input.active !== undefined && input.active !== current.active));
    if (changesOwnAccess) {
      throw new BadRequestException('No puedes cambiar tu propio rol o estado.');
    }

    const removesActiveAdmin =
      current.active &&
      current.role === 'ADMIN' &&
      (input.active === false || (input.role !== undefined && input.role !== 'ADMIN'));
    if (removesActiveAdmin) {
      const activeAdmins = await this.prisma.user.count({ where: { role: 'ADMIN', active: true } });
      if (activeAdmins <= 1) {
        throw new BadRequestException('Debe permanecer al menos un administrador activo.');
      }
    }

    const accessChanged =
      (input.role !== undefined && input.role !== current.role) ||
      (input.active !== undefined && input.active !== current.active);

    const updated = await this.prisma.user
      .update({
        where: { id },
        data: input,
        select: userSelect,
      })
      .catch((error: unknown) => {
        if (isUniqueConstraintError(error)) throw userConflict(error);
        throw error;
      });
    if (accessChanged) await this.prisma.session.deleteMany({ where: { userId: id } });
    return updated;
  }

  async remove(id: string, actorId: string) {
    if (id === actorId) throw new BadRequestException('No puedes eliminar tu propia cuenta.');
    return this.prisma.$transaction(async (transaction) => {
      const current = await transaction.user.findUnique({ where: { id }, select: userSelect });
      if (!current) throw new NotFoundException('El usuario no existe.');
      if (current.role === 'ADMIN' && current.active) {
        const activeAdmins = await transaction.user.count({
          where: { role: 'ADMIN', active: true },
        });
        if (activeAdmins <= 1) {
          throw new BadRequestException('Debe permanecer al menos un administrador activo.');
        }
      }
      await transaction.productSyncJob.deleteMany({ where: { requestedById: id } });
      return transaction.user.delete({ where: { id }, select: userSelect });
    });
  }
}
