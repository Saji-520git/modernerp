// ─── Auth, settings, master data, warehouses, users ──────────────────────────

import { DemoHttpError, type DemoHandler } from '../http';
import { db, paginate, matches, warehouseById } from '../support';
import { nextId } from '../db';
import { ROLE_PERMISSIONS } from '../permissions';

// ─── Auth ────────────────────────────────────────────────────────────────────

export const login: DemoHandler = ({ body }) => {
  const email = String(body?.email ?? '').trim().toLowerCase();
  const password = String(body?.password ?? '');
  const user = db().users.find((u) => u.email.toLowerCase() === email);

  // Same message for a wrong address and a wrong password — the real API does
  // not tell an attacker which half was right, and the demo should not either.
  if (!user || user.password !== password) {
    throw new DemoHttpError(401, 'Invalid credentials. Please try again.');
  }
  if (!user.isActive) throw new DemoHttpError(401, 'This account has been deactivated.');

  user.lastLoginAt = new Date().toISOString();

  return {
    user: {
      id: user.id, email: user.email, fullName: user.fullName, role: user.role,
      permissions: user.permissions ?? ROLE_PERMISSIONS[user.role],
    },
    // Not a JWT and not pretending to be one. Nothing verifies it; the demo has
    // no server. It exists because the axios interceptor and the auth guard
    // both key off a truthy token.
    access: `demo-session-${user.id}`,
    refresh: `demo-refresh-${user.id}`,
  };
};

/**
 * Session revalidation on startup (App.tsx calls this before first paint).
 *
 * The demo has no server session, so "who am I" is answered from the persisted
 * auth store. A 401 here is meaningful: the axios interceptor logs the visitor
 * out, which is exactly what should happen if the stored user no longer exists
 * — for instance after a reset that rebuilt the user table.
 */
export const me: DemoHandler = () => {
  let id: string | null = null;
  try {
    const raw = localStorage.getItem('modernerp-auth');
    id = raw ? JSON.parse(raw)?.state?.user?.id ?? null : null;
  } catch { /* treated as signed out */ }

  const user = db().users.find((u) => u.id === id);
  if (!user || !user.isActive) throw new DemoHttpError(401, 'Session expired');

  return {
    id: user.id, email: user.email, fullName: user.fullName, role: user.role,
    permissions: user.permissions ?? ROLE_PERMISSIONS[user.role],
  };
};

// ─── Settings ────────────────────────────────────────────────────────────────

export const getSettings: DemoHandler = () => db().settings;

export const patchSettings: DemoHandler = ({ body }) => {
  const d = db();
  // moduleFlags are super-admin-only on the real API; the demo keeps them fixed
  // so a visitor cannot switch on a module that has no seeded data behind it.
  const { moduleFlags: _ignored, ...rest } = (body ?? {}) as Record<string, unknown>;
  d.settings = { ...d.settings, ...rest };
  return d.settings;
};

// ─── Master data (categories / brands / units) ───────────────────────────────

const collectionFor = (kind: string) => {
  const d = db() as unknown as Record<string, { id: string; name: string }[]>;
  if (kind === 'categories') return d.categories;
  if (kind === 'brands') return d.brands;
  if (kind === 'units') return d.units;
  throw new DemoHttpError(404, 'Unknown master-data collection');
};

export const listMaster = (kind: string): DemoHandler => () => {
  const rows = collectionFor(kind);
  if (kind === 'units') return rows;
  // Categories and brands carry a usage count in the real API.
  return rows.map((r) => ({
    ...r,
    parentId: null,
    _count: { products: db().products.filter((p) => (kind === 'categories' ? p.categoryId : p.brandId) === r.id).length },
  }));
};

export const createMaster = (kind: string): DemoHandler => ({ body }) => {
  const rows = collectionFor(kind);
  const name = String(body?.name ?? '').trim();
  if (!name) throw new DemoHttpError(400, 'Name is required');
  if (rows.some((r) => r.name.toLowerCase() === name.toLowerCase())) {
    throw new DemoHttpError(409, `A record named "${name}" already exists.`);
  }
  const row: any = { id: nextId(kind.slice(0, 3)), name };
  if (kind === 'units') {
    row.shortCode = String(body?.shortCode ?? name.slice(0, 3)).trim();
    row.allowDecimal = !!body?.allowDecimal;
    row.type = body?.type ?? 'COUNT';
    row.isActive = true;
  }
  rows.push(row);
  return row;
};

export const updateMaster = (kind: string): DemoHandler => ({ params, body }) => {
  const row = collectionFor(kind).find((r) => r.id === params.id);
  if (!row) throw new DemoHttpError(404, 'Not found');
  Object.assign(row, body ?? {});
  return row;
};

export const deleteMaster = (kind: string): DemoHandler => ({ params }) => {
  const rows = collectionFor(kind);
  const i = rows.findIndex((r) => r.id === params.id);
  if (i < 0) throw new DemoHttpError(404, 'Not found');
  const inUse = db().products.some(
    (p) => (kind === 'categories' ? p.categoryId : kind === 'brands' ? p.brandId : p.unitId) === params.id,
  );
  if (inUse) throw new DemoHttpError(409, 'In use by one or more products — reassign them first.');
  rows.splice(i, 1);
  return { success: true };
};

// ─── Units (the newer units module) ──────────────────────────────────────────

export const listUnits: DemoHandler = ({ query }) => {
  const rows = db().units.map((u) => ({
    ...u, isActive: true,
    _count: { productsBase: db().products.filter((p) => p.unitId === u.id).length },
  }));
  const filtered = rows.filter((u) => matches([u.name, u.shortCode], query.search));
  return { total: filtered.length, page: 1, pageSize: filtered.length, data: filtered };
};

// ─── Warehouses ──────────────────────────────────────────────────────────────

export const listWarehouses: DemoHandler = () =>
  db().warehouses.map((w) => ({
    ...w,
    _count: { stock: db().stock.filter((s) => s.warehouseId === w.id && s.qty > 0).length },
  }));

export const warehouseStats: DemoHandler = ({ params }) => {
  const d = db();
  const rows = d.stock.filter((s) => s.warehouseId === params.id);
  const valueCents = rows.reduce((n, s) => {
    const p = d.products.find((x) => x.id === s.productId);
    return n + s.qty * (p?.costCents ?? 0);
  }, 0);
  return {
    warehouse: warehouseById(params.id),
    productCount: rows.filter((r) => r.qty > 0).length,
    totalQty: rows.reduce((n, s) => n + s.qty, 0),
    stockValueCents: valueCents,
    lowStockCount: rows.filter((s) => {
      const p = d.products.find((x) => x.id === s.productId);
      return p ? s.qty <= p.reorderLevel : false;
    }).length,
  };
};

export const setDefaultWarehouse: DemoHandler = ({ params }) => {
  const d = db();
  d.warehouses.forEach((w) => { w.isDefault = w.id === params.id; });
  return d.warehouses.find((w) => w.id === params.id);
};

export const toggleWarehouse: DemoHandler = ({ params }) => {
  const w = db().warehouses.find((x) => x.id === params.id);
  if (!w) throw new DemoHttpError(404, 'Warehouse not found');
  w.isActive = !w.isActive;
  return w;
};

// ─── Users ───────────────────────────────────────────────────────────────────

function shapeUser(u: ReturnType<typeof db>['users'][number]) {
  return {
    id: u.id, email: u.email, fullName: u.fullName, role: u.role,
    permissions: u.permissions, isActive: u.isActive,
    createdAt: u.createdAt, updatedAt: u.createdAt, lastLoginAt: u.lastLoginAt,
    _count: { sales: db().sales.filter((s) => s.createdById === u.id).length },
  };
}

export const listUsers: DemoHandler = ({ query }) => {
  let rows = db().users.filter((u) => matches([u.fullName, u.email], query.search));
  if (query.role) rows = rows.filter((u) => u.role === query.role);
  if (query.isActive === 'true') rows = rows.filter((u) => u.isActive);
  if (query.isActive === 'false') rows = rows.filter((u) => !u.isActive);
  const page = paginate(rows.map(shapeUser), query);
  return page;
};

export const userStats: DemoHandler = () => {
  const rows = db().users;
  const byRole: Record<string, number> = {};
  for (const u of rows) byRole[u.role] = (byRole[u.role] ?? 0) + 1;
  return {
    total: rows.length,
    active: rows.filter((u) => u.isActive).length,
    inactive: rows.filter((u) => !u.isActive).length,
    byRole,
  };
};

export const getUser: DemoHandler = ({ params }) => {
  const u = db().users.find((x) => x.id === params.id);
  if (!u) throw new DemoHttpError(404, 'User not found');
  return shapeUser(u);
};

export const createUser: DemoHandler = ({ body }) => {
  const d = db();
  const email = String(body?.email ?? '').trim().toLowerCase();
  if (!email) throw new DemoHttpError(400, 'Email is required');
  if (d.users.some((u) => u.email.toLowerCase() === email)) {
    throw new DemoHttpError(409, 'That email address is already in use.');
  }
  const u = {
    id: nextId('usr'), email, password: String(body?.password ?? 'Demo@2026'),
    fullName: String(body?.fullName ?? 'New User'),
    role: (body?.role ?? 'STAFF') as 'ADMIN' | 'MANAGER' | 'CASHIER' | 'STAFF',
    permissions: (body?.permissions ?? null) as string[] | null,
    isActive: true, createdAt: new Date().toISOString(), lastLoginAt: null,
  };
  d.users.push(u);
  return shapeUser(u);
};

export const updateUser: DemoHandler = ({ params, body }) => {
  const u = db().users.find((x) => x.id === params.id);
  if (!u) throw new DemoHttpError(404, 'User not found');
  if (body?.fullName) u.fullName = String(body.fullName);
  if (body?.email) u.email = String(body.email);
  if (body?.role) u.role = body.role;
  if ('permissions' in (body ?? {})) u.permissions = body.permissions;
  return shapeUser(u);
};

export const toggleUser: DemoHandler = ({ params }) => {
  const u = db().users.find((x) => x.id === params.id);
  if (!u) throw new DemoHttpError(404, 'User not found');
  u.isActive = !u.isActive;
  return shapeUser(u);
};

export const setUserPermissions: DemoHandler = ({ params, body }) => {
  const u = db().users.find((x) => x.id === params.id);
  if (!u) throw new DemoHttpError(404, 'User not found');
  u.permissions = body?.permissions ?? null;
  return shapeUser(u);
};

export const changePassword: DemoHandler = ({ params, body }) => {
  const u = db().users.find((x) => x.id === params.id);
  if (!u) throw new DemoHttpError(404, 'User not found');
  u.password = String(body?.newPassword ?? u.password);
  return { message: 'Password updated.' };
};
