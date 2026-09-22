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
  'orders.read',
  'orders.create',
  'orders.update',
  'orders.complete',
  'orders.delete',
  'orders.shipping.update',
  'orders.siigo_quote.create',
  'orders.sync.retry',
  'coupons.read',
  'coupons.create',
  'coupons.update',
  'coupons.delete',
] as const;

export type Role = (typeof roles)[number];
export type Permission = (typeof permissions)[number];

export const rolePermissions = {
  ADMIN: permissions,
  COMMERCIAL: [
    'inventory.read',
    'customers.read',
    'customers.create',
    'customers.update',
    'customers.sync',
    'orders.read',
    'orders.create',
    'orders.update',
    'orders.complete',
    'orders.shipping.update',
    'orders.siigo_quote.create',
    'orders.sync.retry',
    'coupons.read',
  ],
  LOGISTICS: ['inventory.read', 'orders.read', 'orders.shipping.update'],
} as const satisfies Record<Role, readonly Permission[]>;

export function hasPermission(role: Role, permission: Permission): boolean {
  return (rolePermissions[role] as readonly Permission[]).includes(permission);
}
