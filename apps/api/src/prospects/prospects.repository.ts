import { Injectable } from '@nestjs/common';
import type { ProspectListQuery, TagListQuery } from '@sevale/validation';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

const userSummary = { select: { id: true, name: true, email: true } } as const;

// El prospecto viaja con su convenio, su comercial y sus etiquetas. Los nombres de ubicación no se
// guardan: se resuelven al leer, igual que en Clientes y Convenios.
const prospectInclude = {
  agreement: { select: { id: true, companyName: true, active: true } },
  assignedUser: userSummary,
  createdBy: userSummary,
  convertedCustomer: { select: { id: true, displayName: true, documentNumber: true } },
  tags: { include: { tag: { select: { id: true, name: true, active: true } } } },
} as const;

export type ProspectWithRelations = Prisma.ProspectGetPayload<{
  include: typeof prospectInclude;
}>;

/**
 * Los convertidos no son trabajo diario: solo aparecen si se piden explícitamente. Por eso el
 * filtro por defecto es «todo menos CONVERTED» y no «sin filtro».
 */
function prospectWhere({
  search,
  status,
  source,
  assignedUserId,
  unassigned,
  agreementId,
  tagId,
}: ProspectListQuery) {
  return {
    ...(status === 'all' ? { status: { not: 'CONVERTED' as const } } : { status }),
    ...(source ? { source } : {}),
    ...(unassigned ? { assignedUserId: null } : assignedUserId ? { assignedUserId } : {}),
    ...(agreementId ? { agreementId } : {}),
    ...(tagId ? { tags: { some: { tagId } } } : {}),
    // Búsqueda local con `contains`: es un LIKE '%texto%' y no usa los índices B-tree, pero el
    // volumen esperado de prospectos lo hace irrelevante. Nunca sale a Siigo ni a WooCommerce.
    ...(search
      ? {
          OR: [
            { displayName: { contains: search } },
            { firstName: { contains: search } },
            { lastName: { contains: search } },
            { company: { contains: search } },
            { documentNumber: { contains: search } },
            { email: { contains: search } },
            { phone: { contains: search } },
          ],
        }
      : {}),
  } satisfies Prisma.ProspectWhereInput;
}

@Injectable()
export class ProspectsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(query: ProspectListQuery) {
    const where = prospectWhere(query);
    const orderBy = { [query.sort]: query.order } as Prisma.ProspectOrderByWithRelationInput;
    return this.prisma.$transaction([
      this.prisma.prospect.findMany({
        where,
        orderBy: [orderBy, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: prospectInclude,
      }),
      this.prisma.prospect.count({ where }),
    ]);
  }

  findById(id: number) {
    return this.prisma.prospect.findUnique({ where: { id }, include: prospectInclude });
  }

  create(data: Prisma.ProspectUncheckedCreateInput, tagIds: number[]) {
    return this.prisma.prospect.create({
      data: {
        ...data,
        ...(tagIds.length ? { tags: { create: tagIds.map((tagId) => ({ tagId })) } } : {}),
      },
      include: prospectInclude,
    });
  }

  /** `tagIds` reemplaza el conjunto completo: el formulario envía el estado final, no un delta. */
  update(id: number, data: Prisma.ProspectUncheckedUpdateInput, tagIds?: number[]) {
    return this.prisma.prospect.update({
      where: { id },
      data: {
        ...data,
        ...(tagIds ? { tags: { deleteMany: {}, create: tagIds.map((tagId) => ({ tagId })) } } : {}),
      },
      include: prospectInclude,
    });
  }

  /** La conversión no toca nada más: la fila queda como historial del paso a Clientes. */
  markConverted(id: number, convertedCustomerId: number) {
    return this.prisma.prospect.update({
      where: { id },
      data: { status: 'CONVERTED', convertedCustomerId, convertedAt: new Date() },
      include: prospectInclude,
    });
  }

  delete(id: number) {
    return this.prisma.prospect.delete({ where: { id }, include: prospectInclude });
  }

  userExists(userId: string) {
    return this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  }

  agreementExists(agreementId: number) {
    return this.prisma.agreement.findUnique({
      where: { id: agreementId },
      select: { id: true },
    });
  }

  customerExists(customerId: number) {
    return this.prisma.customer.findFirst({
      where: { id: customerId, deletedAt: null },
      select: { id: true },
    });
  }

  tagsByIds(tagIds: number[]) {
    if (!tagIds.length) return Promise.resolve([]);
    return this.prisma.tag.findMany({
      where: { id: { in: tagIds } },
      select: { id: true, name: true },
    });
  }

  /** Usuarios asignables. Se expone desde Prospectos porque `users.read` es solo de ADMIN. */
  assignableUsers() {
    return this.prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, email: true },
      orderBy: [{ name: 'asc' }],
    });
  }

  // --- Etiquetas ---------------------------------------------------------------------------

  tags({ active }: TagListQuery) {
    return this.prisma.tag.findMany({
      where: active === undefined ? {} : { active },
      select: { id: true, name: true, active: true, _count: { select: { prospects: true } } },
      orderBy: [{ name: 'asc' }],
    });
  }

  tagByName(name: string) {
    return this.prisma.tag.findFirst({ where: { name }, select: { id: true } });
  }

  createTag(name: string, active: boolean) {
    return this.prisma.tag.create({
      data: { name, active },
      select: { id: true, name: true, active: true, _count: { select: { prospects: true } } },
    });
  }

  updateTag(id: number, data: { name?: string; active?: boolean }) {
    return this.prisma.tag.update({
      where: { id },
      data,
      select: { id: true, name: true, active: true, _count: { select: { prospects: true } } },
    });
  }

  findTag(id: number) {
    return this.prisma.tag.findUnique({ where: { id }, select: { id: true } });
  }
}
