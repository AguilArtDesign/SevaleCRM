import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AuthController } from './auth.controller.js';
import { AuthGuard } from './auth.guard.js';
import { AuthService } from './auth.service.js';
import { MailService } from './mail.service.js';
import { ProfileController } from './profile.controller.js';
import { PermissionsGuard } from '../permissions/permissions.guard.js';

@Module({
  controllers: [AuthController, ProfileController],
  providers: [
    AuthService,
    MailService,
    { provide: APP_GUARD, useClass: AuthGuard },
    { provide: APP_GUARD, useClass: PermissionsGuard },
  ],
  exports: [AuthService],
})
export class AuthModule {}
