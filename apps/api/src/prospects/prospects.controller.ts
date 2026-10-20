import { Body, Controller, Delete, Get, Param, Patch, Post, Query, Req } from '@nestjs/common';
import {
  createProspectSchema,
  prospectConvertLinkSchema,
  prospectConvertSchema,
  prospectIdSchema,
  prospectListQuerySchema,
  updateProspectSchema,
} from '@sevale/validation';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { parseInput } from './parse-input.js';
import { ProspectsService } from './prospects.service.js';

@Controller('prospects')
@RequirePermissions('prospects.read')
export class ProspectsController {
  constructor(private readonly prospects: ProspectsService) {}

  @Get()
  list(@Query() query: unknown) {
    return this.prospects.list(parseInput(prospectListQuerySchema, query));
  }

  // Va antes de `:id`: si se declarara después, «assignees» se interpretaría como un identificador.
  @Get('assignees')
  assignees() {
    return this.prospects.assignableUsers();
  }

  @Get(':id')
  detail(@Param('id') id: string) {
    return this.prospects.detail(parseInput(prospectIdSchema, id));
  }

  @Post()
  @RequirePermissions('prospects.create')
  create(@Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.prospects.create(parseInput(createProspectSchema, body), request.auth.user.id);
  }

  @Patch(':id')
  @RequirePermissions('prospects.update')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.prospects.update(
      parseInput(prospectIdSchema, id),
      parseInput(updateProspectSchema, body),
    );
  }

  @Delete(':id')
  @RequirePermissions('prospects.delete')
  remove(@Param('id') id: string) {
    return this.prospects.remove(parseInput(prospectIdSchema, id));
  }

  // El cuerpo es el mismo que `POST /customers`: la conversión no inventa un contrato paralelo.
  @Post(':id/convert')
  @RequirePermissions('prospects.convert')
  convert(@Param('id') id: string, @Body() body: unknown) {
    return this.prospects.convert(
      parseInput(prospectIdSchema, id),
      parseInput(prospectConvertSchema, body),
    );
  }

  @Post(':id/convert/link')
  @RequirePermissions('prospects.convert')
  convertLink(@Param('id') id: string, @Body() body: unknown) {
    const { customerId } = parseInput(prospectConvertLinkSchema, body);
    return this.prospects.convertLink(parseInput(prospectIdSchema, id), customerId);
  }
}
