export const roles = ['ADMIN', 'COMMERCIAL', 'LOGISTICS'] as const;

export const permissions = [
  'users.read',
  'users.create',
  'users.update',
  'users.disable',
  'users.delete',
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
  // Traza de responsabilidades del cliente. Solo el administrador: sirve para auditar a los
  // comerciales y el propio comercial no debería poder consultar ni interpretar ese historial.
  'customers.activity.read',
  'orders.read',
  'orders.create',
  'orders.update',
  'orders.complete',
  'orders.delete',
  'orders.shipping.update',
  'orders.siigo_quote.create',
  'orders.sync.retry',
  // Traza de responsabilidades del pedido. Solo el administrador, por la misma razón que la del
  // cliente: sirve para auditar a los comerciales.
  'orders.activity.read',
  'coupons.read',
  'coupons.create',
  'coupons.update',
  'coupons.delete',
  'coupons.sync',
  'agreements.read',
  'agreements.create',
  'agreements.update',
  'agreements.comments.create',
  // Solo ADMIN y solo para limpiar contenido de prueba: el seguimiento y las tareas son historial
  // y no deberían borrarse en operación normal. Para retirar la función basta con quitar estas dos
  // de la lista: ADMIN las pierde y la interfaz esconde los botones sola.
  'agreements.comments.delete',
  'agreements.tasks.create',
  'agreements.tasks.update',
  'agreements.tasks.delete',
  'prospects.read',
  'prospects.create',
  'prospects.update',
  'prospects.delete',
  'prospects.convert',
  // Importar es una carga masiva que puede crear miles de fichas de golpe; queda fuera del alcance
  // del comercial, que registra prospectos uno a uno.
  'prospects.import',
  'tags.manage',
  'loyalty.read',
  // Operar el panel de Puntos Colombia: buscar facturas, consultar cuentas y acumular. Solo el
  // administrador mientras se certifica con el proveedor; habilitar comerciales será un cambio de
  // esta lista, sin tocar las reglas de propiedad por seller.
  'loyalty.accrue',
  // Anular puntos ya acreditados es destructivo y no reversible desde el CRM: se separa de acumular
  // para poder cerrarlo sin cerrar el resto del panel cuando se habiliten los comerciales.
  'loyalty.revoke',
  // Bitácora de las llamadas a las APIs externas. Contiene cuerpos con datos de clientes y pedidos,
  // así que es exclusiva de la administración; vaciarla es un acto aparte.
  'logs.read',
  'logs.clear',
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
    'agreements.read',
    'agreements.create',
    'agreements.update',
    'agreements.comments.create',
    'agreements.tasks.create',
    'agreements.tasks.update',
    // Un comercial crea, edita y convierte prospectos, pero no los borra, no los importa y no
    // administra el catálogo de etiquetas.
    'prospects.read',
    'prospects.create',
    'prospects.update',
    'prospects.convert',
    // El panel de Puntos Colombia queda fuera del alcance del comercial mientras se certifica: no lo
    // ve, no lo consulta y no lo opera. Habilitarlo será agregar aquí `loyalty.read`.
  ],
  LOGISTICS: ['inventory.read', 'orders.read', 'orders.shipping.update'],
} as const satisfies Record<Role, readonly Permission[]>;

export function hasPermission(role: Role, permission: Permission): boolean {
  return (rolePermissions[role] as readonly Permission[]).includes(permission);
}
