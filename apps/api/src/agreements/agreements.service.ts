import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { resolveCustomerColombiaCity, resolveCustomerColombiaState } from '@sevale/shared';
import type {
  AgreementCommentsQuery,
  AgreementListQuery,
  AgreementTasksQuery,
  CreateAgreementCommentInput,
  CreateAgreementInput,
  CreateAgreementTaskInput,
  UpdateAgreementInput,
  UpdateAgreementTaskInput,
} from '@sevale/validation';
import { normalizeCustomerPhone } from '../customers/customer-data-sanitizer.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import type { AgreementTaskStatus } from '../generated/prisma/client.js';
import { AgreementsRepository } from './agreements.repository.js';

function agreementError(
  Exception: typeof BadRequestException | typeof ConflictException | typeof NotFoundException,
  code: string,
  message: string,
) {
  return new Exception({ success: false, error: { code, message } });
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: unknown }).code === 'P2002'
  );
}

/**
 * Los convenios son solo de Colombia, así que la ubicación se valida contra el mismo catálogo que
 * usa Clientes: el departamento es un wooCode (`CO-ANT`) y la ciudad un código (`05001`). No se
 * guardan nombres; se resuelven al leer.
 */
function validateLocation(input: { region?: string | null; cityCode?: string | null }) {
  if (input.cityCode && !input.region) {
    throw agreementError(
      BadRequestException,
      'AGREEMENT_REGION_REQUIRED',
      'Selecciona el departamento antes de guardar la ciudad.',
    );
  }
  if (input.region && !resolveCustomerColombiaState(input.region)) {
    throw agreementError(
      BadRequestException,
      'AGREEMENT_REGION_INVALID',
      'El departamento no pertenece a Colombia.',
    );
  }
  if (
    input.cityCode &&
    input.region &&
    !resolveCustomerColombiaCity(input.region, input.cityCode)
  ) {
    throw agreementError(
      BadRequestException,
      'AGREEMENT_CITY_INVALID',
      'La ciudad no pertenece al departamento seleccionado.',
    );
  }
}

function locationNames(region: string | null, cityCode: string | null) {
  const state = region ? resolveCustomerColombiaState(region) : null;
  const city = region && cityCode ? resolveCustomerColombiaCity(region, cityCode) : null;
  return { regionName: state?.name ?? null, cityName: city?.name ?? null };
}

type AgreementRow = Awaited<ReturnType<AgreementsRepository['findById']>> & object;

function serializeAgreement(agreement: AgreementRow) {
  const { regionName, cityName } = locationNames(agreement.region, agreement.cityCode);
  return {
    id: agreement.id,
    companyName: agreement.companyName,
    nit: agreement.nit,
    region: agreement.region,
    regionName,
    cityCode: agreement.cityCode,
    cityName,
    postalCode: agreement.postalCode,
    addressLine1: agreement.addressLine1,
    addressLine2: agreement.addressLine2,
    contactName: agreement.contactName,
    contactPosition: agreement.contactPosition,
    contactEmail: agreement.contactEmail,
    contactPhone: agreement.contactPhone,
    description: agreement.description,
    active: agreement.active,
    pendingTasks: agreement._count.tasks,
    commentsCount: agreement._count.comments,
    createdBy: agreement.createdBy,
    createdAt: agreement.createdAt,
    updatedAt: agreement.updatedAt,
  };
}

type CommentRow = Awaited<ReturnType<AgreementsRepository['createComment']>>;

function serializeComment(comment: CommentRow) {
  return {
    id: comment.id,
    agreementId: comment.agreementId,
    comment: comment.comment,
    author: comment.user,
    createdAt: comment.createdAt,
    updatedAt: comment.updatedAt,
  };
}

type TaskRow = Awaited<ReturnType<AgreementsRepository['createTask']>>;

function serializeTask(task: TaskRow) {
  return {
    id: task.id,
    agreementId: task.agreementId,
    title: task.title,
    description: task.description,
    scheduledAt: task.scheduledAt,
    status: task.status,
    completedAt: task.completedAt,
    assignedUser: task.assignedUser,
    createdBy: task.createdBy,
    createdAt: task.createdAt,
    updatedAt: task.updatedAt,
  };
}

function normalizeContactPhone(phone: string | null): string | null {
  if (!phone) return null;
  // Los convenios son de Colombia, así que el teléfono se valida y normaliza contra CO. La
  // utilidad es la misma que usa Clientes: no se duplica la lógica.
  const normalized = normalizeCustomerPhone(phone, 'CO');
  if (!normalized) {
    throw agreementError(
      BadRequestException,
      'AGREEMENT_PHONE_INVALID',
      'El teléfono del contacto no es válido para Colombia.',
    );
  }
  return normalized;
}

@Injectable()
export class AgreementsService {
  constructor(
    private readonly repository: AgreementsRepository,
    private readonly realtime: RealtimeGateway,
  ) {}

  async list(query: AgreementListQuery) {
    const [rows, total] = await this.repository.list(query);
    return {
      data: rows.map(serializeAgreement),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async detail(id: number) {
    const agreement = await this.repository.findById(id);
    if (!agreement) {
      throw agreementError(NotFoundException, 'AGREEMENT_NOT_FOUND', 'El convenio no existe.');
    }
    return serializeAgreement(agreement);
  }

  /** Lista mínima de usuarios para el selector de asignación de tareas. */
  assignableUsers() {
    return this.repository.assignableUsers();
  }

  async create(input: CreateAgreementInput, createdByUserId: string) {
    validateLocation(input);
    if (input.nit) {
      const existing = await this.repository.findByNit(input.nit);
      if (existing) {
        throw agreementError(
          ConflictException,
          'AGREEMENT_NIT_TAKEN',
          'Ya existe un convenio con ese NIT.',
        );
      }
    }
    try {
      const agreement = await this.repository.create(
        { ...input, contactPhone: normalizeContactPhone(input.contactPhone) },
        createdByUserId,
      );
      this.realtime.emitAgreementCreated(agreement);
      return serializeAgreement(agreement);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw agreementError(
          ConflictException,
          'AGREEMENT_NIT_TAKEN',
          'Ya existe un convenio con ese NIT.',
        );
      }
      throw error;
    }
  }

  async update(id: number, input: UpdateAgreementInput) {
    const current = await this.repository.findById(id);
    if (!current) {
      throw agreementError(NotFoundException, 'AGREEMENT_NOT_FOUND', 'El convenio no existe.');
    }
    // La ubicación se valida con el estado resultante, no solo con lo que llega: borrar el
    // departamento dejando la ciudad debe fallar aunque el cuerpo solo traiga `region: null`.
    validateLocation({
      region: input.region !== undefined ? input.region : current.region,
      cityCode: input.cityCode !== undefined ? input.cityCode : current.cityCode,
    });
    if (input.nit && input.nit !== current.nit) {
      const existing = await this.repository.findByNit(input.nit);
      if (existing) {
        throw agreementError(
          ConflictException,
          'AGREEMENT_NIT_TAKEN',
          'Ya existe un convenio con ese NIT.',
        );
      }
    }
    try {
      const agreement = await this.repository.update(id, {
        ...input,
        ...(input.contactPhone !== undefined
          ? { contactPhone: normalizeContactPhone(input.contactPhone) }
          : {}),
      });
      this.realtime.emitAgreementUpdated(agreement);
      return serializeAgreement(agreement);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw agreementError(
          ConflictException,
          'AGREEMENT_NIT_TAKEN',
          'Ya existe un convenio con ese NIT.',
        );
      }
      throw error;
    }
  }

  // --- Comentarios -------------------------------------------------------------------------

  private async ensureAgreement(id: number) {
    const agreement = await this.repository.findById(id);
    if (!agreement) {
      throw agreementError(NotFoundException, 'AGREEMENT_NOT_FOUND', 'El convenio no existe.');
    }
    return agreement;
  }

  async comments(agreementId: number, query: AgreementCommentsQuery) {
    await this.ensureAgreement(agreementId);
    const [rows, total] = await this.repository.comments(agreementId, query.page, query.pageSize);
    return {
      data: rows.map(serializeComment),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async addComment(agreementId: number, input: CreateAgreementCommentInput, userId: string) {
    const agreement = await this.ensureAgreement(agreementId);
    const comment = await this.repository.createComment(agreementId, userId, input);
    this.realtime.emitAgreementCommentAdded(agreement, comment);
    return serializeComment(comment);
  }

  // --- Tareas ------------------------------------------------------------------------------

  async tasks(agreementId: number, query: AgreementTasksQuery) {
    await this.ensureAgreement(agreementId);
    const [rows, total] = await this.repository.tasks(agreementId, query);
    return {
      data: rows.map(serializeTask),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  private async validateAssignee(assignedUserId: string | null | undefined) {
    if (!assignedUserId) return;
    const user = await this.repository.userExists(assignedUserId);
    if (!user) {
      throw agreementError(
        BadRequestException,
        'AGREEMENT_TASK_ASSIGNEE_NOT_FOUND',
        'El usuario asignado no existe.',
      );
    }
  }

  async addTask(agreementId: number, input: CreateAgreementTaskInput, createdByUserId: string) {
    const agreement = await this.ensureAgreement(agreementId);
    await this.validateAssignee(input.assignedUserId);
    const task = await this.repository.createTask(agreementId, createdByUserId, input);
    this.realtime.emitAgreementTaskUpdated(agreement, task);
    return serializeTask(task);
  }

  async updateTask(agreementId: number, taskId: number, input: UpdateAgreementTaskInput) {
    const agreement = await this.ensureAgreement(agreementId);
    const task = await this.repository.findTask(agreementId, taskId);
    if (!task) {
      throw agreementError(NotFoundException, 'AGREEMENT_TASK_NOT_FOUND', 'La tarea no existe.');
    }
    await this.validateAssignee(input.assignedUserId);
    const updated = await this.repository.updateTask(taskId, input);
    this.realtime.emitAgreementTaskUpdated(agreement, updated);
    return serializeTask(updated);
  }

  async setTaskStatus(
    agreementId: number,
    taskId: number,
    status: Extract<AgreementTaskStatus, 'PENDING' | 'COMPLETED' | 'CANCELLED'>,
  ) {
    const agreement = await this.ensureAgreement(agreementId);
    const task = await this.repository.findTask(agreementId, taskId);
    if (!task) {
      throw agreementError(NotFoundException, 'AGREEMENT_TASK_NOT_FOUND', 'La tarea no existe.');
    }
    const updated = await this.repository.setTaskStatus(taskId, status);
    this.realtime.emitAgreementTaskUpdated(agreement, updated);
    return serializeTask(updated);
  }
}
