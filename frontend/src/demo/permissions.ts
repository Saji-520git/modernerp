// ─── Role → permission map for the demo ──────────────────────────────────────
//
// A mirror of ROLE_DEFAULTS in backend/src/config/permissions.ts.
//
// The list is restated here rather than imported from services/users.ts, which
// already exports an identical ALL_PERMISSIONS. That import looked like the
// tidier option and was reverted: services/users.ts imports services/api.ts,
// and api.ts imports the demo installer — so reusing it closed a cycle
//
//     api → demo/install → adapter → handlers → permissions → users → api
//
// which threw "Cannot access 'ALL_PERMISSIONS' before initialization" at
// module-evaluation time. The demo layer must stay a leaf: it may be imported
// by the app, but must not import back into it. `../utils/local-date` is the
// one exception, and is safe because it imports nothing.
//
// SUPER_ADMIN is deliberately absent: that role bypasses every module and role
// gate in AppShell.isVisible, which would put vendor-only tooling in front of a
// prospective client.

export type DemoRole = 'ADMIN' | 'MANAGER' | 'CASHIER' | 'STAFF';

/** Everything except the two super-admin-only keys (manage_modules, clear_data). */
const ADMIN: string[] = [
  'manage_users',
  'view_products', 'manage_products',
  'view_inventory', 'adjust_inventory', 'transfer_stock',
  'pos_checkout', 'adjust_sale_price',
  'view_purchases', 'create_purchases', 'confirm_purchases',
  'view_sales', 'create_sales', 'confirm_sales', 'record_payments',
  'view_contacts', 'manage_contacts',
  'sell_on_credit', 'manage_credit',
  'view_reports',
  'view_settings', 'manage_settings',
  'manage_shifts', 'view_all_shifts',
  'users.view', 'users.create', 'users.edit', 'users.deactivate',
  'users.permissions', 'audit.view',
  'products.create', 'products.edit', 'products.delete',
  'products.set_price', 'products.import', 'products.print_labels',
  'inventory.write_off', 'inventory.stock_take',
  'pos.hold_bill', 'pos.reprint_receipt', 'pos.void_sale',
  'purchases.edit_draft', 'purchases.delete_draft',
  'purchases.receive_stock', 'purchases.record_payment', 'purchases.return',
  'sales.edit_draft', 'sales.delete_draft', 'sales.dispatch', 'sales.refund',
  'contacts.create', 'contacts.edit', 'contacts.deactivate',
  'reports.sales', 'reports.purchases', 'reports.products', 'reports.customers',
  'reports.inventory', 'reports.profit_loss', 'reports.aging', 'reports.dashboard',
  'reports.export',
  'settings.master_data', 'settings.system', 'settings.warehouses',
  'settings.receipt', 'settings.alerts',
  'shifts.force_close',
];

const MANAGER: string[] = [
  'view_products', 'manage_products',
  'view_inventory', 'adjust_inventory', 'transfer_stock',
  'pos_checkout', 'adjust_sale_price',
  'view_purchases', 'create_purchases', 'confirm_purchases',
  'view_sales', 'create_sales', 'confirm_sales', 'record_payments',
  'view_contacts', 'manage_contacts',
  'sell_on_credit', 'manage_credit',
  'view_reports',
  'view_settings', 'manage_settings',
  'manage_shifts', 'view_all_shifts',
];

const CASHIER: string[] = [
  'view_products',
  'view_inventory',
  'pos_checkout',
  'sell_on_credit',
  'record_payments',
  'view_sales',
  'view_contacts',
  'view_settings',
  'manage_shifts',
];

const STAFF: string[] = [
  'view_products',
  'view_inventory',
  'view_purchases',
  'view_sales',
  'view_contacts',
  'reports.inventory',
  'reports.products',
  'view_settings',
];

export const ROLE_PERMISSIONS: Record<DemoRole, string[]> = { ADMIN, MANAGER, CASHIER, STAFF };
