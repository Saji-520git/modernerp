import { api } from './api';

// ─── Permission types (mirror backend) ───────────────────────────────────────

// ─── Permission catalogue — GENERATED, do not edit by hand ───────────────────
//
// Source of truth: backend/src/config/permissions.ts
// Regenerate:      node scripts/gen-frontend-permissions.mjs   (from backend/)
// Guarded by:      backend/tests/permission-mirror.test.ts
export const ALL_PERMISSIONS = [
  'manage_users',
  'view_products',
  'manage_products',
  'view_inventory',
  'adjust_inventory',
  'transfer_stock',
  'pos_checkout',
  'adjust_sale_price',
  'view_purchases',
  'create_purchases',
  'confirm_purchases',
  'view_sales',
  'create_sales',
  'confirm_sales',
  'record_payments',
  'view_contacts',
  'manage_contacts',
  'sell_on_credit',
  'manage_credit',
  'view_reports',
  'view_settings',
  'manage_settings',
  'manage_shifts',
  'view_all_shifts',
  'manage_modules',
  'clear_data',
  'users.view',
  'users.create',
  'users.edit',
  'users.deactivate',
  'users.permissions',
  'audit.view',
  'products.create',
  'products.edit',
  'products.delete',
  'products.set_price',
  'products.import',
  'products.print_labels',
  'inventory.write_off',
  'inventory.stock_take',
  'pos.hold_bill',
  'pos.reprint_receipt',
  'pos.void_sale',
  'purchases.edit_draft',
  'purchases.delete_draft',
  'purchases.receive_stock',
  'purchases.record_payment',
  'purchases.return',
  'sales.edit_draft',
  'sales.delete_draft',
  'sales.dispatch',
  'sales.refund',
  'contacts.create',
  'contacts.edit',
  'contacts.deactivate',
  'reports.sales',
  'reports.purchases',
  'reports.products',
  'reports.customers',
  'reports.inventory',
  'reports.profit_loss',
  'reports.aging',
  'reports.dashboard',
  'reports.export',
  'settings.master_data',
  'settings.system',
  'settings.warehouses',
  'settings.receipt',
  'settings.alerts',
  'shifts.force_close',
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

export interface PermissionChild {
  key:         Permission;
  label:       string;
  description: string;
}

export interface PermissionItem {
  key:         Permission;
  label:       string;
  description: string;
  /** Finer actions this permission contains. Granting the parent grants all. */
  children:    PermissionChild[];
}

export interface PermissionGroup {
  label:       string;
  icon:        string;
  permissions: PermissionItem[];
}

export const PERMISSION_GROUPS: PermissionGroup[] = [
  {
    label: 'User Management',
    icon: '👤',
    permissions: [
      {
        key: 'manage_users', label: 'Manage Users',
        description: 'Create, edit, deactivate user accounts and change roles',
        children: [
          { key: 'users.view', label: 'View Users', description: 'See the list of user accounts' },
          { key: 'users.create', label: 'Create Users', description: 'Add new user accounts' },
          { key: 'users.edit', label: 'Edit Users', description: 'Change name, email or role of an account' },
          { key: 'users.deactivate', label: 'Deactivate Users', description: 'Disable an account without deleting it' },
          { key: 'users.permissions', label: 'Assign Permissions', description: 'Override the permissions of an individual user' },
          { key: 'audit.view', label: 'View Audit Trail', description: 'Read the record of who changed what' },
        ],
      },
    ],
  },
  {
    label: 'Products',
    icon: '📦',
    permissions: [
      {
        key: 'view_products', label: 'View Products',
        description: 'Browse the product catalogue',
        children: [],
      },
      {
        key: 'manage_products', label: 'Manage Products',
        description: 'Create and edit products, categories, pricing',
        children: [
          { key: 'products.create', label: 'Create Products', description: 'Add new products to the catalogue' },
          { key: 'products.edit', label: 'Edit Products', description: 'Change product details, units and reorder levels' },
          { key: 'products.delete', label: 'Deactivate Products', description: 'Retire a product from the catalogue' },
          { key: 'products.set_price', label: 'Set Cost & Price', description: 'Change what a product costs and sells for' },
          { key: 'products.import', label: 'Import Products', description: 'Bulk-load products from a file' },
          { key: 'products.print_labels', label: 'Print Barcode Labels', description: 'Generate and print shelf or product labels' },
        ],
      },
    ],
  },
  {
    label: 'Inventory',
    icon: '🏭',
    permissions: [
      {
        key: 'view_inventory', label: 'View Stock',
        description: 'See current stock levels across warehouses',
        children: [],
      },
      {
        key: 'adjust_inventory', label: 'Adjust Stock',
        description: 'Manually add or remove stock quantities',
        children: [
          { key: 'inventory.write_off', label: 'Write Off Stock', description: 'Remove damaged or expired stock from the books' },
          { key: 'inventory.stock_take', label: 'Stock-take', description: 'Run a cycle count and post the differences' },
        ],
      },
      {
        key: 'transfer_stock', label: 'Transfer Stock',
        description: 'Move stock between warehouses',
        children: [],
      },
    ],
  },
  {
    label: 'Point of Sale',
    icon: '🛒',
    permissions: [
      {
        key: 'pos_checkout', label: 'POS Checkout',
        description: 'Process sales and print receipts at the cash register',
        children: [
          { key: 'pos.hold_bill', label: 'Hold & Resume Bills', description: 'Park a cart and pick it up again later' },
          { key: 'pos.reprint_receipt', label: 'Reprint Receipt', description: 'Print a duplicate of a receipt already issued' },
          { key: 'pos.void_sale', label: 'Void Sale', description: 'Cancel a sale at the till' },
        ],
      },
      {
        key: 'adjust_sale_price', label: 'Adjust Sale Price',
        description: 'Override product price per item in POS or invoice',
        children: [],
      },
    ],
  },
  {
    label: 'Purchases',
    icon: '🚚',
    permissions: [
      {
        key: 'view_purchases', label: 'View Purchases',
        description: 'See all purchase orders and their status',
        children: [],
      },
      {
        key: 'create_purchases', label: 'Create Purchases',
        description: 'Draft new purchase orders for suppliers',
        children: [
          { key: 'purchases.edit_draft', label: 'Edit Draft POs', description: 'Change a purchase order before it is confirmed' },
          { key: 'purchases.delete_draft', label: 'Delete Draft POs', description: 'Discard an unconfirmed purchase order' },
        ],
      },
      {
        key: 'confirm_purchases', label: 'Confirm & Receive',
        description: 'Confirm POs and receive stock into warehouse',
        children: [
          { key: 'purchases.receive_stock', label: 'Receive Stock (GRN)', description: 'Book a delivery in against a purchase order' },
          { key: 'purchases.record_payment', label: 'Pay Suppliers', description: 'Record a payment made against a purchase' },
          { key: 'purchases.return', label: 'Purchase Returns', description: 'Send goods back to a supplier' },
        ],
      },
    ],
  },
  {
    label: 'Sales',
    icon: '📄',
    permissions: [
      {
        key: 'view_sales', label: 'View Sales',
        description: 'See all sales invoices and their status',
        children: [],
      },
      {
        key: 'create_sales', label: 'Create Invoices',
        description: 'Create new sales invoices for customers',
        children: [
          { key: 'sales.edit_draft', label: 'Edit Draft Invoices', description: 'Change an invoice before it is confirmed' },
          { key: 'sales.delete_draft', label: 'Delete Draft Invoices', description: 'Discard an unconfirmed invoice' },
        ],
      },
      {
        key: 'confirm_sales', label: 'Confirm & Dispatch',
        description: 'Confirm invoices and deduct stock',
        children: [
          { key: 'sales.dispatch', label: 'Dispatch Goods', description: 'Confirm an invoice and take the stock out' },
        ],
      },
      {
        key: 'record_payments', label: 'Record Payments',
        description: 'Mark invoices as paid and record payment method',
        children: [
          { key: 'sales.refund', label: 'Refunds & Credit Notes', description: 'Return goods and give money back' },
        ],
      },
    ],
  },
  {
    label: 'Contacts',
    icon: '👥',
    permissions: [
      {
        key: 'view_contacts', label: 'View Contacts',
        description: 'Browse suppliers and customers',
        children: [],
      },
      {
        key: 'manage_contacts', label: 'Manage Contacts',
        description: 'Add and edit suppliers and customers',
        children: [
          { key: 'contacts.create', label: 'Create Contacts', description: 'Add customers and suppliers' },
          { key: 'contacts.edit', label: 'Edit Contacts', description: 'Change contact details and terms' },
          { key: 'contacts.deactivate', label: 'Deactivate Contacts', description: 'Retire a customer or supplier' },
        ],
      },
    ],
  },
  {
    label: 'Credit',
    icon: '💳',
    permissions: [
      {
        key: 'sell_on_credit', label: 'Sell on Credit',
        description: 'Make sales with CREDIT payment (paidCents = 0)',
        children: [],
      },
      {
        key: 'manage_credit', label: 'Manage Credit',
        description: 'Set credit limits and override credit blocks on customers',
        children: [],
      },
    ],
  },
  {
    label: 'Reports',
    icon: '📊',
    permissions: [
      {
        key: 'view_reports', label: 'View Reports',
        description: 'Access all sales, stock and financial reports',
        children: [
          { key: 'reports.sales', label: 'Sales Report', description: 'Revenue by period, warehouse and payment method' },
          { key: 'reports.purchases', label: 'Purchases Report', description: 'Spend by supplier and period' },
          { key: 'reports.products', label: 'Product Performance', description: 'Best sellers, with cost and margin' },
          { key: 'reports.customers', label: 'Customer Report', description: 'What each customer has spent' },
          { key: 'reports.inventory', label: 'Stock Valuation', description: 'What is on hand and what it is worth' },
          { key: 'reports.profit_loss', label: 'Profit & Loss', description: 'Revenue, cost of sales and gross profit' },
          { key: 'reports.aging', label: 'Receivables & Payables', description: 'Who owes money, and how overdue it is' },
          { key: 'reports.dashboard', label: 'Dashboard Figures', description: 'The headline numbers on the home screen' },
          { key: 'reports.export', label: 'Export Reports', description: 'Download report data as CSV' },
        ],
      },
    ],
  },
  {
    label: 'Settings',
    icon: '⚙️',
    permissions: [
      {
        key: 'view_settings', label: 'View Settings',
        description: 'View system settings (read-only)',
        children: [],
      },
      {
        key: 'manage_settings', label: 'Manage Settings',
        description: 'Edit system settings, categories, brands, units',
        children: [
          { key: 'settings.master_data', label: 'Master Data', description: 'Categories, brands and units of measure' },
          { key: 'settings.system', label: 'System Settings', description: 'Company details, currency, tax and behaviour' },
          { key: 'settings.warehouses', label: 'Warehouses', description: 'Add and edit stock locations' },
          { key: 'settings.receipt', label: 'Receipt Layout', description: 'What the printed receipt looks like' },
          { key: 'settings.alerts', label: 'Alert Rules', description: 'Low-stock and expiry alert thresholds' },
        ],
      },
    ],
  },
  {
    label: 'Shifts',
    icon: '🕐',
    permissions: [
      {
        key: 'manage_shifts', label: 'Manage Shifts',
        description: 'Open and close own POS shift',
        children: [],
      },
      {
        key: 'view_all_shifts', label: 'View All Shifts',
        description: 'View shift history for all users',
        children: [
          { key: 'shifts.force_close', label: 'Force-close Shifts', description: 'Close another user\'s till session' },
        ],
      },
    ],
  },
  {
    label: 'Super Admin',
    icon: '🛡️',
    permissions: [
      {
        key: 'manage_modules', label: 'Manage Modules',
        description: 'Super-admin only: enable/disable optional feature modules per client',
        children: [],
      },
      {
        key: 'clear_data', label: 'Clear System Data',
        description: 'Super-admin only: bulk-clear / reset system data',
        children: [],
      },
    ],
  },
];

export const ROLE_DEFAULTS: Record<UserRole, Permission[]> = {
  SUPER_ADMIN: [
    'manage_users',
    'view_products',
    'manage_products',
    'view_inventory',
    'adjust_inventory',
    'transfer_stock',
    'pos_checkout',
    'adjust_sale_price',
    'view_purchases',
    'create_purchases',
    'confirm_purchases',
    'view_sales',
    'create_sales',
    'confirm_sales',
    'record_payments',
    'view_contacts',
    'manage_contacts',
    'sell_on_credit',
    'manage_credit',
    'view_reports',
    'view_settings',
    'manage_settings',
    'manage_shifts',
    'view_all_shifts',
    'manage_modules',
    'clear_data',
    'users.view',
    'users.create',
    'users.edit',
    'users.deactivate',
    'users.permissions',
    'audit.view',
    'products.create',
    'products.edit',
    'products.delete',
    'products.set_price',
    'products.import',
    'products.print_labels',
    'inventory.write_off',
    'inventory.stock_take',
    'pos.hold_bill',
    'pos.reprint_receipt',
    'pos.void_sale',
    'purchases.edit_draft',
    'purchases.delete_draft',
    'purchases.receive_stock',
    'purchases.record_payment',
    'purchases.return',
    'sales.edit_draft',
    'sales.delete_draft',
    'sales.dispatch',
    'sales.refund',
    'contacts.create',
    'contacts.edit',
    'contacts.deactivate',
    'reports.sales',
    'reports.purchases',
    'reports.products',
    'reports.customers',
    'reports.inventory',
    'reports.profit_loss',
    'reports.aging',
    'reports.dashboard',
    'reports.export',
    'settings.master_data',
    'settings.system',
    'settings.warehouses',
    'settings.receipt',
    'settings.alerts',
    'shifts.force_close',
  ],
  ADMIN: [
    'manage_users',
    'view_products',
    'manage_products',
    'view_inventory',
    'adjust_inventory',
    'transfer_stock',
    'pos_checkout',
    'adjust_sale_price',
    'view_purchases',
    'create_purchases',
    'confirm_purchases',
    'view_sales',
    'create_sales',
    'confirm_sales',
    'record_payments',
    'view_contacts',
    'manage_contacts',
    'sell_on_credit',
    'manage_credit',
    'view_reports',
    'view_settings',
    'manage_settings',
    'manage_shifts',
    'view_all_shifts',
    'users.view',
    'users.create',
    'users.edit',
    'users.deactivate',
    'users.permissions',
    'audit.view',
    'products.create',
    'products.edit',
    'products.delete',
    'products.set_price',
    'products.import',
    'products.print_labels',
    'inventory.write_off',
    'inventory.stock_take',
    'pos.hold_bill',
    'pos.reprint_receipt',
    'pos.void_sale',
    'purchases.edit_draft',
    'purchases.delete_draft',
    'purchases.receive_stock',
    'purchases.record_payment',
    'purchases.return',
    'sales.edit_draft',
    'sales.delete_draft',
    'sales.dispatch',
    'sales.refund',
    'contacts.create',
    'contacts.edit',
    'contacts.deactivate',
    'reports.sales',
    'reports.purchases',
    'reports.products',
    'reports.customers',
    'reports.inventory',
    'reports.profit_loss',
    'reports.aging',
    'reports.dashboard',
    'reports.export',
    'settings.master_data',
    'settings.system',
    'settings.warehouses',
    'settings.receipt',
    'settings.alerts',
    'shifts.force_close',
  ],
  MANAGER: [
    'view_products',
    'manage_products',
    'view_inventory',
    'adjust_inventory',
    'transfer_stock',
    'pos_checkout',
    'adjust_sale_price',
    'view_purchases',
    'create_purchases',
    'confirm_purchases',
    'view_sales',
    'create_sales',
    'confirm_sales',
    'record_payments',
    'view_contacts',
    'manage_contacts',
    'sell_on_credit',
    'manage_credit',
    'view_reports',
    'view_settings',
    'manage_settings',
    'manage_shifts',
    'view_all_shifts',
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
    'reports.inventory',
    'reports.products',
    'view_settings',
  ],
};

// ─── User types ───────────────────────────────────────────────────────────────

export type UserRole = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'CASHIER' | 'STAFF';

export interface User {
  id: string;
  email: string;
  fullName: string;
  role: UserRole;
  permissions: Permission[] | null; // null = using role defaults
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface UserListResponse {
  total: number;
  page: number;
  pageSize: number;
  data: User[];
}

export interface UserStats {
  total: number;
  active: number;
  inactive: number;
  byRole: Partial<Record<UserRole, number>>;
}

export interface CreateUserPayload {
  fullName: string;
  email: string;
  password: string;
  role: UserRole;
  permissions?: Permission[] | null;
}

export interface UpdateUserPayload {
  fullName: string;
  email: string;
  role: UserRole;
  permissions?: Permission[] | null;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const usersApi = {
  stats: (): Promise<UserStats> =>
    api.get('/users/stats').then((r) => r.data),

  list: (params?: {
    search?: string;
    role?: UserRole;
    isActive?: boolean;
    page?: number;
    pageSize?: number;
  }): Promise<UserListResponse> =>
    api.get('/users', { params }).then((r) => r.data),

  getOne: (id: string): Promise<User> =>
    api.get(`/users/${id}`).then((r) => r.data),

  create: (payload: CreateUserPayload): Promise<User> =>
    api.post('/users', payload).then((r) => r.data),

  update: (id: string, payload: UpdateUserPayload): Promise<User> =>
    api.put(`/users/${id}`, payload).then((r) => r.data),

  changePassword: (id: string, newPassword: string): Promise<{ message: string }> =>
    api.patch(`/users/${id}/password`, { newPassword }).then((r) => r.data),

  toggleActive: (id: string): Promise<User> =>
    api.patch(`/users/${id}/toggle-active`).then((r) => r.data),

  updatePermissions: (id: string, permissions: Permission[] | null): Promise<User> =>
    api.patch(`/users/${id}/permissions`, { permissions }).then((r) => r.data),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const ROLE_LABELS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  CASHIER: 'Cashier',
  STAFF: 'Staff',
};

export const ROLE_COLORS: Record<UserRole, string> = {
  SUPER_ADMIN: 'bg-indigo-100 text-indigo-700 ring-1 ring-indigo-200',
  ADMIN: 'bg-red-100 text-red-700 ring-1 ring-red-200',
  MANAGER: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200',
  CASHIER: 'bg-purple-100 text-purple-700 ring-1 ring-purple-200',
  STAFF: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
};

export const ROLE_AVATAR_BG: Record<UserRole, string> = {
  SUPER_ADMIN: 'bg-indigo-600',
  ADMIN: 'bg-red-500',
  MANAGER: 'bg-blue-500',
  CASHIER: 'bg-purple-500',
  STAFF: 'bg-slate-400',
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
  SUPER_ADMIN: 'Vendor super-admin — controls feature modules per client + full access',
  ADMIN: 'Full access — manage users, all modules, all settings',
  MANAGER: 'Can create/confirm purchases, sales, adjustments. Cannot manage users.',
  CASHIER: 'POS checkout and payment recording only',
  STAFF: 'Read-only access to all modules',
};

/** Get initials from a full name, e.g. "John Doe" → "JD" */
export function getInitials(name: string): string {
  return name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .toUpperCase()
    .slice(0, 2);
}

/** Get the effective permissions for a user (custom if set, role default otherwise) */
export function getEffectivePermissions(user: User): Permission[] {
  if (user.permissions && user.permissions.length > 0) return user.permissions;
  return ROLE_DEFAULTS[user.role];
}

/** Check if a user has custom permissions (not matching role defaults) */
export function hasCustomPermissions(user: User): boolean {
  return user.permissions !== null && user.permissions !== undefined;
}

/** Check password strength — returns score 0-4 and tips */
export function checkPasswordStrength(password: string): {
  score: number;
  label: string;
  color: string;
  tips: string[];
} {
  const tips: string[] = [];
  let score = 0;

  if (password.length >= 8) score++;
  else tips.push('At least 8 characters');

  if (/[A-Z]/.test(password)) score++;
  else tips.push('At least one uppercase letter');

  if (/[0-9]/.test(password)) score++;
  else tips.push('At least one number');

  if (/[^a-zA-Z0-9]/.test(password)) score++;
  else tips.push('At least one special character (recommended)');

  const labels = ['Very Weak', 'Weak', 'Fair', 'Strong', 'Very Strong'];
  const colors = ['bg-red-500', 'bg-orange-500', 'bg-yellow-500', 'bg-green-500', 'bg-emerald-600'];

  return { score, label: labels[score], color: colors[score], tips };
}
