import { Injectable } from '@nestjs/common';
import type {
  AgreementListQuery,
  AgreementTasksQuery,
  CreateAgreementCommentInput,
  CreateAgreementInput,
  CreateAgreementTaskInput,
  UpdateAgreementInput,
  UpdateAgreementTaskInput,
} from '@sevale/validation';
import { PrismaService } from '../database/prisma.service.js';
import type { Prisma } from '../generated/prisma/client.js';

// El convenio viaja con su creador y el número de comentarios. Las tareas se cuentan aparte, por
// estado, con una sola consulta agrupada: `_count` de Prisma solo admite un filtro por relación y
// aquí hacen falta los tres estados.
const agreementInclude = {
  createdBy: { select: { id: true, name: true, email: true } },
  _count: {
    select: {
      comments: true,
    },
  },
} as const;

export type AgreementTaskCounts = { pending: number; completed: number; cancelled: number };

const commentInclude = {
  user: { select: { id: true, name: true, email: true } },
} as const;

const taskInclude = {
  assignedUser: { select: { id: true, name: true, email: true } },
  createdBy: { select: { id: true, name: true, email: true } },
} as const;

/**
 * La vigencia viaja como fecha sin hora (`YYYY-MM-DD`) y la columna es DATE. Se ancla a medianoche
 * UTC para que el valor no se desplace un día según el huso del servidor.
 */
function agreementData<T extends { validUntil?: string | null }>(data: T) {
  if (data.validUntil === undefined) return data;
  const { validUntil, ...rest } = data;
  return { ...rest, validUntil: validUntil ? new Date(`${validUntil}T00:00:00.000Z`) : null };
}

function agreementWhere({
  search,
  active,
  region,
  cityCode,
}: Pick<AgreementListQuery, 'search' | 'active' | 'region' | 'cityCode'>) {
  return {
    ...(active === 'active' ? { active: true } : {}),
    ...(active === 'inactive' ? { active: false } : {}),
    ...(region ? { region } : {}),
    ...(cityCode ? { cityCode } : {}),
    // La búsqueda es local y con `contains`, igual que en Clientes: un LIKE '%texto%' no usa los
    // índices B-tree, pero con el volumen esperado de convenios es suficiente.
    ...(search
      ? {
          OR: [
            { companyName: { contains: search } },
            { nit: { contains: search } },
            { contactName: { contains: search } },
            { contactEmail: { contains: search } },
            { contactPhone: { contains: search } },
          ],
        }
      : {}),
  } satisfies Prisma.AgreementWhereInput;
}

@Injectable()
export class AgreementsRepository {
  constructor(private readonly prisma: PrismaService) {}

  list(query: AgreementListQuery) {
    const where = agreementWhere(query);
    const orderBy = { [query.sort]: query.order } as Prisma.AgreementOrderByWithRelationInput;
    return this.prisma.$transaction([
      this.prisma.agreement.findMany({
        where,
        orderBy: [orderBy, { id: 'desc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: agreementInclude,
      }),
      this.prisma.agreement.count({ where }),
    ]);
  }

  findById(id: number) {
    return this.prisma.agreement.findUnique({ where: { id }, include: agreementInclude });
  }

  /**
   * Cuenta las tareas de cada convenio agrupadas por estado. Una sola consulta para toda la página:
   * hacer tres conteos por fila multiplicaría las consultas del listado.
   */
  async taskCounts(agreementIds: number[]): Promise<Map<number, AgreementTaskCounts>> {
    const counts = new Map<number, AgreementTaskCounts>();
    if (!agreementIds.length) return counts;

    const grouped = await this.prisma.agreementTask.groupBy({
      by: ['agreementId', 'status'],
      where: { agreementId: { in: agreementIds } },
      _count: { _all: true },
    });

    for (const row of grouped) {
      const current = counts.get(row.agreementId) ?? { pending: 0, completed: 0, cancelled: 0 };
      if (row.status === 'PENDING') current.pending += row._count._all;
      else if (row.status === 'COMPLETED') current.completed += row._count._all;
      else current.cancelled += row._count._all;
      counts.set(row.agreementId, current);
    }
    return counts;
  }

  findByNit(nit: string) {
    return this.prisma.agreement.findFirst({ where: { nit }, select: { id: true } });
  }

  /** Indica si algún convenio usa esa URL. Protege el borrado de un logo en uso. */
  async logoInUse(url: string): Promise<boolean> {
    const found = await this.prisma.agreement.findFirst({
      where: { logoUrl: url },
      select: { id: true },
    });
    return found !== null;
  }

  create(data: CreateAgreementInput, createdByUserId: string) {
    return this.prisma.agreement.create({
      data: { ...agreementData(data), createdByUserId },
      include: agreementInclude,
    });
  }

  update(id: number, data: UpdateAgreementInput) {
    return this.prisma.agreement.update({
      where: { id },
      data: agreementData(data),
      include: agreementInclude,
    });
  }

  // --- Comentarios -------------------------------------------------------------------------

  comments(agreementId: number, page: number, pageSize: number) {
    const where: Prisma.AgreementCommentWhereInput = { agreementId };
    return this.prisma.$transaction([
      this.prisma.agreementComment.findMany({
        where,
        // Cronológico: lo primero que se habló aparece arriba, como un historial.
        orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: commentInclude,
      }),
      this.prisma.agreementComment.count({ where }),
    ]);
  }

  createComment(agreementId: number, userId: string, data: CreateAgreementCommentInput) {
    return this.prisma.agreementComment.create({
      data: { agreementId, userId, comment: data.comment },
      include: commentInclude,
    });
  }

  // --- Tareas ------------------------------------------------------------------------------

  tasks(agreementId: number, query: AgreementTasksQuery) {
    const where: Prisma.AgreementTaskWhereInput = {
      agreementId,
      ...(query.status ? { status: query.status } : {}),
    };
    return this.prisma.$transaction([
      this.prisma.agreementTask.findMany({
        where,
        orderBy: [{ scheduledAt: 'asc' }, { id: 'asc' }],
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
        include: taskInclude,
      }),
      this.prisma.agreementTask.count({ where }),
    ]);
  }

  findTask(agreementId: number, taskId: number) {
    return this.prisma.agreementTask.findFirst({
      where: { id: taskId, agreementId },
      include: taskInclude,
    });
  }

  createTask(agreementId: number, createdByUserId: string, data: CreateAgreementTaskInput) {
    return this.prisma.agreementTask.create({
      data: {
        agreementId,
        createdByUserId,
        title: data.title,
        description: data.description,
        scheduledAt: data.scheduledAt,
        assignedUserId: data.assignedUserId,
      },
      include: taskInclude,
    });
  }

  updateTask(taskId: number, data: UpdateAgreementTaskInput) {
    return this.prisma.agreementTask.update({
      where: { id: taskId },
      data,
      include: taskInclude,
    });
  }

  // Completar fija la fecha; cancelar la limpia. Reabrir vuelve a pendiente y borra ese rastro.
  setTaskStatus(taskId: number, status: 'PENDING' | 'COMPLETED' | 'CANCELLED') {
    return this.prisma.agreementTask.update({
      where: { id: taskId },
      data: {
        status,
        completedAt: status === 'COMPLETED' ? new Date() : null,
      },
      include: taskInclude,
    });
  }

  userExists(userId: string) {
    return this.prisma.user.findUnique({ where: { id: userId }, select: { id: true } });
  }

  /**
   * Usuarios a los que se puede asignar una tarea. Se expone desde Convenios porque listar usuarios
   * exige `users.read`, que solo tiene el administrador: un comercial necesita asignar tareas sin
   * poder ver el panel de Usuarios.
   */
  assignableUsers() {
    return this.prisma.user.findMany({
      where: { active: true },
      select: { id: true, name: true, email: true },
      orderBy: [{ name: 'asc' }],
    });
  }
}
