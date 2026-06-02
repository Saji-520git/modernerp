/// <reference types="vite/client" />
import axios from 'axios';
import { useAuthStore } from '../store/authStore';
import type {
  LoyaltyConfig, UpdateLoyaltyConfigDto, CustomerLoyalty, LoyaltyTransaction,
  PriceTier, CreateTierDto, UpdateTierDto, ProductPrice, SetProductPriceInput,
  TopCustomer, InactiveCustomer, CustomerStats, OwnerDashboard,
  CustomerInteraction, PendingFollowUp, AddInteractionDto, SpendPeriod,
} from '../types/crm';

// CRM lives under /api/v2 — derive a v2 base from the same env var as the v1 api.
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

export const crmService = {
  // ── Loyalty ──
  getLoyaltyConfig: (): Promise<LoyaltyConfig> =>
    unwrap<LoyaltyConfig>(v2.get('/crm/loyalty/config')),

  updateLoyaltyConfig: (data: UpdateLoyaltyConfigDto): Promise<LoyaltyConfig> =>
    unwrap<LoyaltyConfig>(v2.put('/crm/loyalty/config', data)),

  getCustomerLoyalty: (customerId: string): Promise<CustomerLoyalty> =>
    unwrap<CustomerLoyalty>(v2.get(`/crm/loyalty/${customerId}`)),

  adjustPoints: (customerId: string, points: number, note: string): Promise<LoyaltyTransaction> =>
    unwrap<LoyaltyTransaction>(v2.post(`/crm/loyalty/${customerId}/adjust`, { points, note })),

  // ── Price tiers ──
  getTiers: (): Promise<PriceTier[]> =>
    unwrap<PriceTier[]>(v2.get('/crm/tiers')),

  createTier: (data: CreateTierDto): Promise<PriceTier> =>
    unwrap<PriceTier>(v2.post('/crm/tiers', data)),

  updateTier: (id: string, data: UpdateTierDto): Promise<PriceTier> =>
    unwrap<PriceTier>(v2.put(`/crm/tiers/${id}`, data)),

  deleteTier: (id: string): Promise<PriceTier> =>
    unwrap<PriceTier>(v2.delete(`/crm/tiers/${id}`)),

  getProductPrices: (productId: string): Promise<ProductPrice[]> =>
    unwrap<ProductPrice[]>(v2.get(`/crm/tiers/product/${productId}`)),

  setProductPrices: (productId: string, prices: SetProductPriceInput[]): Promise<ProductPrice[]> =>
    unwrap<ProductPrice[]>(v2.put(`/crm/tiers/product/${productId}`, { prices })),

  setCustomerTier: (customerId: string, tierId: string | null): Promise<{ id: string }> =>
    unwrap<{ id: string }>(v2.put(`/crm/tiers/customer/${customerId}`, { tierId })),

  // ── Intelligence ──
  getTopCustomers: (limit = 10, period: SpendPeriod = 'all'): Promise<TopCustomer[]> =>
    unwrap<TopCustomer[]>(v2.get('/crm/intelligence/top-customers', { params: { limit, period } })),

  getInactiveCustomers: (daysSince = 30): Promise<InactiveCustomer[]> =>
    unwrap<InactiveCustomer[]>(v2.get('/crm/intelligence/inactive', { params: { daysSince } })),

  getCustomerStats: (id: string): Promise<CustomerStats> =>
    unwrap<CustomerStats>(v2.get(`/crm/intelligence/customer/${id}`)),

  getOwnerDashboard: (): Promise<OwnerDashboard> =>
    unwrap<OwnerDashboard>(v2.get('/crm/intelligence/dashboard')),

  getPendingFollowUps: (): Promise<PendingFollowUp[]> =>
    unwrap<PendingFollowUp[]>(v2.get('/crm/intelligence/followups')),

  // ── Interactions ──
  getInteractions: (customerId: string): Promise<CustomerInteraction[]> =>
    unwrap<CustomerInteraction[]>(v2.get(`/crm/interactions/${customerId}`)),

  addInteraction: (data: AddInteractionDto): Promise<CustomerInteraction> =>
    unwrap<CustomerInteraction>(v2.post('/crm/interactions', data)),

  markInteractionDone: (id: string): Promise<CustomerInteraction> =>
    unwrap<CustomerInteraction>(v2.put(`/crm/interactions/${id}/done`)),
};
