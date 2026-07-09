import { api } from './api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface DashboardKPIs {
  todayRevenueCents: number;
  monthRevenueCents: number;
  todayOrders: number;
  monthOrders: number;
  pendingOrders: number;
  openPOs: number;
  lowStockCount: number;
  activeUsers: number;
  unpaidCents: number;
  monthPurchasesCents: number;
  monthPurchaseCount: number;
  inventoryValueCents: number;
  trends: {
    todayRevenue: number; // % change vs yesterday
    monthRevenue: number; // % change vs last month
  };
}

export interface RevenuePoint {
  date:          string; // YYYY-MM-DD
  revenue:       number; // cents
  orders:        number;
  expensesCents: number; // daily expense total (non-template, non-deleted)
  cogsCents:     number; // daily cost of goods sold (qty × cost) — for true net profit
}

export interface TopProduct {
  productId: string;
  name: string;
  revenueCents: number;
  qty: number;
}

export interface RecentSale {
  id: string;
  number: string;
  date: string;
  totalCents: number;
  isPos: boolean;
  paymentMethod: string;
  customer: { name: string } | null;
  createdBy: { fullName: string };
}

export interface LowStockAlert {
  id: string;
  name: string;
  sku: string;
  reorderLevel: number;
  totalQty: number;
}

export interface ModuleCounts {
  products: number;
  customers: number;
  suppliers: number;
}

export interface DashboardSummary {
  kpis: DashboardKPIs;
  revenueChart: RevenuePoint[];
  topProducts: TopProduct[];
  recentSales: RecentSale[];
  lowStockAlerts: LowStockAlert[];
  counts: ModuleCounts;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const dashboardApi = {
  summary: (): Promise<DashboardSummary> =>
    api.get('/dashboard/summary').then((r) => r.data),

  revenueChart: (days: 30 | 60 | 90 = 30): Promise<RevenuePoint[]> =>
    api.get('/dashboard/revenue-chart', { params: { days } }).then((r) => r.data),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format cents to currency string, e.g. 150025 → "Rs. 1,500" */
export function formatCurrency(cents: number): string {
  return `Rs. ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}

/** Short currency, e.g. 1500025 → "Rs. 15K" */
export function formatCurrencyShort(cents: number): string {
  const value = cents / 100;
  if (value >= 1_000_000) return `Rs. ${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `Rs. ${(value / 1_000).toFixed(1)}K`;
  return `Rs. ${value.toFixed(0)}`;
}

/** Format a date string to short readable form, e.g. "May 8" */
export function formatDateShort(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

/** Format a full datetime string, e.g. "May 8, 3:45 PM" */
export function formatDateTime(dateStr: string): string {
  return new Date(dateStr).toLocaleDateString('en-US', {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}
