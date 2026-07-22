// ─── Role helpers ────────────────────────────────────────────────────────────
// SUPER_ADMIN is a strict superset of ADMIN. Every role-literal check must treat
// it as admin-or-above, so the vendor super-admin is never denied a client
// admin/manager feature (e.g. exiting POS, adjusting price, managing shifts).

export type AppRole = 'SUPER_ADMIN' | 'ADMIN' | 'MANAGER' | 'CASHIER' | 'STAFF';

export const isSuperAdmin = (role?: string | null): boolean => role === 'SUPER_ADMIN';

/** Admin-level: ADMIN or SUPER_ADMIN. */
export const isAdminRole = (role?: string | null): boolean =>
  role === 'ADMIN' || role === 'SUPER_ADMIN';

/** Manager-or-above: MANAGER, ADMIN, or SUPER_ADMIN. */
export const isManagerOrAbove = (role?: string | null): boolean =>
  role === 'MANAGER' || role === 'ADMIN' || role === 'SUPER_ADMIN';
