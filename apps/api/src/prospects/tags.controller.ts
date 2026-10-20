import { Body, Controller, Get, Param, Patch, Post, Query } from '@nestjs/common';
import {
  createTagSchema,
  tagIdSchema,
  tagListQuerySchema,
  updateTagSchema,
} from '@sevale/validation';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { parseInput } from './parse-input.js';
import { ProspectsService } from './prospects.service.js';

/**
 * El catálogo se lee con el mismo permiso que Prospectos porque el formulario necesita las
 * etiquetas para asignarlas. Crearlas o renombrarlas es solo del administrador (`tags.manage`).
 */
@Controller('tags')
@RequirePermissions('prospects.read')
export class TagsController {
  constructor(private readonly prospects: ProspectsService) {}

  @Get()
  list(@Query() query: unknown) {
    return this.prospects.tags(parseInput(tagListQuerySchema, query));
  }

  @Post()
  @RequirePermissions('tags.manage')
  create(@Body() body: unknown) {
    return this.prospects.createTag(parseInput(createTagSchema, body));
  }

  @Patch(':id')
  @RequirePermissions('tags.manage')
  update(@Param('id') id: string, @Body() body: unknown) {
    return this.prospects.updateTag(parseInput(tagIdSchema, id), parseInput(updateTagSchema, body));
  }
}
