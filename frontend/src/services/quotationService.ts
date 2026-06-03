/// <reference types="vite/client" />
import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import type { SendResult } from '../types/whatsapp';
import type {
  Quotation, QuotationStats, QuotationFilters,
  CreateQuotationDto, UpdateQuotationDto, QuotationStatus,
} from '../types/quotation';

// Quotations live under /api/v2 — derive a v2 base from the same env var as v1.
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

export const quotationService = {
  list: (filters?: QuotationFilters): Promise<Quotation[]> =>
    unwrap<Quotation[]>(v2.get('/quotations', { params: filters })),

  stats: (): Promise<QuotationStats> =>
    unwrap<QuotationStats>(v2.get('/quotations/stats')),

  get: (id: string): Promise<Quotation> =>
    unwrap<Quotation>(v2.get(`/quotations/${id}`)),

  create: (data: CreateQuotationDto): Promise<Quotation> =>
    unwrap<Quotation>(v2.post('/quotations', data)),

  update: (id: string, data: UpdateQuotationDto): Promise<Quotation> =>
    unwrap<Quotation>(v2.put(`/quotations/${id}`, data)),

  remove: (id: string): Promise<{ id: string }> =>
    unwrap<{ id: string }>(v2.delete(`/quotations/${id}`)),

  setStatus: (id: string, status: QuotationStatus): Promise<Quotation> =>
    unwrap<Quotation>(v2.post(`/quotations/${id}/status`, { status })),

  convert: (id: string): Promise<{ quotation: Quotation; sale: { id: string; number: string } }> =>
    unwrap<{ quotation: Quotation; sale: { id: string; number: string } }>(
      v2.post(`/quotations/${id}/convert`),
    ),

  duplicate: (id: string): Promise<Quotation> =>
    unwrap<Quotation>(v2.post(`/quotations/${id}/duplicate`)),

  sendWhatsApp: (id: string): Promise<SendResult> =>
    unwrap<SendResult>(v2.post(`/quotations/${id}/send-whatsapp`)),
};
