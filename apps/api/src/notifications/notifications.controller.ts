import { BadRequestException, Controller, Get, Param, Patch, Query, Req } from '@nestjs/common';
import { notificationIdSchema, notificationListQuerySchema } from '@sevale/validation';
import type { AuthenticatedRequest } from '../auth/auth.guard.js';
import { NotificationsService } from './notifications.service.js';

function validationError(message: string) {
  return new BadRequestException({
    success: false,
    error: { code: 'VALIDATION_ERROR', message },
  });
}

@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  list(@Req() request: AuthenticatedRequest, @Query() query: unknown) {
    const result = notificationListQuerySchema.safeParse(query);
    if (!result.success) {
      throw validationError(
        result.error.issues[0]?.message || 'Los filtros de notificaciones no son válidos.',
      );
    }
    return this.notifications.list(request.auth.user.id, result.data);
  }

  @Patch('read-all')
  markAllRead(@Req() request: AuthenticatedRequest) {
    return this.notifications.markAllRead(request.auth.user.id);
  }

  @Patch(':id/read')
  markRead(@Req() request: AuthenticatedRequest, @Param('id') id: string) {
    const result = notificationIdSchema.safeParse(id);
    if (!result.success) {
      throw validationError(
        result.error.issues[0]?.message || 'El identificador de la notificación no es válido.',
      );
    }
    return this.notifications.markRead(result.data, request.auth.user.id);
  }
}
