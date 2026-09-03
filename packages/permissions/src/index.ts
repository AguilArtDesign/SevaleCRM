export const roles = ['ADMIN', 'COMMERCIAL', 'LOGISTICS'] as const;

export const permissions = [
  'users.read',
  'users.create',
  'users.update',
  'users.disable',
  'inventory.read',
  'inventory.create',
  'inventory.update',
] as const;

export type Role = (typeof roles)[number];
export type Permission = (typeof permissions)[number];

export const rolePermissions = {
  ADMIN: permissions,
  COMMERCIAL: ['inventory.read'],
  LOGISTICS: ['inventory.read'],
} as const satisfies Record<Role, readonly Permission[]>;
