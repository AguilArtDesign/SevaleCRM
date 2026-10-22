import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  agreementIdSchema,
  agreementListQuerySchema,
  agreementLogoDiscardSchema,
  agreementLogoUploadSchema,
  createAgreementSchema,
  updateAgreementSchema,
} from '@sevale/validation';
import {
  BadRequestException,
  ConflictException,
  Delete,
  PayloadTooLargeException,
} from '@nestjs/common';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { AgreementLogoService } from './agreement-logo.service.js';
import { AgreementsService } from './agreements.service.js';
import { parseInput } from './parse-input.js';

// No hay DELETE: un convenio responde a un contrato y se reactiva cuando se retoma, así que su
// ciclo de vida es `active` y nunca se borra.
@Controller('agreements')
@RequirePermissions('agreements.read')
export class AgreementsController {
  constructor(
    private readonly agreements: AgreementsService,
    private readonly logos: AgreementLogoService,
  ) {}

  @Get()
  list(@Query() query: unknown) {
    return this.agreements.list(parseInput(agreementListQuerySchema, query));
  }

  // Va antes de `:id`: si se declarara después, «assignees» se interpretaría como un identificador.
  @Get('assignees')
  assignees() {
    return this.agreements.assignableUsers();
  }

  @Get('logo/status')
  @RequirePermissions('agreements.update')
  logoStatus() {
    return this.logos.status();
  }

  // La subida es una acción de edición del convenio, así que exige `agreements.update` y no
  // `agreements.read`: un convenio sin permiso de edición no debe poder llenar el bucket.
  @Post('logo')
  @RequirePermissions('agreements.update')
  async uploadLogo(@Body() body: unknown) {
    if (!this.logos.isEnabled()) {
      throw new BadRequestException({
        success: false,
        error: {
          code: 'LOGO_STORAGE_DISABLED',
          message: 'La subida de logos no está configurada en este entorno.',
        },
      });
    }
    const { contentType, data } = parseInput(agreementLogoUploadSchema, body);
    let buffer: Buffer;
    try {
      buffer = Buffer.from(data, 'base64');
    } catch {
      throw new BadRequestException({
        success: false,
        error: { code: 'LOGO_INVALID', message: 'El archivo no se pudo leer.' },
      });
    }
    const problem = this.logos.validate(buffer, contentType);
    if (problem) {
      const Exception =
        problem.code === 'LOGO_TOO_LARGE' ? PayloadTooLargeException : BadRequestException;
      throw new Exception({ success: false, error: problem });
    }
    return this.logos.upload(buffer, contentType);
  }

  /**
   * Descarta una subida que nunca se guardó. Existe porque la imagen se sube al elegirla, para poder
   * previsualizarla: si la persona cierra el formulario sin guardar, el objeto quedaría en el bucket
   * sin que nadie lo referencie. Solo borra objetos de la carpeta de logos y que ningún convenio use.
   */
  @Delete('logo')
  @RequirePermissions('agreements.update')
  async discardLogo(@Body() body: unknown) {
    const { url } = parseInput(agreementLogoDiscardSchema, body);
    if (!this.logos.ownsLogoUrl(url)) {
      throw new BadRequestException({
        success: false,
        error: { code: 'LOGO_NOT_OWNED', message: 'Ese archivo no pertenece a los logos del CRM.' },
      });
    }
    if (await this.agreements.isLogoInUse(url)) {
      throw new ConflictException({
        success: false,
        error: {
          code: 'LOGO_IN_USE',
          message: 'El logo está asignado a un convenio y no se puede descartar.',
        },
      });
    }
    await this.logos.remove(url);
    return { success: true as const };
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.agreements.detail(parseInput(agreementIdSchema, id));
  }

  @Post()
  @RequirePermissions('agreements.create')
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.agreements.create(parseInput(createAgreementSchema, body), request.auth.user.id);
  }

  @Patch(':id')
  @RequirePermissions('agreements.update')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.agreements.update(
      parseInput(agreementIdSchema, id),
      parseInput(updateAgreementSchema, body),
    );
  }
}
