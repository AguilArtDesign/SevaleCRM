import { Controller, Get, Req } from '@nestjs/common';
import type { AuthenticatedRequest } from './auth.guard.js';

@Controller('me')
export class ProfileController {
  @Get()
  getProfile(@Req() request: AuthenticatedRequest) {
    const { id, name, email, role } = request.auth.user;
    return { id, name, email, role };
  }
}
