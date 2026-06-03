/// <reference types="vite/client" />
import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import type {
  Delivery, DeliveryStats, DeliveryFilters,
  CreateDeliveryDto, UpdateDeliveryDto, DeliveryStatus,
} from '../types/delivery';

// Deliveries live under /api/v2 — derive a v2 base from the same env var as v1.
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

export const deliveryService = {
  list: (filters?: DeliveryFilters): Promise<Delivery[]> =>
    unwrap<Delivery[]>(v2.get('/deliveries', { params: filters })),

  stats: (): Promise<DeliveryStats> =>
    unwrap<DeliveryStats>(v2.get('/deliveries/stats')),

  pending: (): Promise<Delivery[]> =>
    unwrap<Delivery[]>(v2.get('/deliveries/pending')),

  get: (id: string): Promise<Delivery> =>
    unwrap<Delivery>(v2.get(`/deliveries/${id}`)),

  create: (data: CreateDeliveryDto): Promise<Delivery> =>
    unwrap<Delivery>(v2.post('/deliveries', data)),

  update: (id: string, data: UpdateDeliveryDto): Promise<Delivery> =>
    unwrap<Delivery>(v2.put(`/deliveries/${id}`, data)),

  setStatus: (id: string, status: DeliveryStatus): Promise<Delivery> =>
    unwrap<Delivery>(v2.post(`/deliveries/${id}/status`, { status })),
};
