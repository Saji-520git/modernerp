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
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

// ─── Role defaults ─────────────────────────────────────────────────────────────

export type AppRole = 'ADMIN' | 'MANAGER' | 'CASHIER' | 'STAFF';

export const ROLE_DEFAULTS: Record<AppRole, Permission[]> = {
  ADMIN: [...ALL_PERMISSIONS],

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
    'view_reports',
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
];

// ─── Helper ────────────────────────────────────────────────────────────────────

/** Returns the effective permissions for a user — custom if set, role default otherwise */
export function resolvePermissions(
  role: AppRole,
  customPermissions: unknown,
): Permission[] {
  if (Array.isArray(customPermissions) && customPermissions.length > 0) {
    return (customPermissions as string[]).filter((p) =>
      ALL_PERMISSIONS.includes(p as Permission),
    ) as Permission[];
  }
  return ROLE_DEFAULTS[role];
}
