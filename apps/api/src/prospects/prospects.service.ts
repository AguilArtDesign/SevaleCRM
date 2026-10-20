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
  CreateProspectInput,
  CreateTagInput,
  ProspectConvertInput,
  ProspectListQuery,
  TagListQuery,
  UpdateProspectInput,
  UpdateTagInput,
} from '@sevale/validation';
import {
  normalizeCustomerName,
  normalizeCustomerPhone,
  sanitizeCustomerEmail,
  sanitizePostalCode,
  sanitizeSiigoAddress,
} from '../customers/customer-data-sanitizer.js';
import { CustomersService } from '../customers/customers.service.js';
import type {
  CustomerPersonType,
  Prisma,
  ProspectSource,
  ProspectStatus,
} from '../generated/prisma/client.js';
import { RealtimeGateway } from '../realtime/realtime.gateway.js';
import { ProspectsRepository, type ProspectWithRelations } from './prospects.repository.js';

function prospectError(
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
 * Los campos que el prospecto comparte con Clientes. Se listan una vez para poder tomar solo esos
 * valores de un registro guardado, recalcular `displayName` y construir el `data` de Prisma sin
 * arrastrar columnas ajenas.
 */
const prospectFields = [
  'personType',
  'firstName',
  'lastName',
  'company',
  'documentType',
  'documentNumber',
  'checkDigit',
  'email',
  'phone',
  'country',
  'region',
  'cityCode',
  'cityName',
  'postalCode',
  'addressLine1',
  'addressLine2',
  'agreementId',
  'source',
  'status',
  'assignedUserId',
  'notes',
] as const;

type ProspectInputValues = {
  personType?: CustomerPersonType | null;
  firstName?: string | null;
  lastName?: string | null;
  company?: string | null;
  documentType?: string | null;
  documentNumber?: string | null;
  checkDigit?: string | null;
  email?: string | null;
  phone?: string | null;
  country?: string | null;
  region?: string | null;
  cityCode?: string | null;
  cityName?: string | null;
  postalCode?: string | null;
  addressLine1?: string | null;
  addressLine2?: string | null;
  agreementId?: number | null;
  source?: ProspectSource;
  status?: ProspectStatus;
  assignedUserId?: string | null;
  notes?: string | null;
};

function pickProspectValues(source: Record<string, unknown>): ProspectInputValues {
  const values: Record<string, unknown> = {};
  for (const field of prospectFields) values[field] = source[field];
  return values;
}

function nonEmptyText(value: string | null | undefined): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

/**
 * `displayName` se deriva siempre en backend con la cadena de prioridad acordada. El frontend puede
 * mostrar un nombre, pero nunca decide el valor guardado.
 */
function buildDisplayName(values: ProspectInputValues): string {
  const fullName = [nonEmptyText(values.firstName), nonEmptyText(values.lastName)]
    .filter(Boolean)
    .join(' ');
  for (const candidate of [
    fullName,
    nonEmptyText(values.company),
    nonEmptyText(values.phone),
    nonEmptyText(values.email),
    nonEmptyText(values.documentNumber),
  ]) {
    if (candidate) return candidate;
  }
  // La validación de «no vacío» lo impide, pero un nombre de reserva evita romper la restricción
  // NOT NULL si alguna vez se crea un prospecto desde otro canal.
  return 'Prospecto';
}

/**
 * Misma regla que Clientes, con sus propios códigos de error: Colombia guarda código de ciudad y el
 * exterior ciudad libre con `cityCode` nulo. Reutiliza los resolutores del catálogo compartido.
 */
function validateLocation(input: ProspectInputValues) {
  if (!input.country) {
    if (input.region || input.cityCode || input.cityName) {
      throw prospectError(
        BadRequestException,
        'PROSPECT_COUNTRY_REQUIRED',
        'Selecciona un país para guardar la ubicación.',
      );
    }
    return;
  }
  if (!resolveCustomerCountry(input.country)) {
    throw prospectError(
      BadRequestException,
      'PROSPECT_COUNTRY_INVALID',
      'El país no existe en el catálogo geográfico.',
    );
  }
  if (input.country === 'CO') {
    if (input.region && !resolveCustomerColombiaState(input.region)) {
      throw prospectError(
        BadRequestException,
        'PROSPECT_REGION_INVALID',
        'El departamento no pertenece a Colombia.',
      );
    }
    if (
      input.cityCode &&
      (!input.region || !resolveCustomerColombiaCity(input.region, input.cityCode))
    ) {
      throw prospectError(
        BadRequestException,
        'PROSPECT_CITY_INVALID',
        'La ciudad no pertenece al departamento seleccionado.',
      );
    }
    return;
  }
  if (input.cityCode) {
    throw prospectError(
      BadRequestException,
      'PROSPECT_CITY_INVALID',
      'Las ciudades internacionales deben guardarse como texto libre.',
    );
  }
  if (
    input.region &&
    getCustomerWooStates(input.country).length > 0 &&
    !resolveCustomerWooState(input.country, input.region)
  ) {
    throw prospectError(
      BadRequestException,
      'PROSPECT_REGION_INVALID',
      'La región no pertenece al país seleccionado.',
    );
  }
}

type CompletenessSource = {
  personType: 'PERSON' | 'COMPANY' | null;
  firstName: string | null;
  lastName: string | null;
  company: string | null;
  documentType: string | null;
  documentNumber: string | null;
  email: string | null;
  phone: string | null;
  country: string | null;
  region: string | null;
  cityCode: string | null;
  cityName: string | null;
  addressLine1: string | null;
};

/**
 * Requisitos para convertir. Coinciden con lo que exige `createCustomerSchema` más la ubicación y
 * la dirección, que Clientes acepta vacías pero que aquí sí se exigen: un prospecto solo pasa a
 * cliente cuando está completo, para no llenar el panel de Clientes de fichas a medias.
 */
function completenessOf(prospect: CompletenessSource) {
  const missing: string[] = [];
  if (!prospect.personType) missing.push('personType');
  if (!prospect.firstName) missing.push('firstName');
  if (!prospect.lastName) missing.push('lastName');
  if (prospect.personType === 'COMPANY' && !prospect.company) missing.push('company');
  if (!prospect.documentType) missing.push('documentType');
  if (!prospect.documentNumber) missing.push('documentNumber');
  if (!prospect.email) missing.push('email');
  if (!prospect.phone) missing.push('phone');
  if (!prospect.country) missing.push('country');
  if (!prospect.region) missing.push('region');
  if (!prospect.cityCode && prospect.country === 'CO') missing.push('cityCode');
  if (!prospect.cityName && prospect.country && prospect.country !== 'CO') missing.push('cityName');
  if (!prospect.addressLine1) missing.push('addressLine1');
  return { missing, complete: missing.length === 0 };
}

function serializeProspect(prospect: ProspectWithRelations) {
  return {
    id: prospect.id,
    personType: prospect.personType,
    firstName: prospect.firstName,
    lastName: prospect.lastName,
    displayName: prospect.displayName,
    company: prospect.company,
    documentType: prospect.documentType,
    documentNumber: prospect.documentNumber,
    checkDigit: prospect.checkDigit,
    email: prospect.email,
    phone: prospect.phone,
    country: prospect.country,
    region: prospect.region,
    cityCode: prospect.cityCode,
    cityName: prospect.cityName,
    postalCode: prospect.postalCode,
    addressLine1: prospect.addressLine1,
    addressLine2: prospect.addressLine2,
    source: prospect.source,
    status: prospect.status,
    notes: prospect.notes,
    agreement: prospect.agreement,
    assignedUser: prospect.assignedUser,
    createdBy: prospect.createdBy,
    convertedCustomer: prospect.convertedCustomer,
    convertedAt: prospect.convertedAt,
    tags: prospect.tags.map(({ tag }) => tag),
    // Permite a la interfaz avisar de lo que falta antes de abrir el formulario de conversión, sin
    // replicar en el frontend la lista de requisitos de Clientes.
    completeness: completenessOf(prospect),
    location: {
      countryName: resolveCustomerCountryName(prospect.country),
      regionName: resolveCustomerRegionName(prospect.country, prospect.region),
      cityName: resolveCustomerCityName(
        prospect.country,
        prospect.region,
        prospect.cityCode,
        prospect.cityName,
      ),
    },
    createdAt: prospect.createdAt,
    updatedAt: prospect.updatedAt,
  };
}

@Injectable()
export class ProspectsService {
  constructor(
    private readonly repository: ProspectsRepository,
    private readonly customers: CustomersService,
    private readonly realtime: RealtimeGateway,
  ) {}

  async list(query: ProspectListQuery) {
    const [rows, total] = await this.repository.list(query);
    return {
      data: rows.map(serializeProspect),
      pagination: {
        page: query.page,
        pageSize: query.pageSize,
        total,
        totalPages: Math.max(1, Math.ceil(total / query.pageSize)),
      },
    };
  }

  async detail(id: number) {
    const prospect = await this.repository.findById(id);
    if (!prospect) {
      throw prospectError(NotFoundException, 'PROSPECT_NOT_FOUND', 'El prospecto no existe.');
    }
    return serializeProspect(prospect);
  }

  assignableUsers() {
    return this.repository.assignableUsers();
  }

  // --- Normalización y referencias -----------------------------------------------------------

  private normalize(values: ProspectInputValues): ProspectInputValues {
    const rawEmail = values.email ?? null;
    const email = rawEmail ? sanitizeCustomerEmail(rawEmail) : null;
    if (rawEmail && !email) {
      throw prospectError(
        BadRequestException,
        'PROSPECT_EMAIL_INVALID',
        'Ingresa un correo válido que no pertenezca a un dominio interno.',
      );
    }
    const rawPhone = values.phone ?? null;
    const phone = rawPhone ? normalizeCustomerPhone(rawPhone, values.country) : null;
    if (rawPhone && !phone) {
      // Sin país no hay catálogo contra el que validar: se pide el indicativo en el propio número,
      // igual que hace Clientes, pero se explica por qué.
      throw prospectError(
        BadRequestException,
        'PROSPECT_PHONE_INVALID',
        values.country
          ? 'El teléfono no es válido para el país seleccionado.'
          : 'Escribe el teléfono con indicativo internacional (por ejemplo +573001234567) o selecciona un país.',
      );
    }
    // Los nombres no se capitalizan: sin `personType` no se sabe si son de una persona o de una
    // empresa. Al convertir, el saneamiento de Clientes los normaliza según el tipo elegido.
    return {
      ...values,
      firstName: normalizeCustomerName(values.firstName),
      lastName: normalizeCustomerName(values.lastName),
      company: normalizeCustomerName(values.company),
      documentType: normalizeCustomerName(values.documentType),
      documentNumber: normalizeCustomerName(values.documentNumber),
      email,
      phone,
      postalCode: sanitizePostalCode(values.postalCode),
      addressLine1: sanitizeSiigoAddress(values.addressLine1),
      addressLine2: normalizeCustomerName(values.addressLine2),
    };
  }

  private async validateReferences(input: {
    assignedUserId?: string | null;
    agreementId?: number | null;
    tagIds?: number[];
  }) {
    if (input.assignedUserId) {
      const user = await this.repository.userExists(input.assignedUserId);
      if (!user) {
        throw prospectError(
          BadRequestException,
          'PROSPECT_ASSIGNEE_NOT_FOUND',
          'El comercial asignado no existe.',
        );
      }
    }
    if (input.agreementId) {
      const agreement = await this.repository.agreementExists(input.agreementId);
      if (!agreement) {
        throw prospectError(
          BadRequestException,
          'PROSPECT_AGREEMENT_NOT_FOUND',
          'El convenio seleccionado no existe.',
        );
      }
    }
    if (input.tagIds?.length) {
      const found = await this.repository.tagsByIds(input.tagIds);
      if (found.length !== new Set(input.tagIds).size) {
        throw prospectError(
          BadRequestException,
          'PROSPECT_TAG_NOT_FOUND',
          'Alguna de las etiquetas seleccionadas no existe.',
        );
      }
    }
  }

  private async ensureEditable(id: number) {
    const prospect = await this.repository.findById(id);
    if (!prospect) {
      throw prospectError(NotFoundException, 'PROSPECT_NOT_FOUND', 'El prospecto no existe.');
    }
    if (prospect.status === 'CONVERTED') {
      throw prospectError(
        ConflictException,
        'PROSPECT_ALREADY_CONVERTED',
        'El prospecto ya se convirtió en cliente y se gestiona desde Clientes.',
      );
    }
    return prospect;
  }

  // --- CRUD ----------------------------------------------------------------------------------

  async create(input: CreateProspectInput, createdByUserId: string) {
    const { tagIds, ...rest } = input;
    validateLocation(rest);
    await this.validateReferences({ ...rest, tagIds });
    const values = this.normalize(rest);
    const prospect = await this.repository.create(
      {
        ...(values as Prisma.ProspectUncheckedCreateInput),
        displayName: buildDisplayName(values),
        createdByUserId,
      },
      tagIds ?? [],
    );
    this.realtime.emitProspectCreated(prospect);
    return serializeProspect(prospect);
  }

  async update(id: number, input: UpdateProspectInput) {
    const current = await this.ensureEditable(id);
    const { tagIds, ...rest } = input;
    // La ubicación se valida con el estado resultante: borrar el país dejando la ciudad debe
    // fallar aunque el cuerpo solo traiga `country: null`.
    const merged = { ...pickProspectValues(current), ...rest };
    validateLocation(merged);
    await this.validateReferences({ ...rest, tagIds });
    const values = this.normalize(merged);
    const data: Prisma.ProspectUncheckedUpdateInput = { displayName: buildDisplayName(values) };
    for (const field of prospectFields) {
      if (field in rest) Object.assign(data, { [field]: values[field] });
    }
    const prospect = await this.repository.update(id, data, tagIds);
    this.realtime.emitProspectUpdated(prospect);
    return serializeProspect(prospect);
  }

  async remove(id: number) {
    // Solo se borran prospectos que todavía no son clientes: el convertido es historial.
    const prospect = await this.ensureEditable(id);
    const deleted = await this.repository.delete(prospect.id);
    this.realtime.emitProspectDeleted(deleted);
    return serializeProspect(deleted);
  }

  // --- Conversión ----------------------------------------------------------------------------

  async convert(id: number, input: ProspectConvertInput) {
    const prospect = await this.ensureEditable(id);
    // Convertir exige la ficha completa: si falta algo se dice exactamente qué, en lugar de crear
    // un cliente a medias que nadie terminará de completar.
    const { missing } = completenessOf(input);
    if (missing.length) {
      throw prospectError(
        BadRequestException,
        'PROSPECT_INCOMPLETE',
        'Completa los datos del cliente antes de convertir el prospecto.',
      );
    }
    const customer = await this.customers.create(input);
    // `CustomersService.create` no acepta una transacción externa y no se refactoriza por esto.
    // Si el marcado fallara, el cliente ya existe: se informa su id para que el reintento lo
    // vincule en lugar de duplicarlo.
    const converted = await this.markConvertedOrReport(prospect.id, customer.id);
    return { prospect: serializeProspect(converted), customer };
  }

  async convertLink(id: number, customerId: number) {
    const prospect = await this.ensureEditable(id);
    // Se comprueba aquí para devolver `CUSTOMER_NOT_FOUND` con código; `detail` lo lanzaría como
    // 404 sin código, y el frontend necesita distinguirlo de un prospecto inexistente.
    if (!(await this.repository.customerExists(customerId))) {
      throw prospectError(NotFoundException, 'CUSTOMER_NOT_FOUND', 'El cliente no existe.');
    }
    const customer = await this.customers.detail(customerId);
    const converted = await this.markConvertedOrReport(prospect.id, customerId);
    return { prospect: serializeProspect(converted), customer };
  }

  /**
   * El cliente ya se creó o ya se eligió; si esto falla no se puede deshacer sin borrar un cliente
   * real. Se devuelve `CONVERSION_NOT_RECORDED` con el `customerId` para que el reintento use
   * `/convert/link` y no vuelva a crearlo.
   */
  private async markConvertedOrReport(prospectId: number, customerId: number) {
    try {
      const converted = await this.repository.markConverted(prospectId, customerId);
      this.realtime.emitProspectConverted(converted);
      return converted;
    } catch {
      throw new ConflictException({
        success: false,
        error: {
          code: 'CONVERSION_NOT_RECORDED',
          message:
            'El cliente se creó, pero no pudimos marcarlo como convertido. Vuelve a intentarlo desde el prospecto para vincularlo.',
          customerId,
        },
      });
    }
  }

  // --- Etiquetas -----------------------------------------------------------------------------

  tags(query: TagListQuery) {
    return this.repository.tags(query);
  }

  async createTag(input: CreateTagInput) {
    try {
      return await this.repository.createTag(input.name, input.active);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw prospectError(
          ConflictException,
          'TAG_NAME_TAKEN',
          'Ya existe una etiqueta con ese nombre.',
        );
      }
      throw error;
    }
  }

  async updateTag(id: number, input: UpdateTagInput) {
    const tag = await this.repository.findTag(id);
    if (!tag) {
      throw prospectError(NotFoundException, 'TAG_NOT_FOUND', 'La etiqueta no existe.');
    }
    try {
      return await this.repository.updateTag(id, input);
    } catch (error) {
      if (isUniqueConstraintError(error)) {
        throw prospectError(
          ConflictException,
          'TAG_NAME_TAKEN',
          'Ya existe una etiqueta con ese nombre.',
        );
      }
      throw error;
    }
  }
}
