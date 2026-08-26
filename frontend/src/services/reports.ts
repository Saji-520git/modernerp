import { api } from './api';

// ─── Shared helpers ───────────────────────────────────────────────────────────

export function formatMoney(cents: number): string {
  return `Rs. ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// Abbreviated on MAGNITUDE, so a loss shortens the same way a gain does. The
// thresholds used to be tested against the signed value, so -800000 cents fell
// past both and printed "Rs. -8000.00" beside a "Rs. 8.0K" — visible the moment
// a P&L axis had to cross zero.
export function formatMoneyShort(cents: number): string {
  const n    = cents / 100;
  const sign = n < 0 ? '-' : '';
  const abs  = Math.abs(n);
  if (abs >= 1_000_000) return `Rs. ${sign}${(abs / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000)     return `Rs. ${sign}${(abs / 1_000).toFixed(1)}K`;
  return `Rs. ${sign}${abs.toFixed(2)}`;
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
  barcode: string | null;
  totalQty: number;
  costCents: number;
  lastCostCents: number;
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

// ─── P&L Comparison types ─────────────────────────────────────────────────────

export interface PnlPeriodMetrics {
  revenue:         number;
  cogs:            number;
  purchaseReturns: number;
  grossProfit:     number;
  expenses:        number;
  netProfit:       number;
  grossMarginPct:  number;
  netMarginPct:    number;
}

export interface PnlComparisonResult {
  period:   { from: string; to: string };
  current:  PnlPeriodMetrics;
  previous: PnlPeriodMetrics;
}

// ─── Dashboard Live Stats types ───────────────────────────────────────────────

export interface DashboardActivity {
  type:        'SALE' | 'PURCHASE' | 'PAYMENT_IN' | 'PAYMENT_OUT';
  refNumber:   string;
  description: string;
  amountCents: number;
  createdAt:   string;
}

export interface DashboardStats {
  todaySalesCents:             number;
  todaySalesCount:             number;
  outstandingReceivablesCents: number;
  outstandingPayablesCents:    number;
  lowStockCount:               number;
  last7Days: Array<{ date: string; salesCents: number; salesCount: number }>;
  recentActivity:              DashboardActivity[];
}

// ─── Today's Summary types ────────────────────────────────────────────────────

export interface TodaySummary {
  date:        string; // YYYY-MM-DD (local calendar day)
  generatedAt: string; // ISO
  headline: {
    revenueCents:      number; // net of returns
    grossRevenueCents: number;
    returnsCents:      number;
    orderCount:        number;
    itemsSold:         number;
    avgOrderCents:     number;
    cogsCents:         number;
    grossProfitCents:  number;
    grossMarginPct:    number;
  };
  money: {
    expensesCents:  number;
    netProfitCents: number;
  };
  payments: { method: string; count: number; revenueCents: number }[];
  topItems: { productId: string; name: string; sku: string; qty: number; revenueCents: number }[];
  alerts: {
    lowStockCount: number;
    lowStockItems: { name: string; sku: string; totalQty: number; reorderLevel: number }[];
    expiringCount: number;
    expiringItems: { name: string; sku: string; expiryDate: string; daysLeft: number; totalQty: number }[];
  };
  context: {
    yesterdayRevenueCents:   number;
    revenueVsYesterdayPct:   number | null; // null → no prior-day baseline
    newCustomers:            number;
  };
  hourly: { hour: number; revenueCents: number; orders: number }[];
}

// ─── API ──────────────────────────────────────────────────────────────────────

/**
 * Narrow a report to one entity.
 *
 * The server recomputes every figure for it — totals, charts and breakdowns —
 * rather than the browser hiding rows. A filtered list under an unfiltered
 * total reads as authoritative and is not.
 */
export interface SalesScope    { customerId?: string; warehouseId?: string }
export interface PurchaseScope { supplierId?: string; warehouseId?: string }
export interface ProductScope  { categoryId?: string; brandId?: string; warehouseId?: string }

/** How long money has been owed — the figure that decides who gets a call. */
export interface AgingRow {
  id: string;
  name: string;
  phone: string | null;
  current: number;
  d1_30: number;
  d31_60: number;
  d61_90: number;
  d90_plus: number;
  total: number;
  /** Days past due of the oldest debt this contact carries. */
  oldestDays: number;
  /** How much of the total is carried forward from before go-live. */
  openingCents: number;
}

export interface AgingReport {
  type: 'receivable' | 'payable';
  asOf: string;
  dueDays: number;
  totals: {
    current: number; d1_30: number; d31_60: number; d61_90: number; d90_plus: number;
    grand: number; overdue: number; contacts: number; openingCents: number;
  };
  rows: AgingRow[];
}
export const reportsApi = {
  sales: (params: { from: string; to: string; groupBy?: 'day' | 'week' | 'month' } & SalesScope): Promise<SalesReportData> =>
    api.get('/reports/sales', { params }).then((r) => r.data),

  purchases: (params: { from: string; to: string } & PurchaseScope): Promise<PurchasesReportData> =>
    api.get('/reports/purchases', { params }).then((r) => r.data),

  products: (params: { from: string; to: string } & ProductScope): Promise<ProductReportData> =>
    api.get('/reports/products', { params }).then((r) => r.data),

  customers: (params: { from: string; to: string } & SalesScope): Promise<CustomerItem[]> =>
    api.get('/reports/customers', { params }).then((r) => r.data),

  inventory: (params?: ProductScope): Promise<InventoryReportData> =>
    api.get('/reports/inventory', { params }).then((r) => r.data),

  aging: (params: { type: 'receivable' | 'payable'; asOf?: string }): Promise<AgingReport> =>
    api.get('/reports/aging', { params }).then((r) => r.data),

  profitLoss: (params: { from: string; to: string } & SalesScope): Promise<ProfitLossData> =>
    api.get('/reports/profit-loss', { params }).then((r) => r.data),

  salesCsvUrl: (params: { from: string; to: string; groupBy?: string } & SalesScope): string => {
    // The export carries the same scope as the screen — otherwise the file
    // would not match the report it was taken from.
    const q = new URLSearchParams({ from: params.from, to: params.to, groupBy: params.groupBy ?? 'day' });
    if (params.customerId)  q.set('customerId',  params.customerId);
    if (params.warehouseId) q.set('warehouseId', params.warehouseId);
    return `/api/v1/reports/sales/csv?${q}`;
  },

  pnlComparison: (params: { dateFrom: string; dateTo: string; warehouseId?: string }): Promise<PnlComparisonResult> =>
    api.get('/reports/pnl', { params }).then((r) => r.data),

  dashboardStats: (): Promise<DashboardStats> =>
    api.get('/reports/dashboard').then((r) => r.data),

  todaySummary: (): Promise<TodaySummary> =>
    api.get('/reports/today-summary').then((r) => r.data),
};
