/// <reference types="vite/client" />
import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import type { ModuleFlags } from '../store/appStore';

// Tenant management lives under /api/v2 — reuse the same v2 base + auth flow as
// services/config.ts.
const v1Base = import.meta.env.VITE_API_URL ?? 'http://localhost:4000/api/v1';
const v2Base = v1Base.replace('/api/v1', '/api/v2');

const v2 = axios.create({ baseURL: v2Base });

v2.interceptors.request.use((config) => {
  const token = useAuthStore.getState().accessToken;
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

v2.interceptors.response.use(
  (r) => r,
  (err) => {
    if (err.response?.status === 401) useAuthStore.getState().logout();
    return Promise.reject(err);
  },
);

export type TenantPlan = 'starter' | 'standard' | 'business' | 'enterprise';

export interface Tenant {
  id: string;
  name: string;
  slug: string;
  plan: string;
  isActive: boolean;
  maxUsers: number;
  modules: ModuleFlags;
  settings: Record<string, unknown>;
  trialEndsAt: string | null;
  createdAt: string;
  updatedAt: string;
  userCount?: number;
}

export interface RegisterTenantInput {
  name: string;
  slug?: string;
  plan?: TenantPlan;
  adminEmail: string;
  adminPassword: string;
  adminName: string;
}

export interface UpdateTenantInput {
  name?: string;
  plan?: TenantPlan;
  isActive?: boolean;
  maxUsers?: number;
  modules?: Partial<ModuleFlags>;
  settings?: Record<string, unknown>;
}

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message: string;
}

export const tenantsApi = {
  list: (): Promise<Tenant[]> =>
    v2.get<ApiEnvelope<Tenant[]>>('/tenants').then((r) => r.data.data),

  get: (id: string): Promise<Tenant> =>
    v2.get<ApiEnvelope<Tenant>>(`/tenants/${id}`).then((r) => r.data.data),

  register: (input: RegisterTenantInput): Promise<{ tenant: Tenant; token: string }> =>
    v2
      .post<ApiEnvelope<{ tenant: Tenant; token: string }>>('/tenants/register', input)
      .then((r) => r.data.data),

  update: (id: string, input: UpdateTenantInput): Promise<Tenant> =>
    v2.put<ApiEnvelope<Tenant>>(`/tenants/${id}`, input).then((r) => r.data.data),

  updateModules: (id: string, modules: Partial<ModuleFlags>): Promise<Tenant> =>
    v2.post<ApiEnvelope<Tenant>>(`/tenants/${id}/modules`, { modules }).then((r) => r.data.data),

  deactivate: (id: string): Promise<Tenant> =>
    v2.post<ApiEnvelope<Tenant>>(`/tenants/${id}/deactivate`, {}).then((r) => r.data.data),
};
