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

/** The full `Warehouse` entity the pages render. */
function shapeWarehouse(w: ReturnType<typeof db>['warehouses'][number]) {
  const d = db();
  return {
    id: w.id, name: w.name, code: w.code,
    address: null, city: w.city, phone: null, email: null,
    // The service's union is MAIN | BRANCH | STORE | TRANSIT | VIRTUAL.
    type: (w.type === 'WAREHOUSE' ? 'MAIN' : w.type) as 'MAIN' | 'BRANCH' | 'STORE' | 'TRANSIT' | 'VIRTUAL',
    isActive: w.isActive, isDefault: w.isDefault,
    notes: null, managerId: null, manager: null,
    createdAt: d.seededAt, updatedAt: d.seededAt,
    _count: {
      stock: d.stock.filter((s) => s.warehouseId === w.id && s.qty > 0).length,
      purchases: d.purchases.filter((p) => p.warehouseId === w.id).length,
      sales: d.sales.filter((s) => s.warehouseId === w.id).length,
      posShifts: d.shifts.filter((s) => s.warehouseId === w.id).length,
    },
  };
}

/**
 * `GET /warehouses` — a PAGED envelope keyed `items`, not `data`.
 *
 * `warehousesApi.list` returns WarehouseListResponse; the page reads
 * `data?.items ?? []`. Returning a bare array here left the Warehouses page
 * showing its "No warehouses found" empty state over two seeded locations.
 * The bare-array form still exists, but only where its callers want it —
 * see `listWarehousesBare`.
 */
export const listWarehouses: DemoHandler = ({ query }) => {
  let rows = db().warehouses.filter((w) => matches([w.name, w.code, w.city], query.search));
  if (query.type) rows = rows.filter((w) => w.type === query.type);
  if (query.isActive === 'true') rows = rows.filter((w) => w.isActive);
  if (query.isActive === 'false') rows = rows.filter((w) => !w.isActive);
  const page = Math.max(1, parseInt(query.page ?? '1', 10) || 1);
  const pageSize = Math.max(1, parseInt(query.pageSize ?? '50', 10) || 50);
  return {
    items: rows.slice((page - 1) * pageSize, page * pageSize).map(shapeWarehouse),
    total: rows.length, page, pageSize,
  };
};

/**
 * `GET /inventory/warehouses` and `GET /pos/warehouses` — a bare array.
 * Two endpoints, two shapes; they cannot share one handler.
 */
export const listWarehousesBare: DemoHandler = () => db().warehouses.map(shapeWarehouse);

export const warehouseStats: DemoHandler = ({ params }) => {
  const d = db();
  const rows = d.stock.filter((s) => s.warehouseId === params.id);
  return {
    totalProducts: rows.filter((r) => r.qty > 0).length,
    totalUnits: rows.reduce((n, s) => n + s.qty, 0),
    openShifts: d.shifts.filter((s) => s.warehouseId === params.id && s.status === 'OPEN').length,
    recentMovements: d.movements
      .filter((m) => m.warehouseId === params.id)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 10)
      .map((m) => {
        const p = d.products.find((x) => x.id === m.productId);
        return {
          id: m.id, type: m.type, qty: m.qty, createdAt: m.createdAt,
          product: { name: p?.name ?? 'Unknown', sku: p?.sku ?? '—' },
        };
      }),
  };
};

/** `GET /warehouses/:id` — WarehouseWithStock: the entity plus its stock rows. */
export const getWarehouse: DemoHandler = ({ params }) => {
  const d = db();
  const w = d.warehouses.find((x) => x.id === params.id);
  if (!w) throw new DemoHttpError(404, 'Warehouse not found');
  return {
    ...shapeWarehouse(w),
    stock: d.stock
      .filter((s) => s.warehouseId === w.id && s.qty > 0)
      .map((s) => {
        const p = d.products.find((x) => x.id === s.productId);
        return {
          qty: s.qty,
          product: {
            id: s.productId, name: p?.name ?? 'Unknown', sku: p?.sku ?? '—',
            costCents: p?.costCents ?? 0,
          },
        };
      })
      .sort((a, b) => a.product.name.localeCompare(b.product.name)),
  };
};

export const createWarehouse: DemoHandler = ({ body }) => {
  const d = db();
  const name = String(body?.name ?? '').trim();
  const code = String(body?.code ?? '').trim().toUpperCase();
  if (!name) throw new DemoHttpError(400, 'Name is required');
  if (!code) throw new DemoHttpError(400, 'Code is required');
  if (d.warehouses.some((w) => w.code.toUpperCase() === code)) {
    throw new DemoHttpError(409, `Code ${code} is already in use.`);
  }
  const w = {
    id: nextId('wh'), name, code,
    city: body?.city ?? null, type: String(body?.type ?? 'WAREHOUSE'),
    isDefault: false, isActive: true,
  };
  d.warehouses.push(w);
  // A new location starts with a stock row per product, at zero, so it appears
  // in Stock Overview instead of being invisible until something moves.
  for (const p of d.products) d.stock.push({ productId: p.id, warehouseId: w.id, qty: 0, shortfallQty: 0 });
  return shapeWarehouse(w);
};

export const updateWarehouse: DemoHandler = ({ params, body }) => {
  const w = db().warehouses.find((x) => x.id === params.id);
  if (!w) throw new DemoHttpError(404, 'Warehouse not found');
  if (body?.name) w.name = String(body.name);
  if (body?.code) w.code = String(body.code).toUpperCase();
  if (body?.city !== undefined) w.city = body.city;
  if (body?.type) w.type = String(body.type);
  return shapeWarehouse(w);
};

export const setDefaultWarehouse: DemoHandler = ({ params }) => {
  const d = db();
  d.warehouses.forEach((w) => { w.isDefault = w.id === params.id; });
  const w = d.warehouses.find((x) => x.id === params.id);
  if (!w) throw new DemoHttpError(404, 'Warehouse not found');
  return shapeWarehouse(w);
};

export const toggleWarehouse: DemoHandler = ({ params }) => {
  const w = db().warehouses.find((x) => x.id === params.id);
  if (!w) throw new DemoHttpError(404, 'Warehouse not found');
  w.isActive = !w.isActive;
  return shapeWarehouse(w);
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

export const getUnit: DemoHandler = ({ params }) => {
  const u = db().units.find((x) => x.id === params.id);
  if (!u) throw new DemoHttpError(404, 'Unit not found');
  return { ...u, isActive: true, _count: { productsBase: db().products.filter((p) => p.unitId === u.id).length } };
};
