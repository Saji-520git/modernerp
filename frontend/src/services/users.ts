import { api } from './api';

// ─── Permission types (mirror backend) ───────────────────────────────────────

export const ALL_PERMISSIONS = [
  'manage_users',
  'view_products',
  'manage_products',
  'view_inventory',
  'adjust_inventory',
  'transfer_stock',
  'pos_checkout',
  'view_purchases',
  'create_purchases',
  'confirm_purchases',
  'view_sales',
  'create_sales',
  'confirm_sales',
  'record_payments',
  'view_contacts',
  'manage_contacts',
  'view_reports',
] as const;

export type Permission = (typeof ALL_PERMISSIONS)[number];

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
      { key: 'manage_users', label: 'Manage Users', description: 'Create, edit, deactivate accounts & change roles' },
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
      { key: 'pos_checkout', label: 'POS Checkout', description: 'Process sales and print receipts at the register' },
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
    label: 'Reports',
    icon: '📊',
    permissions: [
      { key: 'view_reports', label: 'View Reports', description: 'Access all sales, stock and financial reports' },
    ],
  },
];

export const ROLE_DEFAULTS: Record<UserRole, Permission[]> = {
  ADMIN: [...ALL_PERMISSIONS],
  MANAGER: [
    'view_products', 'manage_products',
    'view_inventory', 'adjust_inventory', 'transfer_stock',
    'pos_checkout',
    'view_purchases', 'create_purchases', 'confirm_purchases',
    'view_sales', 'create_sales', 'confirm_sales', 'record_payments',
    'view_contacts', 'manage_contacts',
    'view_reports',
  ],
  CASHIER: [
    'view_products', 'view_inventory', 'pos_checkout',
    'record_payments', 'view_sales', 'view_contacts',
  ],
  STAFF: [
    'view_products', 'view_inventory', 'view_purchases',
    'view_sales', 'view_contacts', 'view_reports',
  ],
};

// ─── User types ───────────────────────────────────────────────────────────────

export type UserRole = 'ADMIN' | 'MANAGER' | 'CASHIER' | 'STAFF';

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
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  CASHIER: 'Cashier',
  STAFF: 'Staff',
};

export const ROLE_COLORS: Record<UserRole, string> = {
  ADMIN: 'bg-red-100 text-red-700 ring-1 ring-red-200',
  MANAGER: 'bg-blue-100 text-blue-700 ring-1 ring-blue-200',
  CASHIER: 'bg-purple-100 text-purple-700 ring-1 ring-purple-200',
  STAFF: 'bg-slate-100 text-slate-600 ring-1 ring-slate-200',
};

export const ROLE_AVATAR_BG: Record<UserRole, string> = {
  ADMIN: 'bg-red-500',
  MANAGER: 'bg-blue-500',
  CASHIER: 'bg-purple-500',
  STAFF: 'bg-slate-400',
};

export const ROLE_DESCRIPTIONS: Record<UserRole, string> = {
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
