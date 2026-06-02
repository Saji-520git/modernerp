/// <reference types="vite/client" />
import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import type {
  WhatsAppConfig, UpdateWhatsAppConfigDto,
  WhatsAppTemplate, UpdateTemplateDto,
  WhatsAppLog, SendResult, BroadcastResult, TemplateLanguage,
} from '../types/whatsapp';

// WhatsApp lives under /api/v2 — derive a v2 base from the same env var as v1.
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

export const whatsappService = {
  // ── Config ──
  getConfig: (): Promise<WhatsAppConfig> =>
    unwrap<WhatsAppConfig>(v2.get('/whatsapp/config')),

  updateConfig: (data: UpdateWhatsAppConfigDto): Promise<WhatsAppConfig> =>
    unwrap<WhatsAppConfig>(v2.put('/whatsapp/config', data)),

  testConnection: (): Promise<SendResult> =>
    unwrap<SendResult>(v2.post('/whatsapp/config/test')),

  // ── Templates ──
  getTemplates: (): Promise<WhatsAppTemplate[]> =>
    unwrap<WhatsAppTemplate[]>(v2.get('/whatsapp/templates')),

  updateTemplate: (id: string, data: UpdateTemplateDto): Promise<WhatsAppTemplate> =>
    unwrap<WhatsAppTemplate>(v2.put(`/whatsapp/templates/${id}`, data)),

  seedTemplates: (): Promise<{ created: number }> =>
    unwrap<{ created: number }>(v2.post('/whatsapp/templates/seed')),

  // ── Messaging ──
  sendReceipt: (saleId: string, language: TemplateLanguage = 'en'): Promise<SendResult> =>
    unwrap<SendResult>(v2.post('/whatsapp/send/receipt', { saleId, language })),

  sendReminder: (customerId: string): Promise<SendResult> =>
    unwrap<SendResult>(v2.post('/whatsapp/send/reminder', { customerId })),

  sendDailySummary: (date?: string): Promise<SendResult> =>
    unwrap<SendResult>(v2.post('/whatsapp/send/daily-summary', date ? { date } : {})),

  sendLowStockAlert: (): Promise<SendResult> =>
    unwrap<SendResult>(v2.post('/whatsapp/send/low-stock')),

  sendOffer: (customerIds: string[], offerText: string, validUntil?: string): Promise<BroadcastResult> =>
    unwrap<BroadcastResult>(v2.post('/whatsapp/send/offer', { customerIds, offerText, validUntil })),

  // ── Log ──
  getLog: (filters?: { customerId?: string; status?: string; limit?: number }): Promise<WhatsAppLog[]> =>
    unwrap<WhatsAppLog[]>(v2.get('/whatsapp/log', { params: filters })),
};
