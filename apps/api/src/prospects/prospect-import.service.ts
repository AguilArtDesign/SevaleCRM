import {
  BadRequestException,
  HttpException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  createProspectSchema,
  customerDocumentTypeHints,
  resolveCustomerDocumentType,
} from '@sevale/validation';
import { parseCsv, normalizeHeader } from '../common/csv.js';
import { normalizeComparableText } from '../common/text.js';
import { ProspectsRepository } from './prospects.repository.js';
import { ProspectsService } from './prospects.service.js';
import { resolveCustomerCountryByName } from '@sevale/shared';

/**
 * Columnas que entiende el archivo. Se aceptan alias porque el CSV lo arma una persona en Excel y
 * obligarla a recordar un nombre exacto es la principal fuente de rechazos. Las columnas que no
 * aparecen aquí se ignoran: el archivo puede traer datos que el CRM todavía no usa.
 */
const COLUMN_ALIASES = {
  firstName: ['nombre', 'nombres', 'primer_nombre'],
  lastName: ['apellido', 'apellidos'],
  company: ['empresa', 'compania', 'razon_social'],
  documentType: ['tipo_documento', 'tipo_de_documento', 'tipo_doc'],
  documentNumber: ['documento', 'numero_documento', 'numero_de_documento', 'cedula', 'nit'],
  email: ['correo', 'email', 'e_mail', 'correo_electronico'],
  phone: ['telefono', 'celular', 'movil', 'phone'],
  agreementName: ['convenio', 'convenios', 'agreement', 'programa'],
  countryName: ['pais', 'país', 'country', 'nacion'],
} as const;

type ImportColumn = keyof typeof COLUMN_ALIASES;

/**
 * Plantilla que se descarga desde el modal: es el mismo formato que valida el backend. En
 * `tipo_documento` va el nombre tal como aparece en el selector, que la importación traduce al código
 * que guarda el CRM. En `convenio` va el nombre del convenio, que se resuelve contra el catálogo.
 */
export const PROSPECT_IMPORT_TEMPLATE =
  'nombre,apellido,empresa,tipo_documento,documento,correo,telefono,pais,convenio\n' +
  'Ana,Pérez,Comercializadora ABC SAS,Cédula de ciudadanía,1020304050,ana@empresa.com,+573001234567,Colombia,COOMEVA\n' +
  'Carlos,Ramírez,Inversiones XYZ SAS,NIT,900123456,+573104567890,carlos@inversionesxyz.com,Colombia,\n';

const MAX_REPORTED_ISSUES = 50;
/**
 * El navegador envía el archivo por lotes, pero un lote igual puede traer miles de filas. Estas
 * consultas se parten para no generar un `IN` con decenas de miles de valores ni una sentencia
 * `INSERT` que supere `max_allowed_packet`.
 */
const LOOKUP_CHUNK_SIZE = 1_000;
const INSERT_CHUNK_SIZE = 500;

type ImportIssue = { row: number; field: string; message: string };

type PreparedRow = {
  /** Número de fila en el archivo, contando el encabezado. Es lo que ve la persona en Excel. */
  row: number;
  values: ReturnType<ProspectsService['prepareImportedProspect']>;
};

export type ProspectImportPreview = {
  totalRows: number;
  validRows: number;
  newProspects: number;
  duplicates: number;
  errorCount: number;
  errors: ImportIssue[];
  canImport: boolean;
};

/**
 * Identidad de un prospecto para efectos de duplicados. Solo el documento y, en su defecto, el
 * correo: el teléfono **no** identifica a nadie y usarlo como clave descarta registros legítimos
 * (una familia o una oficina comparten número, y una base de convenio repite números con frecuencia).
 */
function duplicateKeys(row: { documentNumber?: string | null; email?: string | null }) {
  const document = row.documentNumber ? `d:${row.documentNumber}` : null;
  if (document) return [document];
  return row.email ? [`e:${row.email}`] : [];
}

function errorMessage(error: unknown): string {
  if (error instanceof HttpException) {
    const response = error.getResponse();
    if (typeof response === 'string') return response;
    const nested = (response as { error?: { message?: unknown } }).error?.message;
    if (typeof nested === 'string') return nested;
  }
  return error instanceof Error ? error.message : 'La fila no se pudo leer.';
}

function chunk<T>(values: T[], size: number): T[][] {
  const result: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    result.push(values.slice(index, index + size));
  }
  return result;
}

@Injectable()
export class ProspectImportService {
  constructor(
    private readonly repository: ProspectsRepository,
    private readonly prospects: ProspectsService,
  ) {}

  status() {
    return { enabled: this.isEnabled(), template: PROSPECT_IMPORT_TEMPLATE };
  }

  async preview(csv: string): Promise<ProspectImportPreview> {
    this.assertEnabled();
    const parsed = await this.parse(csv);
    const existing = await this.existingKeys(parsed.rows);
    return this.compare(parsed, existing);
  }

  async import(csv: string) {
    this.assertEnabled();
    const parsed = await this.parse(csv);
    const existing = await this.existingKeys(parsed.rows);
    const preview = this.compare(parsed, existing);
    if (!preview.canImport) {
      throw new UnprocessableEntityException({
        success: false,
        error: {
          code: 'PROSPECT_IMPORT_INVALID',
          message: 'El archivo contiene errores. Corrígelos y vuelve a intentarlo.',
          preview,
        },
      });
    }

    // La vista previa ya marcó las filas repetidas: aquí solo se insertan las nuevas. Un lote cuyas
    // filas ya existen no es un error: se informa con `imported: 0`.
    const seen = new Set(existing);
    const data: Parameters<ProspectsRepository['createMany']>[0] = [];
    for (const { values } of parsed.rows) {
      const keys = duplicateKeys(values);
      if (keys.some((key) => seen.has(key))) continue;
      keys.forEach((key) => seen.add(key));
      data.push(values);
    }

    let imported = 0;
    for (const group of chunk(data, INSERT_CHUNK_SIZE)) {
      const created = await this.repository.createMany(group);
      imported += created.count;
    }

    return {
      success: true as const,
      totalRows: parsed.totalRows,
      imported,
      duplicates: preview.duplicates,
    };
  }

  private isEnabled(): boolean {
    return process.env.PROSPECT_IMPORT_ENABLED?.trim().toLowerCase() === 'true';
  }

  private assertEnabled() {
    if (!this.isEnabled()) {
      throw new NotFoundException({
        success: false,
        error: {
          code: 'PROSPECT_IMPORT_DISABLED',
          message: 'La importación de prospectos no está habilitada.',
        },
      });
    }
  }

  /** Devuelve los encabezados reconocidos junto con su posición en el archivo. */
  private mapHeaders(headerRow: string[]) {
    const positions = new Map<ImportColumn, number>();
    const entries = Object.entries(COLUMN_ALIASES) as [ImportColumn, readonly string[]][];
    headerRow.forEach((header, index) => {
      const normalized = normalizeHeader(header, index);
      for (const [column, aliases] of entries) {
        if (!positions.has(column) && aliases.includes(normalized)) positions.set(column, index);
      }
    });
    return positions;
  }

  /** Nombre del convenio (normalizado) al identificador que guarda el CRM. */
  private async agreementLookup() {
    const catalog = await this.repository.agreementsCatalog();
    const byName = new Map<string, number>();
    for (const agreement of catalog) {
      const key = normalizeComparableText(agreement.companyName);
      if (!byName.has(key)) byName.set(key, agreement.id);
    }
    return byName;
  }

  private async parse(csv: string) {
    let rows: string[][];
    try {
      rows = parseCsv(csv);
    } catch (error) {
      throw new BadRequestException({
        success: false,
        error: {
          code: 'INVALID_CSV',
          message: error instanceof Error ? error.message : 'El CSV no se pudo leer.',
        },
      });
    }
    if (rows.length < 2) {
      throw new BadRequestException({
        success: false,
        error: { code: 'EMPTY_CSV', message: 'El archivo no contiene prospectos.' },
      });
    }

    const headerRow = rows[0] as string[];
    const positions = this.mapHeaders(headerRow);
    if (!positions.size) {
      throw new BadRequestException({
        success: false,
        error: {
          code: 'INVALID_CSV_HEADERS',
          message:
            'No encontramos ninguna columna reconocible. Usa la plantilla: nombre, apellido, empresa, tipo_documento, documento, correo, telefono, pais y convenio.',
        },
      });
    }

    const agreements = positions.has('agreementName') ? await this.agreementLookup() : null;
    const prepared: PreparedRow[] = [];
    const errors: ImportIssue[] = [];
    // Un convenio inexistente afecta a miles de filas; se informa una vez por nombre en lugar de
    // repetir el mismo mensaje y ocultar los demás problemas.
    const unknownAgreements = new Set<string>();
    const unknownCountries = new Set<string>();
    let errorCount = 0;

    const dataRows = rows
      .slice(1)
      .map((values, index) => ({ values, row: index + 2 }))
      .filter(({ values }) => values.some((value) => value.trim()));

    for (const { values, row } of dataRows) {
      const raw: Record<string, string> = {};
      for (const [column, index] of positions) {
        const value = values[index]?.trim();
        if (value) raw[column] = value;
      }

      // El CRM guarda el código de Siigo (`13`), no la etiqueta del selector. Sin esta traducción el
      // prospecto no se podría convertir en cliente después.
      if (raw.documentType) {
        const documentType = resolveCustomerDocumentType(raw.documentType);
        if (!documentType) {
          errorCount += 1;
          errors.push({
            row,
            field: 'tipo_documento',
            message: `«${raw.documentType}» no es un tipo de documento válido. Usa ${customerDocumentTypeHints}.`,
          });
          continue;
        }
        raw.documentType = documentType;
      }

      // El país se resuelve por nombre contra el catálogo del selector, para que una base de un
      // convenio no obligue a completar el país de miles de fichas una por una. Igual que el
      // convenio, un nombre desconocido se informa una sola vez en lugar de por cada fila.
      if (raw.countryName) {
        const country = resolveCustomerCountryByName(raw.countryName);
        if (!country) {
          errorCount += 1;
          if (!unknownCountries.has(raw.countryName)) {
            unknownCountries.add(raw.countryName);
            errors.push({
              row,
              field: 'pais',
              message: `El país «${raw.countryName}» no existe en el catálogo. Usa el nombre tal como aparece en el selector de país.`,
            });
          }
          continue;
        }
        raw.country = country.code;
      }
      delete raw.countryName;

      // El convenio se resuelve por nombre contra el catálogo. Si no existe se rechaza la fila:
      // importarla sin convenio dejaría la base sin la clasificación que le da sentido.
      if (raw.agreementName && agreements) {
        const agreementId = agreements.get(normalizeComparableText(raw.agreementName));
        if (agreementId === undefined) {
          errorCount += 1;
          if (!unknownAgreements.has(raw.agreementName)) {
            unknownAgreements.add(raw.agreementName);
            errors.push({
              row,
              field: 'convenio',
              message: `El convenio «${raw.agreementName}» no existe en el CRM. Créalo antes de importar.`,
            });
          }
          continue;
        }
        raw.agreementId = String(agreementId);
      }
      delete raw.agreementName;

      // Se valida con el mismo esquema que el alta manual: la importación no es una puerta trasera.
      const parsed = createProspectSchema.safeParse(raw);
      if (!parsed.success) {
        const [issue] = parsed.error.issues;
        errorCount += 1;
        errors.push({
          row,
          field: issue?.path.join('.') || 'fila',
          message: issue?.message ?? 'La fila no es válida.',
        });
        continue;
      }

      try {
        prepared.push({
          row,
          values: this.prospects.prepareImportedProspect(parsed.data),
        });
      } catch (error) {
        errorCount += 1;
        errors.push({ row, field: 'fila', message: errorMessage(error) });
      }
    }

    return {
      rows: prepared,
      errors: errors.slice(0, MAX_REPORTED_ISSUES),
      errorCount,
      totalRows: dataRows.length,
    };
  }

  /** Claves de identidad que ya existen en la base, para no insertar repetidos. */
  private async existingKeys(rows: PreparedRow[]) {
    const documents = new Set<string>();
    const emails = new Set<string>();
    for (const { values } of rows) {
      if (values.documentNumber) documents.add(values.documentNumber);
      if (values.email) emails.add(values.email);
    }

    const keys = new Set<string>();
    const documentList = [...documents];
    const emailList = [...emails];
    const batches = Math.max(
      Math.ceil(documentList.length / LOOKUP_CHUNK_SIZE),
      Math.ceil(emailList.length / LOOKUP_CHUNK_SIZE),
    );

    for (let index = 0; index < batches; index += 1) {
      const from = index * LOOKUP_CHUNK_SIZE;
      const to = from + LOOKUP_CHUNK_SIZE;
      const found = await this.repository.findImportDuplicates({
        documents: documentList.slice(from, to),
        emails: emailList.slice(from, to),
      });
      for (const row of found) duplicateKeys(row).forEach((key) => keys.add(key));
    }
    return keys;
  }

  private compare(
    parsed: {
      rows: PreparedRow[];
      errors: ImportIssue[];
      errorCount: number;
      totalRows: number;
    },
    existing: Set<string>,
  ): ProspectImportPreview {
    const seen = new Set(existing);
    let duplicates = 0;
    let newProspects = 0;

    for (const { values } of parsed.rows) {
      const keys = duplicateKeys(values);
      // Una fila repetida dentro del propio archivo cuenta como duplicado, no como alta nueva.
      if (keys.some((key) => seen.has(key))) {
        duplicates += 1;
        continue;
      }
      keys.forEach((key) => seen.add(key));
      newProspects += 1;
    }

    return {
      totalRows: parsed.totalRows,
      validRows: parsed.rows.length,
      newProspects,
      duplicates,
      errorCount: parsed.errorCount,
      errors: parsed.errors,
      // Importar un archivo cuyas filas ya existen no es un error: `import` devuelve `imported: 0`.
      canImport: parsed.errorCount === 0,
    };
  }
}
