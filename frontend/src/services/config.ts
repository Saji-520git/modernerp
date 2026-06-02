/// <reference types="vite/client" />
import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import type { ModuleFlags } from '../store/appStore';

// The shared `api` instance targets /api/v1. Module-flag endpoints live under
// /api/v2, so derive a v2 base from the same env var and reuse the auth flow.
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

export interface ClientInfo {
  clientName: string;
  businessType: string;
}

export type BusinessType = 'grocery' | 'hardware' | 'bakery' | 'repairs' | 'clothing' | 'general';

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message: string;
}

export const configApi = {
  getModules: (): Promise<ModuleFlags> =>
    v2.get<ApiEnvelope<ModuleFlags>>('/config/modules').then((r) => r.data.data),

  getClient: (): Promise<ClientInfo> =>
    v2.get<ApiEnvelope<ClientInfo>>('/config/client').then((r) => r.data.data),

  updateModules: (modules: Partial<ModuleFlags>): Promise<ModuleFlags> =>
    v2.put<ApiEnvelope<ModuleFlags>>('/config/modules', { modules }).then((r) => r.data.data),

  updateClient: (data: Partial<ClientInfo>): Promise<ClientInfo> =>
    v2.put<ApiEnvelope<ClientInfo>>('/config/client', data).then((r) => r.data.data),

  applyTemplate: (template: BusinessType): Promise<{ businessType: string; modules: ModuleFlags }> =>
    v2
      .post<ApiEnvelope<{ businessType: string; modules: ModuleFlags }>>('/config/template', { template })
      .then((r) => r.data.data),
};
