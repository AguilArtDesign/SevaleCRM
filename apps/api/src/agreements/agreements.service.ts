import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  getCustomerWooStates,
  resolveCustomerCityName,
  resolveCustomerColombiaCity,
  resolveCustomerColombiaState,
  resolveCustomerCountry,
  resolveCustomerCountryName,
  resolveCustomerRegionName,
  resolveCustomerWooState,
} from '@sevale/shared';
import type {
  AgreementCommentsQuery,
  AgreementCustomersQuery,
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
import { AgreementsRepository, type AgreementTaskCounts } from './agreements.repository.js';
import { AgreementLogoService } from './agreement-logo.service.js';

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
 * La ubicación se valida contra el mismo catálogo que usa Clientes. En Colombia el departamento es
 * un wooCode (`CO-ANT`) y la ciudad un código (`05001`); fuera de Colombia la ciudad es texto libre
 * y el departamento solo se comprueba si el país trae catálogo de regiones, porque hay países donde
 * WooCommerce no publica estados.
 */
function validateLocation(input: {
  country: string;
  region?: string | null;
  cityCode?: string | null;
}) {
  if (!resolveCustomerCountry(input.country)) {
    throw agreementError(
      BadRequestException,
      'AGREEMENT_COUNTRY_INVALID',
      'El país no está en el catálogo.',
    );
  }
  if (input.country === 'CO') {
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
    return;
  }
  if (
    input.region &&
    getCustomerWooStates(input.country).length > 0 &&
    !resolveCustomerWooState(input.country, input.region)
  ) {
    throw agreementError(
      BadRequestException,
      'AGREEMENT_REGION_INVALID',
      'La región no pertenece al país seleccionado.',
    );
  }
}

function locationNames(agreement: {
  country: string;
  region: string | null;
  cityCode: string | null;
  cityName: string | null;
}) {
  return {
    countryName: resolveCustomerCountryName(agreement.country),
    regionName: resolveCustomerRegionName(agreement.country, agreement.region),
    cityName: resolveCustomerCityName(
      agreement.country,
      agreement.region,
      agreement.cityCode,
      agreement.cityName,
    ),
  };
}

type AgreementRow = Awaited<ReturnType<AgreementsRepository['findById']>> & object;

function serializeAgreement(
  agreement: AgreementRow,
  taskCounts: AgreementTaskCounts = { pending: 0, completed: 0, cancelled: 0 },
) {
  const { countryName, regionName, cityName } = locationNames(agreement);
  return {
    id: agreement.id,
    companyName: agreement.companyName,
    nit: agreement.nit,
    country: agreement.country,
    countryName,
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
    validUntil: agreement.validUntil ? agreement.validUntil.toISOString().slice(0, 10) : null,
    logoUrl: agreement.logoUrl,
    description: agreement.description,
    active: agreement.active,
    pendingTasks: taskCounts.pending,
    completedTasks: taskCounts.completed,
    cancelledTasks: taskCounts.cancelled,
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

function normalizeContactPhone(phone: string | null, country: string): string | null {
  if (!phone) return null;
  // El teléfono se valida contra el país del convenio. La utilidad es la misma que usa Clientes:
  // no se duplica la lógica.
  const normalized = normalizeCustomerPhone(phone, country);
  if (!normalized) {
    throw agreementError(
      BadRequestException,
      'AGREEMENT_PHONE_INVALID',
      'El teléfono del contacto no es válido para el país del convenio.',
    );
  }
  return normalized;
}

@Injectable()
export class AgreementsService {
  constructor(
    private readonly repository: AgreementsRepository,
    private readonly realtime: RealtimeGateway,
    private readonly logos: AgreementLogoService,
  ) {}

  /** Serializa una fila resolviendo sus contadores de tareas. */
  private async serialize(agreement: AgreementRow) {
    const counts = await this.repository.taskCounts([agreement.id]);
    return serializeAgreement(agreement, counts.get(agreement.id));
  }

  async list(query: AgreementListQuery) {
    const [rows, total] = await this.repository.list(query);
    // Una sola consulta agrupada para los convenios de la página, no una por fila.
    const counts = await this.repository.taskCounts(rows.map((row) => row.id));
    return {
      data: rows.map((row) => serializeAgreement(row, counts.get(row.id))),
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
    return this.serialize(agreement);
  }

  /** Un logo asignado a un convenio no debe poder descartarse: dejaría una URL rota. */
  isLogoInUse(url: string) {
    return this.repository.logoInUse(url);
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
        {
          ...input,
          // La ciudad vive en `cityCode` para Colombia y en `cityName` fuera de ella, nunca en las dos.
          ...(input.country === 'CO' ? { cityName: null } : { cityCode: null }),
          contactPhone: normalizeContactPhone(input.contactPhone, input.country),
        },
        createdByUserId,
      );
      this.realtime.emitAgreementCreated(agreement);
      return this.serialize(agreement);
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
    const country = input.country ?? current.country;
    validateLocation({
      country,
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
        // Solo se limpia la rama ajena cuando el país cambia: un PATCH que no lo toca no debe
        // borrar la ciudad de un convenio internacional.
        ...(input.country === undefined
          ? {}
          : input.country === 'CO'
            ? { cityName: null }
            : { cityCode: null }),
        ...(input.contactPhone !== undefined
          ? { contactPhone: normalizeContactPhone(input.contactPhone, country) }
          : {}),
      });
      // El logo anterior queda huérfano en el bucket si nadie lo borra. Se intenta sin bloquear el
      // guardado: un fallo de R2 no debe impedir actualizar el convenio.
      if (input.logoUrl !== undefined && current.logoUrl && current.logoUrl !== agreement.logoUrl) {
        void this.logos.remove(current.logoUrl).catch(() => undefined);
      }
      this.realtime.emitAgreementUpdated(agreement);
      return this.serialize(agreement);
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

  /**
   * Clientes del convenio: su pipeline de prospectos más los clientes que ya están vinculados. Un
   * prospecto convertido dejó de aparecer aquí como prospecto y vuelve como cliente, así que nunca
   * se lista dos veces la misma persona.
   */
  async customers(agreementId: number, query: AgreementCustomersQuery) {
    await this.ensureAgreement(agreementId);
    const { rows, total } = await this.repository.customers(
      agreementId,
      query.page,
      query.pageSize,
    );
    return {
      data: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        displayName: row.displayName,
        company: row.company,
        documentType: row.documentType,
        documentNumber: row.documentNumber,
        email: row.email,
        phone: row.phone,
        status: row.status,
        source: row.source,
        createdAt: row.createdAt,
      })),
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

  /**
   * Borrado reservado al administrador para limpiar el seguimiento de prueba. El historial real no
   * se toca: por eso no hay PATCH y conviene retirar esta acción cuando el módulo esté en uso.
   */
  async removeComment(agreementId: number, commentId: number) {
    const agreement = await this.ensureAgreement(agreementId);
    const comment = await this.repository.findComment(agreementId, commentId);
    if (!comment) {
      throw agreementError(
        NotFoundException,
        'AGREEMENT_COMMENT_NOT_FOUND',
        'El comentario no existe.',
      );
    }
    await this.repository.deleteComment(commentId);
    this.realtime.emitAgreementCommentDeleted(agreement, comment);
    return { success: true as const, id: commentId };
  }

  /** Vacía el seguimiento completo de un convenio. Devuelve cuántos comentarios se borraron. */
  async clearComments(agreementId: number) {
    const agreement = await this.ensureAgreement(agreementId);
    const { count } = await this.repository.clearComments(agreementId);
    this.realtime.emitAgreementCommentsCleared(agreement, count);
    return { success: true as const, removed: count };
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

  /**
   * Borrado físico reservado al administrador para limpiar tareas de prueba. Una tarea real se
   * cancela, no se borra: la cancelación conserva el rastro de que alguien se comprometió a algo.
   */
  async removeTask(agreementId: number, taskId: number) {
    const agreement = await this.ensureAgreement(agreementId);
    const task = await this.repository.findTask(agreementId, taskId);
    if (!task) {
      throw agreementError(NotFoundException, 'AGREEMENT_TASK_NOT_FOUND', 'La tarea no existe.');
    }
    await this.repository.deleteTask(taskId);
    this.realtime.emitAgreementTaskDeleted(agreement, task);
    return { success: true as const, id: taskId };
  }
}
