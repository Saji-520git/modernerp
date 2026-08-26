// ─── All permissions ──────────────────────────────────────────────────────────
// This is the single source of truth for every action in the system.
// Roles are just convenient presets — any permission can be overridden per user.

export const ALL_PERMISSIONS = [
  // Users
  'manage_users',
  // Products
  'view_products',
  'manage_products',
  // Inventory
  'view_inventory',
  'adjust_inventory',
  'transfer_stock',
  // POS
  'pos_checkout',
  'adjust_sale_price',   // Override product price per item in POS / invoice
  // Purchases
  'view_purchases',
  'create_purchases',
  'confirm_purchases',
  // Sales
  'view_sales',
  'create_sales',
  'confirm_sales',
  'record_payments',
  // Contacts
  'view_contacts',
  'manage_contacts',
  // Credit
  'sell_on_credit',      // Can make credit sales (paidCents = 0)
  'manage_credit',       // Can set credit limits and override credit blocks
  // Reports
  'view_reports',
  // Settings / Master Data
  'view_settings',       // Can view settings page
  'manage_settings',     // Can add/edit categories, brands, units, and system settings
  // Shifts
  'manage_shifts',       // Can open and close own shift
  'view_all_shifts',     // Can view shifts for all users
  // Super-admin only — never granted to a client role by default
  'manage_modules',      // Enable/disable optional feature modules per client
  'clear_data',          // Bulk-clear / reset system data (Data Management module)

  // ─── Fine-grained actions ───────────────────────────────────────────────
  //
  // Every key below is a SUBSET of one of the coarse permissions above, wired
  // through IMPLIED_BY. Holding the parent grants all of its children, so
  // nothing that worked before stops working and no stored override has to be
  // rewritten; granting a child on its own is what makes partial access
  // possible — a stock clerk who may edit products but not re-price them, a
  // manager who sees the sales report but not the P&L.
  //
  // A child is only introduced where a real route can enforce it.

  // Users & audit  (parent: manage_users)
  'users.view', 'users.create', 'users.edit', 'users.deactivate',
  'users.permissions', 'audit.view',

  // Products  (parent: manage_products)
  'products.create', 'products.edit', 'products.delete',
  'products.set_price', 'products.import', 'products.print_labels',

  // Inventory  (parent: adjust_inventory)
  'inventory.write_off', 'inventory.stock_take',

  // Point of sale  (parent: pos_checkout)
  'pos.hold_bill', 'pos.reprint_receipt', 'pos.void_sale',

  // Purchasing  (parents: create_purchases / confirm_purchases)
  'purchases.edit_draft', 'purchases.delete_draft',
  'purchases.receive_stock', 'purchases.record_payment', 'purchases.return',

  // Selling  (parents: create_sales / confirm_sales / record_payments)
  'sales.edit_draft', 'sales.delete_draft', 'sales.dispatch', 'sales.refund',

  // Contacts  (parent: manage_contacts)
  'contacts.create', 'contacts.edit', 'contacts.deactivate',

  // Reports  (parent: view_reports) — the split that matters most: margin and
  // profit figures were reachable by anyone who could open a sales list.
  'reports.sales', 'reports.purchases', 'reports.products', 'reports.customers',
  'reports.inventory', 'reports.profit_loss', 'reports.aging',
  'reports.dashboard', 'reports.export',

  // Settings  (parent: manage_settings) — 23 routes behind one key until now
  'settings.master_data', 'settings.system', 'settings.warehouses',
  'settings.receipt', 'settings.alerts',

  // Shifts  (parent: view_all_shifts)
  'shifts.force_close',
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

// ─── Role defaults ─────────────────────────────────────────────────────────────

export type AppRole = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'CASHIER' | 'STAFF';

// Everything a client's own top role (ADMIN) may hold — all permissions EXCEPT
// the super-admin-only controls (module on/off + destructive data clearing).
const SUPER_ADMIN_ONLY: Permission[] = ['manage_modules', 'clear_data'];
const ADMIN_PERMISSIONS: Permission[] = ALL_PERMISSIONS.filter((p) => !SUPER_ADMIN_ONLY.includes(p));

export const ROLE_DEFAULTS: Record<AppRole, Permission[]> = {
  // Vendor/super-admin: everything, including module on/off (per client).
  SUPER_ADMIN: [...ALL_PERMISSIONS],

  ADMIN: ADMIN_PERMISSIONS,

  MANAGER: [
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
  ],

  CASHIER: [
    'view_products',
    'view_inventory',
    'pos_checkout',
    'sell_on_credit',
    'record_payments',
    'view_sales',
    'view_contacts',
    'view_settings',
    'manage_shifts',
  ],

  STAFF: [
    'view_products',
    'view_inventory',
    'view_purchases',
    'view_sales',
    'view_contacts',
    // Operational reports only. This role carried view_reports, which reaches
    // profit, margin and debtor ageing - the lowest role in the system could
    // read the owner's numbers. Narrowed while no STAFF account exists, so
    // nothing in the field loses access; grant finer report keys per user.
    'reports.inventory',
    'reports.products',
    'view_settings',
  ],
};

// ─── Permission groups (for the UI) ───────────────────────────────────────────

export interface PermissionGroup {
  label: string;
  icon: string;
  permissions: { key: Permission; label: string; description: string }[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    label: 'User Management',
    icon: '👤',
    permissions: [
      { key: 'manage_users', label: 'Manage Users', description: 'Create, edit, deactivate user accounts and change roles' },
    ],
  },
  {
    label: 'Products',
    icon: '📦',
    permissions: [
      { key: 'view_products', label: 'View Products', description: 'Browse the product catalogue' },
      { key: 'manage_products', label: 'Manage Products', description: 'Create and edit products, categories, pricing' },
    ],
  },
  {
    label: 'Inventory',
    icon: '🏭',
    permissions: [
      { key: 'view_inventory', label: 'View Stock', description: 'See current stock levels across warehouses' },
      { key: 'adjust_inventory', label: 'Adjust Stock', description: 'Manually add or remove stock quantities' },
      { key: 'transfer_stock', label: 'Transfer Stock', description: 'Move stock between warehouses' },
    ],
  },
  {
    label: 'Point of Sale',
    icon: '🛒',
    permissions: [
      { key: 'pos_checkout', label: 'POS Checkout', description: 'Process sales and print receipts at the cash register' },
      { key: 'adjust_sale_price', label: 'Adjust Sale Price', description: 'Override product price per item in POS or invoice' },
    ],
  },
  {
    label: 'Purchases',
    icon: '🚚',
    permissions: [
      { key: 'view_purchases', label: 'View Purchases', description: 'See all purchase orders and their status' },
      { key: 'create_purchases', label: 'Create Purchases', description: 'Draft new purchase orders for suppliers' },
      { key: 'confirm_purchases', label: 'Confirm & Receive', description: 'Confirm POs and receive stock into warehouse' },
    ],
  },
  {
    label: 'Sales',
    icon: '📄',
    permissions: [
      { key: 'view_sales', label: 'View Sales', description: 'See all sales invoices and their status' },
      { key: 'create_sales', label: 'Create Invoices', description: 'Create new sales invoices for customers' },
      { key: 'confirm_sales', label: 'Confirm & Dispatch', description: 'Confirm invoices and deduct stock' },
      { key: 'record_payments', label: 'Record Payments', description: 'Mark invoices as paid and record payment method' },
    ],
  },
  {
    label: 'Contacts',
    icon: '👥',
    permissions: [
      { key: 'view_contacts', label: 'View Contacts', description: 'Browse suppliers and customers' },
      { key: 'manage_contacts', label: 'Manage Contacts', description: 'Add and edit suppliers and customers' },
    ],
  },
  {
    label: 'Credit',
    icon: '💳',
    permissions: [
      { key: 'sell_on_credit', label: 'Sell on Credit', description: 'Make sales with CREDIT payment (paidCents = 0)' },
      { key: 'manage_credit', label: 'Manage Credit', description: 'Set credit limits and override credit blocks on customers' },
    ],
  },
  {
    label: 'Reports',
    icon: '📊',
    permissions: [
      { key: 'view_reports', label: 'View Reports', description: 'Access all sales, stock and financial reports' },
    ],
  },
  {
    label: 'Settings',
    icon: '⚙️',
    permissions: [
      { key: 'view_settings',   label: 'View Settings',   description: 'View system settings (read-only)' },
      { key: 'manage_settings', label: 'Manage Settings', description: 'Edit system settings, categories, brands, units' },
    ],
  },
  {
    label: 'Shifts',
    icon: '🕐',
    permissions: [
      { key: 'manage_shifts',    label: 'Manage Shifts',    description: 'Open and close own POS shift' },
      { key: 'view_all_shifts',  label: 'View All Shifts',  description: 'View shift history for all users' },
    ],
  },
  {
    label: 'Super Admin',
    icon: '🛡️',
    permissions: [
      { key: 'manage_modules', label: 'Manage Modules', description: 'Super-admin only: enable/disable optional feature modules per client' },
      { key: 'clear_data',     label: 'Clear System Data', description: 'Super-admin only: bulk-clear / reset system data' },
    ],
  },
];


// ─── Labels for the fine-grained actions ──────────────────────────────────────
//
// Kept beside the map rather than in the UI so the backend stays the one place
// that describes what a permission means — the frontend catalogue is generated
// from this, and a drift test fails the build if the two ever disagree.
export const FINE_LABELS: Record<string, { label: string; description: string }> = {
  'users.view':              { label: 'View Users',          description: 'See the list of user accounts' },
  'users.create':            { label: 'Create Users',        description: 'Add new user accounts' },
  'users.edit':              { label: 'Edit Users',          description: 'Change name, email or role of an account' },
  'users.deactivate':        { label: 'Deactivate Users',    description: 'Disable an account without deleting it' },
  'users.permissions':       { label: 'Assign Permissions',  description: 'Override the permissions of an individual user' },
  'audit.view':              { label: 'View Audit Trail',    description: 'Read the record of who changed what' },

  'products.create':         { label: 'Create Products',     description: 'Add new products to the catalogue' },
  'products.edit':           { label: 'Edit Products',       description: 'Change product details, units and reorder levels' },
  'products.delete':         { label: 'Deactivate Products', description: 'Retire a product from the catalogue' },
  'products.set_price':      { label: 'Set Cost & Price',    description: 'Change what a product costs and sells for' },
  'products.import':         { label: 'Import Products',     description: 'Bulk-load products from a file' },
  'products.print_labels':   { label: 'Print Barcode Labels', description: 'Generate and print shelf or product labels' },

  'inventory.write_off':     { label: 'Write Off Stock',     description: 'Remove damaged or expired stock from the books' },
  'inventory.stock_take':    { label: 'Stock-take',          description: 'Run a cycle count and post the differences' },

  'pos.hold_bill':           { label: 'Hold & Resume Bills', description: 'Park a cart and pick it up again later' },
  'pos.reprint_receipt':     { label: 'Reprint Receipt',     description: 'Print a duplicate of a receipt already issued' },
  'pos.void_sale':           { label: 'Void Sale',           description: 'Cancel a sale at the till' },

  'purchases.edit_draft':    { label: 'Edit Draft POs',      description: 'Change a purchase order before it is confirmed' },
  'purchases.delete_draft':  { label: 'Delete Draft POs',    description: 'Discard an unconfirmed purchase order' },
  'purchases.receive_stock': { label: 'Receive Stock (GRN)', description: 'Book a delivery in against a purchase order' },
  'purchases.record_payment':{ label: 'Pay Suppliers',       description: 'Record a payment made against a purchase' },
  'purchases.return':        { label: 'Purchase Returns',    description: 'Send goods back to a supplier' },

  'sales.edit_draft':        { label: 'Edit Draft Invoices', description: 'Change an invoice before it is confirmed' },
  'sales.delete_draft':      { label: 'Delete Draft Invoices', description: 'Discard an unconfirmed invoice' },
  'sales.dispatch':          { label: 'Dispatch Goods',      description: 'Confirm an invoice and take the stock out' },
  'sales.refund':            { label: 'Refunds & Credit Notes', description: 'Return goods and give money back' },

  'contacts.create':         { label: 'Create Contacts',     description: 'Add customers and suppliers' },
  'contacts.edit':           { label: 'Edit Contacts',       description: 'Change contact details and terms' },
  'contacts.deactivate':     { label: 'Deactivate Contacts', description: 'Retire a customer or supplier' },

  'reports.sales':           { label: 'Sales Report',        description: 'Revenue by period, warehouse and payment method' },
  'reports.purchases':       { label: 'Purchases Report',    description: 'Spend by supplier and period' },
  'reports.products':        { label: 'Product Performance', description: 'Best sellers, with cost and margin' },
  'reports.customers':       { label: 'Customer Report',     description: 'What each customer has spent' },
  'reports.inventory':       { label: 'Stock Valuation',     description: 'What is on hand and what it is worth' },
  'reports.profit_loss':     { label: 'Profit & Loss',       description: 'Revenue, cost of sales and gross profit' },
  'reports.aging':           { label: 'Receivables & Payables', description: 'Who owes money, and how overdue it is' },
  'reports.dashboard':       { label: 'Dashboard Figures',   description: 'The headline numbers on the home screen' },
  'reports.export':          { label: 'Export Reports',      description: 'Download report data as CSV' },

  'settings.master_data':    { label: 'Master Data',         description: 'Categories, brands and units of measure' },
  'settings.system':         { label: 'System Settings',     description: 'Company details, currency, tax and behaviour' },
  'settings.warehouses':     { label: 'Warehouses',          description: 'Add and edit stock locations' },
  'settings.receipt':        { label: 'Receipt Layout',      description: 'What the printed receipt looks like' },
  'settings.alerts':         { label: 'Alert Rules',         description: 'Low-stock and expiry alert thresholds' },

  'shifts.force_close':      { label: 'Force-close Shifts',  description: "Close another user's till session" },
};

/**
 * The catalogue the permission screen renders: each coarse permission with the
 * finer actions it contains. Derived from IMPLIED_BY so the two cannot drift.
 */
export function permissionCatalogue(): (PermissionGroup & {
  permissions: (PermissionGroup['permissions'][number] & {
    children: { key: string; label: string; description: string }[];
  })[];
})[] {
  return PERMISSION_GROUPS.map((g) => ({
    ...g,
    permissions: g.permissions.map((p) => ({
      ...p,
      children: (IMPLIED_BY[p.key] ?? []).map((key) => ({
        key,
        label: FINE_LABELS[key]?.label ?? key,
        description: FINE_LABELS[key]?.description ?? '',
      })),
    })),
  }));
}

/** True for the vendor super-admin permissions that clients must never self-grant. */
export const SUPER_ADMIN_PERMISSIONS: Permission[] = ['manage_modules', 'clear_data'];

// ─── Coarse → fine ────────────────────────────────────────────────────────────
//
// The contract that makes this safe to introduce: a child is listed under the
// EXACT coarse permission that guards its route today. So expanding a grant can
// only ever hand someone an action they could already perform, and a route may
// be re-pointed from parent to child without anyone losing access.
//
// It also means the 26 keys already stored on users keep meaning what they
// meant. Nothing needs migrating.
export const IMPLIED_BY: Partial<Record<Permission, Permission[]>> = {
  manage_users:      ['users.view', 'users.create', 'users.edit', 'users.deactivate',
                      'users.permissions', 'audit.view'],
  manage_products:   ['products.create', 'products.edit', 'products.delete',
                      'products.set_price', 'products.import', 'products.print_labels'],
  adjust_inventory:  ['inventory.write_off', 'inventory.stock_take'],
  pos_checkout:      ['pos.hold_bill', 'pos.reprint_receipt', 'pos.void_sale'],
  create_purchases:  ['purchases.edit_draft', 'purchases.delete_draft'],
  confirm_purchases: ['purchases.receive_stock', 'purchases.record_payment', 'purchases.return'],
  create_sales:      ['sales.edit_draft', 'sales.delete_draft'],
  confirm_sales:     ['sales.dispatch'],
  record_payments:   ['sales.refund'],
  manage_contacts:   ['contacts.create', 'contacts.edit', 'contacts.deactivate'],
  view_reports:      ['reports.sales', 'reports.purchases', 'reports.products',
                      'reports.customers', 'reports.inventory', 'reports.profit_loss',
                      'reports.aging', 'reports.dashboard', 'reports.export'],
  manage_settings:   ['settings.master_data', 'settings.system', 'settings.warehouses',
                      'settings.receipt', 'settings.alerts'],
  view_all_shifts:   ['shifts.force_close'],
};

/** Parent of a fine permission, or undefined for a coarse one. */
export const PARENT_OF: Partial<Record<Permission, Permission>> = Object.fromEntries(
  Object.entries(IMPLIED_BY).flatMap(([parent, kids]) =>
    (kids ?? []).map((k) => [k, parent as Permission])),
) as Partial<Record<Permission, Permission>>;

/**
 * Grants, plus everything those grants imply.
 *
 * Runs to a fixpoint rather than one pass, so a child that later gains children
 * of its own still resolves — the cost is trivial and the alternative is a bug
 * that only appears the day someone nests one level deeper.
 */
export function expandPermissions(granted: readonly Permission[]): Permission[] {
  const seen = new Set<Permission>(granted);
  let changed = true;
  while (changed) {
    changed = false;
    for (const p of [...seen]) {
      for (const child of IMPLIED_BY[p] ?? []) {
        if (!seen.has(child)) { seen.add(child); changed = true; }
      }
    }
  }
  return [...seen];
}

// ─── Helper ────────────────────────────────────────────────────────────────────

/** Returns the effective permissions for a user — custom if set, role default otherwise */
export function resolvePermissions(
  role: AppRole,
  customPermissions: unknown,
): Permission[] {
  if (Array.isArray(customPermissions) && customPermissions.length > 0) {
    const kept = (customPermissions as string[]).filter((p) =>
      ALL_PERMISSIONS.includes(p as Permission),
    ) as Permission[];
    return expandPermissions(kept);
  }
  // Role defaults are still written in coarse keys on purpose: they read as
  // intent rather than as a checklist, and expansion keeps them exact.
  return expandPermissions(ROLE_DEFAULTS[role]);
}
