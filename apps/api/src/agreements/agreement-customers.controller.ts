import { Controller, Get, Param, Query } from '@nestjs/common';
import { agreementCustomersQuerySchema, agreementIdSchema } from '@sevale/validation';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { AgreementsService } from './agreements.service.js';
import { parseInput } from './parse-input.js';

// Solo lectura: el vínculo con el convenio pertenece al prospecto y se cambia editando el prospecto,
// no desde aquí. Esta ruta existe para que la ficha del convenio pueda mostrar quién pertenece a él.
@Controller('agreements/:agreementId/customers')
@RequirePermissions('agreements.read')
export class AgreementCustomersController {
  constructor(private readonly agreements: AgreementsService) {}

  @Get()
  list(@Param('agreementId') agreementId: string, @Query() query: unknown) {
    return this.agreements.customers(
      parseInput(agreementIdSchema, agreementId),
      parseInput(agreementCustomersQuerySchema, query),
    );
  }
}
