import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { CreateUserInput, UpdateUserInput } from '@sevale/validation';
import { PrismaService } from '../database/prisma.service.js';

type ListUsersInput = { search: string; page: number; pageSize: number };

const userSelect = {
  id: true,
  name: true,
  email: true,
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

@Injectable()
export class UsersService {
  constructor(private readonly prisma: PrismaService) {}

  async list({ search, page, pageSize }: ListUsersInput) {
    const where = search
      ? { OR: [{ name: { contains: search } }, { email: { contains: search } }] }
      : {};
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
        throw new ConflictException('Ya existe un usuario con ese correo electrónico.');
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

    const updated = await this.prisma.user.update({
      where: { id },
      data: input,
      select: userSelect,
    });
    if (accessChanged) await this.prisma.session.deleteMany({ where: { userId: id } });
    return updated;
  }
}
