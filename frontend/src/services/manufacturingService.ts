/// <reference types="vite/client" />
import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import type {
  BOM, CreateBOMDto, UpdateBOMDto,
  ProductionOrder, CreateProductionOrderDto, ProductionFilters, ProductionStats,
} from '../types/manufacturing';

// Manufacturing lives under /api/v2 — derive a v2 base from the same env var as v1.
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

interface ApiEnvelope<T> {
  success: boolean;
  data: T;
  message: string;
}

const unwrap = <T>(p: Promise<{ data: ApiEnvelope<T> }>): Promise<T> => p.then((r) => r.data.data);

export const manufacturingService = {
  // ─── BOM ────────────────────────────────────────────────────────────────────
  listBOMs: (): Promise<BOM[]> =>
    unwrap<BOM[]>(v2.get('/manufacturing/boms')),

  getBOM: (id: string): Promise<BOM> =>
    unwrap<BOM>(v2.get(`/manufacturing/boms/${id}`)),

  getBOMByProduct: (productId: string): Promise<BOM | null> =>
    unwrap<BOM | null>(v2.get(`/manufacturing/boms/by-product/${productId}`)),

  createBOM: (data: CreateBOMDto): Promise<BOM> =>
    unwrap<BOM>(v2.post('/manufacturing/boms', data)),

  updateBOM: (id: string, data: UpdateBOMDto): Promise<BOM> =>
    unwrap<BOM>(v2.put(`/manufacturing/boms/${id}`, data)),

  removeBOM: (id: string): Promise<{ id: string }> =>
    unwrap<{ id: string }>(v2.delete(`/manufacturing/boms/${id}`)),

  // ─── Production orders ────────────────────────────────────────────────────────
  listOrders: (filters?: ProductionFilters): Promise<ProductionOrder[]> =>
    unwrap<ProductionOrder[]>(v2.get('/manufacturing/orders', { params: filters })),

  productionStats: (): Promise<ProductionStats> =>
    unwrap<ProductionStats>(v2.get('/manufacturing/orders/stats')),

  getOrder: (id: string): Promise<ProductionOrder> =>
    unwrap<ProductionOrder>(v2.get(`/manufacturing/orders/${id}`)),

  createOrder: (data: CreateProductionOrderDto): Promise<ProductionOrder> =>
    unwrap<ProductionOrder>(v2.post('/manufacturing/orders', data)),

  startOrder: (id: string): Promise<ProductionOrder> =>
    unwrap<ProductionOrder>(v2.post(`/manufacturing/orders/${id}/start`)),

  completeOrder: (id: string): Promise<ProductionOrder> =>
    unwrap<ProductionOrder>(v2.post(`/manufacturing/orders/${id}/complete`)),

  cancelOrder: (id: string): Promise<ProductionOrder> =>
    unwrap<ProductionOrder>(v2.post(`/manufacturing/orders/${id}/cancel`)),
};
