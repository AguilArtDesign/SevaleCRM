import { Body, Controller, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  agreementIdSchema,
  agreementListQuerySchema,
  createAgreementSchema,
  updateAgreementSchema,
} from '@sevale/validation';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { AgreementsService } from './agreements.service.js';
import { parseInput } from './parse-input.js';

// No hay DELETE: un convenio responde a un contrato y se reactiva cuando se retoma, así que su
// ciclo de vida es `active` y nunca se borra.
@Controller('agreements')
@RequirePermissions('agreements.read')
export class AgreementsController {
  constructor(private readonly agreements: AgreementsService) {}

  @Get()
  list(@Query() query: unknown) {
    return this.agreements.list(parseInput(agreementListQuerySchema, query));
  }

  // Va antes de `:id`: si se declarara después, «assignees» se interpretaría como un identificador.
  @Get('assignees')
  assignees() {
    return this.agreements.assignableUsers();
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
