import { api } from './api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Category { id: string; name: string; _count?: { products: number } }
export interface Brand     { id: string; name: string; _count?: { products: number } }
export interface Unit      { id: string; name: string; shortCode: string; allowDecimal: boolean; _count?: { products: number } }

// ─── Categories ───────────────────────────────────────────────────────────────

export const categoriesApi = {
  list: (): Promise<Category[]> =>
    api.get('/master-data/categories').then((r) => r.data),
  create: (name: string): Promise<Category> =>
    api.post('/master-data/categories', { name }).then((r) => r.data),
  update: (id: string, name: string): Promise<Category> =>
    api.patch(`/master-data/categories/${id}`, { name }).then((r) => r.data),
  delete: (id: string): Promise<{ success: boolean }> =>
    api.delete(`/master-data/categories/${id}`).then((r) => r.data),
};

// ─── Brands ───────────────────────────────────────────────────────────────────

export const brandsApi = {
  list: (): Promise<Brand[]> =>
    api.get('/master-data/brands').then((r) => r.data),
  create: (name: string): Promise<Brand> =>
    api.post('/master-data/brands', { name }).then((r) => r.data),
  update: (id: string, name: string): Promise<Brand> =>
    api.patch(`/master-data/brands/${id}`, { name }).then((r) => r.data),
  delete: (id: string): Promise<{ success: boolean }> =>
    api.delete(`/master-data/brands/${id}`).then((r) => r.data),
};

// ─── Units ────────────────────────────────────────────────────────────────────

export const unitsApi = {
  list: (): Promise<Unit[]> =>
    api.get('/master-data/units').then((r) => r.data),
  create: (name: string, shortCode: string, allowDecimal: boolean): Promise<Unit> =>
    api.post('/master-data/units', { name, shortCode, allowDecimal }).then((r) => r.data),
  update: (id: string, name: string, shortCode: string, allowDecimal: boolean): Promise<Unit> =>
    api.patch(`/master-data/units/${id}`, { name, shortCode, allowDecimal }).then((r) => r.data),
  delete: (id: string): Promise<{ success: boolean }> =>
    api.delete(`/master-data/units/${id}`).then((r) => r.data),
};
