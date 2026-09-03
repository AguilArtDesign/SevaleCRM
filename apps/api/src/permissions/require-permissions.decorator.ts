import { SetMetadata } from '@nestjs/common';
import type { Permission } from '@sevale/permissions';

export const REQUIRED_PERMISSIONS = 'requiredPermissions';
export const RequirePermissions = (...permissions: Permission[]) =>
  SetMetadata(REQUIRED_PERMISSIONS, permissions);
