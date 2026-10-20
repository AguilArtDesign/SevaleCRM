import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  agreementIdSchema,
  agreementTasksQuerySchema,
  agreementTaskIdSchema,
  createAgreementTaskSchema,
  updateAgreementTaskSchema,
} from '@sevale/validation';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { AgreementsService } from './agreements.service.js';
import { parseInput } from './parse-input.js';

// Las tareas no se borran: se completan o se cancelan, y ambas quedan en el historial. Reabrir
// deshace la cancelación cuando se hizo por error.
@Controller('agreements/:agreementId/tasks')
@RequirePermissions('agreements.read')
export class AgreementTasksController {
  constructor(private readonly agreements: AgreementsService) {}

  @Get()
  list(@Param('agreementId') agreementId: string, @Query() query: unknown) {
    return this.agreements.tasks(
      parseInput(agreementIdSchema, agreementId),
      parseInput(agreementTasksQuerySchema, query),
    );
  }

  @Post()
  @RequirePermissions('agreements.tasks.create')
  create(
    @Param('agreementId') agreementId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.agreements.addTask(
      parseInput(agreementIdSchema, agreementId),
      parseInput(createAgreementTaskSchema, body),
      request.auth.user.id,
    );
  }

  @Patch(':taskId')
  @RequirePermissions('agreements.tasks.update')
  update(
    @Param('agreementId') agreementId: string,
    @Param('taskId') taskId: string,
    @Body() body: unknown,
  ) {
    return this.agreements.updateTask(
      parseInput(agreementIdSchema, agreementId),
      parseInput(agreementTaskIdSchema, taskId),
      parseInput(updateAgreementTaskSchema, body),
    );
  }

  @Post(':taskId/complete')
  @HttpCode(200)
  @RequirePermissions('agreements.tasks.update')
  complete(@Param('agreementId') agreementId: string, @Param('taskId') taskId: string) {
    return this.agreements.setTaskStatus(
      parseInput(agreementIdSchema, agreementId),
      parseInput(agreementTaskIdSchema, taskId),
      'COMPLETED',
    );
  }

  @Post(':taskId/cancel')
  @HttpCode(200)
  @RequirePermissions('agreements.tasks.update')
  cancel(@Param('agreementId') agreementId: string, @Param('taskId') taskId: string) {
    return this.agreements.setTaskStatus(
      parseInput(agreementIdSchema, agreementId),
      parseInput(agreementTaskIdSchema, taskId),
      'CANCELLED',
    );
  }

  @Post(':taskId/reopen')
  @HttpCode(200)
  @RequirePermissions('agreements.tasks.update')
  reopen(@Param('agreementId') agreementId: string, @Param('taskId') taskId: string) {
    return this.agreements.setTaskStatus(
      parseInput(agreementIdSchema, agreementId),
      parseInput(agreementTaskIdSchema, taskId),
      'PENDING',
    );
  }
}
