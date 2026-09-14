export const roles = ['ADMIN', 'COMMERCIAL', 'LOGISTICS'] as const;

export const permissions = [
  'users.read',
  'users.create',
  'users.update',
  'users.disable',
  'inventory.read',
  'inventory.create',
  'inventory.update',
  'inventory.delete',
  'customers.read',
  'customers.create',
  'customers.update',
  'customers.disable',
  'customers.delete',
  'customers.sync',
] as const;

export type Role = (typeof roles)[number];
export type Permission = (typeof permissions)[number];

export const rolePermissions = {
  ADMIN: permissions,
  COMMERCIAL: ['inventory.read', 'customers.read'],
  LOGISTICS: ['inventory.read'],
} as const satisfies Record<Role, readonly Permission[]>;
