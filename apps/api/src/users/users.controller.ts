import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Param,
  Patch,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import {
  createUserSchema,
  updateUserSchema,
  userIdSchema,
  userListQuerySchema,
} from '@sevale/validation';
import type { ZodType } from 'zod';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { RequirePermissions } from '../permissions/require-permissions.decorator.js';
import { UsersService } from './users.service.js';

function parseInput<T>(schema: ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (result.success) return result.data;
  throw new BadRequestException({
    success: false,
    error: {
      code: 'VALIDATION_ERROR',
      message: result.error.issues[0]?.message || 'Los datos enviados no son válidos.',
    },
  });
}

@Controller('users')
export class UsersController {
  constructor(private readonly usersService: UsersService) {}

  @Get()
  @RequirePermissions('users.read')
  list(@Query() query: unknown) {
    return this.usersService.list(parseInput(userListQuerySchema, query));
  }

  @Post()
  @RequirePermissions('users.create')
  create(@Body() body: unknown) {
    return this.usersService.create(parseInput(createUserSchema, body));
  }

  @Patch(':id')
  @RequirePermissions('users.update', 'users.disable')
  update(@Param('id') id: string, @Body() body: unknown, @Req() request: AuthenticatedRequest) {
    return this.usersService.update(
      parseInput(userIdSchema, id),
      parseInput(updateUserSchema, body),
      request.auth.user.id,
    );
  }
}
