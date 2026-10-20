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

// El convenio viaja con su creador y con dos contadores. "Tareas pendientes" se calcula sobre las
// tareas reales: no se guarda un contador redundante en agreements.
const agreementInclude = {
  createdBy: { select: { id: true, name: true, email: true } },
  _count: {
    select: {
      comments: true,
      tasks: { where: { status: 'PENDING' as const } },
    },
  },
} as const;

const commentInclude = {
  user: { select: { id: true, name: true, email: true } },
} as const;

const taskInclude = {
  assignedUser: { select: { id: true, name: true, email: true } },
  createdBy: { select: { id: true, name: true, email: true } },
} as const;

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

  findByNit(nit: string) {
    return this.prisma.agreement.findFirst({ where: { nit }, select: { id: true } });
  }

  create(data: CreateAgreementInput, createdByUserId: string) {
    return this.prisma.agreement.create({
      data: { ...data, createdByUserId },
      include: agreementInclude,
    });
  }

  update(id: number, data: UpdateAgreementInput) {
    return this.prisma.agreement.update({
      where: { id },
      data,
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
