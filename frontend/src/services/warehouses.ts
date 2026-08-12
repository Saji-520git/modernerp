import { api } from './api';
import type { MovementType } from './inventory';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Warehouse {
  id:        string;
  name:      string;
  code:      string;
  address:   string | null;
  city:      string | null;
  phone:     string | null;
  email:     string | null;
  type:      'MAIN' | 'BRANCH' | 'STORE' | 'TRANSIT' | 'VIRTUAL';
  isActive:  boolean;
  isDefault: boolean;
  notes:     string | null;
  managerId: string | null;
  manager:   { id: string; fullName: string; email: string } | null;
  createdAt: string;
  updatedAt: string;
  _count: {
    stock:     number;
    purchases: number;
    sales:     number;
    posShifts: number;
  };
}

export interface WarehouseWithStock extends Warehouse {
  stock: {
    qty: number;
    product: { id: string; name: string; sku: string; costCents: number };
  }[];
}

export interface WarehouseStats {
  totalProducts: number;
  totalUnits:    number;
  openShifts:    number;
  recentMovements: {
    id:        string;
    type:      MovementType;
    qty:       number;
    createdAt: string;
    product:   { name: string; sku: string };
  }[];
}

export interface WarehouseListResponse {
  items:    Warehouse[];
  total:    number;
  page:     number;
  pageSize: number;
}

export type CreateWarehouseBody = {
  name:       string;
  code:       string;
  address?:   string | null;
  city?:      string | null;
  phone?:     string | null;
  email?:     string | null;
  managerId?: string | null;
  type?:      Warehouse['type'];
  isDefault?: boolean;
  notes?:     string | null;
};

// ─── API ──────────────────────────────────────────────────────────────────────

export const warehousesApi = {
  list: (params?: {
    page?: number; pageSize?: number;
    search?: string; type?: string; isActive?: boolean;
  }): Promise<WarehouseListResponse> =>
    api.get('/warehouses', { params }).then((r) => r.data),

  get: (id: string): Promise<WarehouseWithStock> =>
    api.get(`/warehouses/${id}`).then((r) => r.data),

  getStats: (id: string): Promise<WarehouseStats> =>
    api.get(`/warehouses/${id}/stats`).then((r) => r.data),

  create: (data: CreateWarehouseBody): Promise<Warehouse> =>
    api.post('/warehouses', data).then((r) => r.data),

  update: (id: string, data: Partial<CreateWarehouseBody>): Promise<Warehouse> =>
    api.patch(`/warehouses/${id}`, data).then((r) => r.data),

  toggle: (id: string): Promise<Warehouse> =>
    api.post(`/warehouses/${id}/toggle`).then((r) => r.data),

  setDefault: (id: string): Promise<Warehouse> =>
    api.post(`/warehouses/${id}/set-default`).then((r) => r.data),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const WAREHOUSE_TYPE_LABELS: Record<Warehouse['type'], string> = {
  MAIN:    'Main',
  BRANCH:  'Branch',
  STORE:   'Store',
  TRANSIT: 'Transit',
  VIRTUAL: 'Virtual',
};

export const WAREHOUSE_TYPE_COLORS: Record<Warehouse['type'], string> = {
  MAIN:    'bg-blue-100 text-blue-700',
  BRANCH:  'bg-green-100 text-green-700',
  STORE:   'bg-amber-100 text-amber-700',
  TRANSIT: 'bg-purple-100 text-purple-700',
  VIRTUAL: 'bg-slate-100 text-slate-600',
};
