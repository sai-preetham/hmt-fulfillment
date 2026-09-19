export const ROLE_TEMPLATES = {
  admin: ['*'],
  operations_manager: ['dashboard.view','orders.view','orders.edit','shipments.view','shipments.edit','printing.view','printing.edit','abandoned_carts.view','abandoned_carts.edit','tasks.view','tasks.edit','issues.view','issues.edit','automation.view','automation.run','integrations.view','integrations.manage','settings.view','settings.manage'],
  packing_operator: ['dashboard.view','orders.view','shipments.view','shipments.edit','printing.view','printing.edit','tasks.view','tasks.edit','issues.view','issues.edit'],
  support_operator: ['dashboard.view','orders.view','orders.edit','abandoned_carts.view','abandoned_carts.edit','tasks.view','tasks.edit','issues.view','issues.edit','printing.view'],
  viewer: ['dashboard.view','orders.view','shipments.view','printing.view','abandoned_carts.view','tasks.view','issues.view','automation.view','integrations.view','settings.view'],
  finance_admin: ['*','finance.view','finance.edit','inventory.view','inventory.edit','manufacturing.view','manufacturing.edit'],
  accountant: ['dashboard.view','finance.view','finance.edit','inventory.view','inventory.view'],
  finance_approver: ['dashboard.view','finance.view','finance.edit','inventory.view'],
  manager: ['dashboard.view','finance.view','inventory.view','manufacturing.view'],
  employee: ['dashboard.view','finance.view'],
  warehouse_operator: ['dashboard.view','inventory.view','inventory.edit','manufacturing.view'],
  production_operator: ['dashboard.view','inventory.view','inventory.edit','manufacturing.view','manufacturing.edit'],
  quality_operator: ['dashboard.view','inventory.view','manufacturing.view','manufacturing.edit'],
  auditor: ['dashboard.view','finance.view','inventory.view','manufacturing.view']
};
export const PERMISSION_GROUPS = [
  ['dashboard','Dashboard',['view']], ['orders','Orders',['view','edit']], ['shipments','Shipments',['view','edit']], ['printing','Printing',['view','edit']], ['abandoned_carts','Abandoned carts',['view','edit']], ['tasks','Tasks',['view','edit']], ['issues','Issues',['view','edit']], ['automation','Automation',['view','run']], ['integrations','Integrations',['view','manage']], ['settings','Settings',['view','manage']], ['finance','Finance',['view','edit']], ['inventory','Inventory',['view','edit']], ['manufacturing','Manufacturing',['view','edit']]
];
export function hasPermission(profile, permission) {
  if (!profile?.active) return false;
  if (profile.role === 'admin') return true;
  const overrides = profile.custom_permissions || {};
  if (typeof overrides[permission] === 'boolean') return overrides[permission];
  const permissions = ROLE_TEMPLATES[profile.role] || [];
  return permissions.includes('*') || permissions.includes(permission);
}
export function permissionsFor(profile) { return Object.fromEntries(PERMISSION_GROUPS.flatMap(([key,, actions]) => actions.map(action => [`${key}.${action}`, hasPermission(profile, `${key}.${action}`)]))); }
export function permissionForPath(pathname, method = 'GET') {
  if (pathname.startsWith('/admin/users') || pathname.startsWith('/api/admin/users')) return 'admin';
  if (pathname.startsWith('/abandoned-carts')) return `abandoned_carts.${method === 'GET' ? 'view' : 'edit'}`;
  if (pathname.startsWith('/shipments') || pathname.includes('/shipments/')) return `shipments.${method === 'GET' ? 'view' : 'edit'}`;
  if (pathname.startsWith('/orders') || pathname.includes('/api/crm/orders')) return `orders.${method === 'GET' ? 'view' : 'edit'}`;
  if (pathname.startsWith('/print') || pathname.includes('/api/crm/print')) return `printing.${method === 'GET' ? 'view' : 'edit'}`;
  if (pathname.startsWith('/tasks')) return `tasks.${method === 'GET' ? 'view' : 'edit'}`;
  if (pathname.startsWith('/issues') || pathname.startsWith('/api/crm/issues')) return `issues.${method === 'GET' ? 'view' : 'edit'}`;
  if (pathname.startsWith('/automation') || pathname.startsWith('/api/automation')) return `automation.${method === 'GET' ? 'view' : 'run'}`;
  if (pathname.startsWith('/settings')) return `settings.${method === 'GET' ? 'view' : 'manage'}`;
  if (pathname.startsWith('/finance') || pathname.startsWith('/api/finance')) return `finance.${method === 'GET' ? 'view' : 'edit'}`;
  if (pathname.startsWith('/inventory') || pathname.startsWith('/api/inventory')) return `inventory.${method === 'GET' ? 'view' : 'edit'}`;
  if (pathname.startsWith('/manufacturing') || pathname.startsWith('/api/manufacturing')) return `manufacturing.${method === 'GET' ? 'view' : 'edit'}`;
  return 'dashboard.view';
}
