import { api } from './api';

// ─── Shared helpers ───────────────────────────────────────────────────────────

export function formatMoney(cents: number): string {
  return `Rs. ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export function formatMoneyShort(cents: number): string {
  const n = cents / 100;
  if (n >= 1_000_000) return `Rs. ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000) return `Rs. ${(n / 1_000).toFixed(1)}K`;
  return `Rs. ${n.toFixed(2)}`;
}

// Use local date components so the "today" boundary is the user's
// calendar day — toISOString() returns UTC which can be yesterday
// for users in timezones ahead of UTC.
function localDateISO(d: Date): string {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function todayISO(): string {
  return localDateISO(new Date());
}

export function thirtyDaysAgoISO(): string {
  const d = new Date();
  d.setDate(d.getDate() - 29);
  return localDateISO(d);
}

export function thisYearStartISO(): string {
  return `${new Date().getFullYear()}-01-01`;
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SalesTopProduct {
  productId:        string;
  name:             string;
  sku:              string;
  revenueCents:     number;
  qtySold:          number;
  cogsCents:        number;
  grossProfitCents: number;
  marginPct:        number;
}

export interface SalesReportData {
  summary: {
    totalRevenueCents:      number;
    totalTaxCents:          number;
    totalDiscountCents:     number;
    totalPaidCents:         number;
    totalCogsCents:         number;
    orderCount:             number;
    avgOrderCents:          number;
    prevPeriodRevenueCents: number;
  };
  byPeriod: { period: string; revenueCents: number; orders: number }[];
  byWarehouse: { name: string; code: string; revenueCents: number; orders: number }[];
  byPayment: { method: string; count: number; revenueCents: number }[];
  topProducts: SalesTopProduct[];
}

export interface PurchasesReportData {
  summary: {
    totalSpendCents:     number;
    poCount:             number;
    avgPoCents:          number;
    totalItemsReceived:  number;
    uniqueSuppliers:     number;
    avgLeadTimeDays:     number;
  };
  bySupplier: { name: string; spendCents: number; poCount: number }[];
  byPeriod: { period: string; spendCents: number; poCount: number }[];
}

export interface ProductItem {
  productId: string;
  name: string;
  sku: string;
  revenueCents: number;
  qtySold: number;
  cogsCents: number;
  grossProfitCents: number;
  marginPct: number;
}

export interface ProductReportData {
  topByRevenue: ProductItem[];
  topByQty: ProductItem[];
}

export interface CustomerItem {
  customerId: string;
  name: string;
  totalSpentCents: number;
  orderCount: number;
  avgOrderCents: number;
  lastOrder: string;
}

export interface InventoryItem {
  productId: string;
  name: string;
  sku: string;
  totalQty: number;
  costCents: number;
  priceCents: number;
  reorderLevel: number;
  isLowStock: boolean;
  costValueCents: number;
  saleValueCents: number;
  potentialMarginCents: number;
}

export interface SlowMoverItem {
  productId:      string;
  name:           string;
  sku:            string;
  totalQty:       number;
  costCents:      number;
  costValueCents: number;
  lastSaleDate:   string | null;
}

export interface LowStockItem {
  productId:    string;
  name:         string;
  sku:          string;
  totalQty:     number;
  reorderLevel: number;
  deficit:      number;
  costCents:    number;
}

export interface InventoryReportData {
  items: InventoryItem[];
  totals: {
    totalCostValueCents: number;
    totalSaleValueCents: number;
    totalMarginCents: number;
    lowStockCount: number;
    skuCount: number;
  };
  slowMovers:    SlowMoverItem[];
  lowStockItems: LowStockItem[];
}

export interface ProfitLossData {
  summary: {
    revenueCents: number;
    taxCents: number;
    discountCents: number;
    cogsCents: number;
    grossProfitCents: number;
    grossMarginPct: number;
    orderCount: number;
    totalExpensesCents: number;
    netProfitCents: number;
    netMarginPct: number;
  };
  expensesByCategory: { name: string; color: string; totalCents: number }[];
  byPeriod: {
    period:           string;
    revenueCents:     number;
    cogsCents:        number;
    grossProfitCents: number;
    grossMarginPct:   number;
    expensesCents:    number;
    netProfitCents:   number;
    netMarginPct:     number;
  }[];
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const reportsApi = {
  sales: (params: { from: string; to: string; groupBy?: 'day' | 'week' | 'month' }): Promise<SalesReportData> =>
    api.get('/reports/sales', { params }).then((r) => r.data),

  purchases: (params: { from: string; to: string }): Promise<PurchasesReportData> =>
    api.get('/reports/purchases', { params }).then((r) => r.data),

  products: (params: { from: string; to: string }): Promise<ProductReportData> =>
    api.get('/reports/products', { params }).then((r) => r.data),

  customers: (params: { from: string; to: string }): Promise<CustomerItem[]> =>
    api.get('/reports/customers', { params }).then((r) => r.data),

  inventory: (params?: { warehouseId?: string }): Promise<InventoryReportData> =>
    api.get('/reports/inventory', { params }).then((r) => r.data),

  profitLoss: (params: { from: string; to: string }): Promise<ProfitLossData> =>
    api.get('/reports/profit-loss', { params }).then((r) => r.data),

  salesCsvUrl: (params: { from: string; to: string; groupBy?: string }): string => {
    const q = new URLSearchParams({ from: params.from, to: params.to, groupBy: params.groupBy ?? 'day' });
    return `/api/v1/reports/sales/csv?${q}`;
  },
};
