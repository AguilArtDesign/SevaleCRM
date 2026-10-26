import { Body, Controller, Delete, Get, Param, Post, Query, Req } from '@nestjs/common';
import {
  agreementCommentIdSchema,
  agreementCommentsQuerySchema,
  agreementIdSchema,
  createAgreementCommentSchema,
} from '@sevale/validation';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { AgreementsService } from './agreements.service.js';
import { parseInput } from './parse-input.js';

// Los comentarios son el historial de lo hablado con la empresa: se crean y se leen. El borrado
// existe solo para que el administrador limpie contenido de prueba mientras el módulo se define.
@Controller('agreements/:agreementId/comments')
@RequirePermissions('agreements.read')
export class AgreementCommentsController {
  constructor(private readonly agreements: AgreementsService) {}

  @Get()
  list(@Param('agreementId') agreementId: string, @Query() query: unknown) {
    return this.agreements.comments(
      parseInput(agreementIdSchema, agreementId),
      parseInput(agreementCommentsQuerySchema, query),
    );
  }

  @Post()
  @RequirePermissions('agreements.comments.create')
  create(
    @Param('agreementId') agreementId: string,
    @Body() body: unknown,
    @Req() request: AuthenticatedRequest,
  ) {
    return this.agreements.addComment(
      parseInput(agreementIdSchema, agreementId),
      parseInput(createAgreementCommentSchema, body),
      request.auth.user.id,
    );
  }

  @Delete(':commentId')
  @RequirePermissions('agreements.comments.delete')
  remove(@Param('agreementId') agreementId: string, @Param('commentId') commentId: string) {
    return this.agreements.removeComment(
      parseInput(agreementIdSchema, agreementId),
      parseInput(agreementCommentIdSchema, commentId),
    );
  }

  // Vaciar el seguimiento entero. Sin `:commentId` para no chocar con el borrado individual.
  @Delete()
  @RequirePermissions('agreements.comments.delete')
  clear(@Param('agreementId') agreementId: string) {
    return this.agreements.clearComments(parseInput(agreementIdSchema, agreementId));
  }
}
