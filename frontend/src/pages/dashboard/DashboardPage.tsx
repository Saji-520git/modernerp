import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  TrendingUp, TrendingDown, ShoppingCart, AlertTriangle,
  Package, Truck, ArrowRight, BarChart2, CreditCard,
  Warehouse, Receipt, ArrowUpRight, Users, UserCheck,
  PackageOpen, RefreshCw, Bell, Sun,
} from 'lucide-react';
import { Link } from 'react-router-dom';
import { useAuthStore } from '../../store/authStore';
import {
  dashboardApi,
  formatDateShort, formatDateTime,
  type RevenuePoint, type TopProduct,
} from '../../services/dashboard';
import { reportsApi } from '../../services/reports';
import { useAppSettings } from '../../context/SettingsContext';
import { inventoryApi } from '../../services/inventory';
import { expensesApi } from '../../services/expenses';
import { alertsApi } from '../../services/alerts';
import {
  Area, AreaChart, CartesianGrid, Cell, Line, Pie, PieChart, Tooltip, XAxis, YAxis,
} from 'recharts';
import { Card } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { ChartContainer, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';

function cls(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(' ');
}

/**
 * Period-over-period delta chip.
 *
 * Renders nothing when the figure is absent or zero rather than showing a
 * neutral "0%" — a KPI card is read at a glance, and a chip that is always
 * there stops being a signal. `onDark` swaps to translucent-white so the same
 * component works on the filled lead card.
 */
function TrendChip({ pct, onDark = false }: { pct?: number | null; onDark?: boolean }) {
  if (pct === undefined || pct === null || pct === 0) return null;
  const up = pct > 0;
  const Icon = up ? TrendingUp : TrendingDown;
  const tone = onDark
    ? up ? 'bg-white/20 text-emerald-200' : 'bg-white/20 text-rose-200'
    : up ? 'bg-success-subtle text-success' : 'bg-danger-subtle text-danger';
  return (
    <span className={cls('inline-flex items-center gap-1 rounded-token-sm px-1.5 py-0.5', tone)}>
      <Icon size={11} strokeWidth={2.6} />
      <span className="text-[11px] font-bold">{Math.abs(pct)}%</span>
    </span>
  );
}

// ─── SVG Line Chart ───────────────────────────────────────────────────────────
/**
 * Revenue, expenses and orders over the selected window.
 *
 * Replaces ~130 lines of hand-computed SVG (manual scales, path strings, a
 * hover-index state and a bespoke tooltip). Recharts owns the geometry now; what
 * remains here is the decision of WHAT to plot.
 *
 * Revenue and expenses share the left money axis so they can be compared
 * honestly — this is the view that shows a single large expense outweighing a
 * month of takings. Orders are a count, not money, so they get their own right
 * axis; plotting them against the money scale would draw a line that means
 * nothing.
 *
 * Series colours are CSS variables published by ChartContainer, so the chart
 * follows the light/dark toggle with no `dark:` variants.
 */
function LineChart({ data }: { data: RevenuePoint[] }) {
  const { formatMoney: formatCurrency, formatMoneyShort: formatCurrencyShort } = useAppSettings();

  if (!data.length) {
    return (
      <div className="h-44 flex items-center justify-center text-content-muted text-sm">
        No data
      </div>
    );
  }

  const config: ChartConfig = {
    revenue:  { label: 'Revenue',  color: 'hsl(var(--primary))' },
    expenses: { label: 'Expenses', color: 'var(--warning)' },
    orders:   { label: 'Orders',   color: 'var(--success)' },
  };

  // Recharts wants plain numbers; money stays in cents until the axis formats it.
  const rows = data.map((d) => ({
    date:     d.date,
    revenue:  d.revenue,
    expenses: d.expensesCents,
    orders:   d.orders,
  }));

  const dayLabel = (iso: string) => {
    const d = new Date(iso + 'T00:00:00');
    return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  return (
    <ChartContainer config={config} className="h-[210px]">
      <AreaChart data={rows} margin={{ top: 8, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="fillRevenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-revenue)" stopOpacity={0.22} />
            <stop offset="100%" stopColor="var(--color-revenue)" stopOpacity={0.01} />
          </linearGradient>
          <linearGradient id="fillExpenses" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--color-expenses)" stopOpacity={0.18} />
            <stop offset="100%" stopColor="var(--color-expenses)" stopOpacity={0.01} />
          </linearGradient>
        </defs>

        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis
          dataKey="date"
          tickLine={false}
          axisLine={false}
          tickMargin={8}
          minTickGap={28}
          tickFormatter={dayLabel}
        />
        <YAxis
          yAxisId="money"
          tickLine={false}
          axisLine={false}
          width={52}
          tickFormatter={(v: number) => formatCurrencyShort(v)}
        />
        <YAxis
          yAxisId="count"
          orientation="right"
          tickLine={false}
          axisLine={false}
          width={30}
          allowDecimals={false}
        />
        <Tooltip
          cursor={{ stroke: 'hsl(var(--border))', strokeWidth: 1 }}
          content={
            <ChartTooltipContent
              labelFormatter={(l) => dayLabel(String(l))}
              formatter={(value, key) => (key === 'orders' ? String(value) : formatCurrency(value))}
            />
          }
        />

        <Area
          yAxisId="money"
          type="monotone"
          dataKey="revenue"
          stroke="var(--color-revenue)"
          strokeWidth={2}
          fill="url(#fillRevenue)"
        />
        <Area
          yAxisId="money"
          type="monotone"
          dataKey="expenses"
          stroke="var(--color-expenses)"
          strokeWidth={2}
          fill="url(#fillExpenses)"
        />
        <Line
          yAxisId="count"
          type="monotone"
          dataKey="orders"
          stroke="var(--color-orders)"
          strokeWidth={1.6}
          strokeDasharray="4 3"
          dot={false}
        />
      </AreaChart>
    </ChartContainer>
  );
}

// ─── SVG Donut Chart ──────────────────────────────────────────────────────────
/**
 * Revenue share by product.
 *
 * The ring and legend are Recharts now; the hand-rolled version computed arc
 * paths with trigonometry and tracked its own hover index. The centre label is
 * kept — total units when idle, the hovered slice's share when not — because
 * that is the one thing a donut is genuinely good at saying.
 *
 * Slice colours come from the app's status tokens rather than the old hardcoded
 * hex list, so the ring re-themes with everything else.
 */
const DONUT_COLORS = [
  'hsl(var(--primary))',
  'var(--warning)',
  'var(--info)',
  'var(--success)',
  'var(--danger)',
];

function DonutChart({ data }: { data: TopProduct[] }) {
  const [hov, setHov] = useState<number | null>(null);
  const { formatMoneyShort: formatCurrencyShort } = useAppSettings();

  if (data.length === 0) {
    return (
      <div className="h-32 flex items-center justify-center text-content-muted text-sm">
        No sales data yet
      </div>
    );
  }

  const slices  = data.slice(0, 5);
  const total   = slices.reduce((s, p) => s + p.revenueCents, 0) || 1;
  const totalQty = data.reduce((s, p) => s + p.qty, 0);
  const hovItem = hov !== null ? slices[hov] : null;

  return (
    <div className="flex items-center gap-4">
      <div className="shrink-0 relative" style={{ width: 150, height: 150 }}>
        <ChartContainer config={{}} className="h-[150px] w-[150px]">
          <PieChart>
            <Pie
              data={slices}
              dataKey="revenueCents"
              nameKey="name"
              cx="50%"
              cy="50%"
              innerRadius={47}
              outerRadius={69}
              paddingAngle={1}
              startAngle={90}
              endAngle={-270}
              stroke="none"
              isAnimationActive={false}
              onMouseEnter={(_, i: number) => setHov(i)}
              onMouseLeave={() => setHov(null)}
            >
              {slices.map((_, i) => (
                <Cell
                  key={i}
                  fill={DONUT_COLORS[i % DONUT_COLORS.length]}
                  opacity={hov !== null && hov !== i ? 0.45 : 1}
                />
              ))}
            </Pie>
          </PieChart>
        </ChartContainer>

        {/* Centre label sits over the ring — Recharts has no first-class slot for it. */}
        <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
          <span className="text-[10px] font-medium text-content-muted">Total</span>
          <span className="text-[17px] font-bold text-content leading-tight">
            {hovItem
              ? `${Math.round((hovItem.revenueCents / total) * 100)}%`
              : totalQty.toLocaleString()}
          </span>
          {hovItem && (
            <span className="text-[8px] text-content-muted max-w-[86px] truncate">
              {hovItem.name}
            </span>
          )}
        </div>
      </div>

      <div className="flex-1 space-y-2 min-w-0">
        {slices.map((p, i) => (
          <div
            key={p.productId}
            className="flex items-center justify-between gap-2 cursor-default transition-opacity"
            style={{ opacity: hov !== null && hov !== i ? 0.45 : 1 }}
            onMouseEnter={() => setHov(i)}
            onMouseLeave={() => setHov(null)}
          >
            <div className="flex items-center gap-1.5 min-w-0">
              <div
                className="w-2 h-2 rounded-full shrink-0"
                style={{ background: DONUT_COLORS[i % DONUT_COLORS.length] }}
              />
              <span className="text-xs text-content-secondary font-medium truncate">{p.name}</span>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xs font-bold text-content">
                {Math.round((p.revenueCents / total) * 100)}%
              </div>
              <div className="text-[10px] text-content-muted">{formatCurrencyShort(p.revenueCents)}</div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────
function StatCard({
  label, value, sub, trend, iconBg, icon: Icon, to,
}: {
  label: string; value: string; sub?: string; trend?: number;
  iconBg: string; icon: React.ElementType; to?: string;
}) {
  const inner = (
    <div className="bg-white rounded-2xl border border-slate-200 p-5 hover:shadow-md transition-all group">
      <div className="flex items-start justify-between mb-3">
        <div className={cls('w-11 h-11 rounded-xl flex items-center justify-center', iconBg)}>
          <Icon size={20} className="text-white" />
        </div>
        {trend !== undefined && (
          <span className={cls(
            'flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full',
            trend >= 0 ? 'bg-green-50 text-green-600' : 'bg-red-50 text-red-600',
          )}>
            {trend >= 0 ? <TrendingUp size={11} /> : <TrendingDown size={11} />}
            {Math.abs(trend)}% vs last month
          </span>
        )}
      </div>
      <p className="text-2xl font-bold text-slate-800 leading-tight">{value}</p>
      <p className="text-sm text-slate-500 mt-1">{label}</p>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
  return to ? <Link to={to}>{inner}</Link> : inner;
}

// ─── Activity Feed ────────────────────────────────────────────────────────────
function ActivityFeed({ sales }: {
  sales: {
    id: string; number: string; date: string; totalCents: number;
    isPos: boolean; paymentMethod: string;
    customer: { name: string } | null; createdBy: { fullName: string };
  }[];
}) {
  const { formatMoney: formatCurrency } = useAppSettings();
  const pmColor: Record<string, string> = {
    CASH: 'bg-green-100 text-green-700', CARD: 'bg-blue-100 text-blue-700',
    BANK_TRANSFER: 'bg-purple-100 text-purple-700',
    WALLET: 'bg-orange-100 text-orange-700', OTHER: 'bg-slate-100 text-slate-600',
  };
  const pmLabel: Record<string, string> = {
    CASH: 'Cash', CARD: 'Card', BANK_TRANSFER: 'Bank',
    WALLET: 'Wallet', OTHER: 'Other',
  };

  return (
    <div className="space-y-1">
      {sales.length === 0 ? (
        <p className="text-sm text-slate-400 text-center py-6">No recent activity</p>
      ) : (
        sales.map((s) => (
          <div key={s.id} className="flex items-center gap-3 px-3 py-2.5 rounded-xl hover:bg-slate-50 transition-colors">
            <div className={cls(
              'w-8 h-8 rounded-xl flex items-center justify-center shrink-0',
              s.isPos ? 'bg-purple-100' : 'bg-blue-100',
            )}>
              <ShoppingCart size={13} className={s.isPos ? 'text-purple-600' : 'text-blue-600'} />
            </div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 flex-wrap">
                <p className="text-xs font-semibold text-slate-800">{s.number}</p>
                <span className={cls('text-[10px] font-medium px-1.5 py-0.5 rounded-full', pmColor[s.paymentMethod] ?? pmColor.OTHER)}>
                  {pmLabel[s.paymentMethod] ?? s.paymentMethod}
                </span>
              </div>
              <p className="text-[11px] text-slate-400 truncate">
                {s.customer?.name ?? 'Walk-in'} · {formatDateTime(s.date)}
              </p>
            </div>
            <p className="text-xs font-bold text-slate-800 shrink-0">{formatCurrency(s.totalCents)}</p>
          </div>
        ))
      )}
    </div>
  );
}

// ─── Recent Orders Table ──────────────────────────────────────────────────────
function RecentOrdersTable({ sales }: {
  sales: {
    id: string; number: string; date: string; totalCents: number;
    isPos: boolean; paymentMethod: string;
    customer: { name: string } | null; createdBy: { fullName: string };
  }[];
}) {
  const { formatMoney: formatCurrency } = useAppSettings();
  const statusMap = (s: { paymentMethod: string; isPos: boolean }) => {
    if (s.paymentMethod === 'CASH' || s.paymentMethod === 'CARD') return { label: 'Completed', cls: 'bg-green-50 text-green-700' };
    if (s.paymentMethod === 'BANK_TRANSFER') return { label: 'Processing', cls: 'bg-blue-50 text-blue-700' };
    return { label: 'Pending', cls: 'bg-amber-50 text-amber-700' };
  };

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left">
        <thead>
          <tr className="border-b border-slate-100">
            {['Order ID', 'Customer', 'Amount', 'Status', 'Date'].map(h => (
              <th key={h} className="pb-2.5 px-2 text-xs font-semibold text-slate-500 whitespace-nowrap first:pl-0 last:pr-0">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {sales.length === 0 ? (
            <tr><td colSpan={5} className="text-center text-sm text-slate-400 py-8">No sales yet</td></tr>
          ) : (
            sales.map((s) => {
              const st = statusMap(s);
              return (
                <tr key={s.id} className="border-b border-slate-50 hover:bg-slate-50 transition-colors">
                  <td className="py-3 px-2 pl-0 text-xs font-mono font-semibold text-blue-600">{s.number}</td>
                  <td className="py-3 px-2 text-xs font-medium text-slate-700 max-w-[120px] truncate">
                    {s.customer?.name ?? 'Walk-in'}
                  </td>
                  <td className="py-3 px-2 text-xs font-bold text-slate-800 whitespace-nowrap">{formatCurrency(s.totalCents)}</td>
                  <td className="py-3 px-2">
                    <span className={cls('text-[11px] font-semibold px-2 py-0.5 rounded-full', st.cls)}>{st.label}</span>
                  </td>
                  <td className="py-3 px-2 pr-0 text-[11px] text-slate-400 whitespace-nowrap">{formatDateShort(s.date)}</td>
                </tr>
              );
            })
          )}
        </tbody>
      </table>
    </div>
  );
}

// ─── Stock Alerts ─────────────────────────────────────────────────────────────
function StockList({ items }: { items: { id: string; name: string; reorderLevel: number; totalQty: number }[] }) {
  if (items.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-6 gap-2">
        <div className="w-10 h-10 bg-green-100 rounded-xl flex items-center justify-center">
          <Package size={18} className="text-green-600" />
        </div>
        <p className="text-xs font-medium text-green-700">All stock OK</p>
      </div>
    );
  }
  return (
    <div className="space-y-2">
      {items.slice(0, 5).map(item => {
        const pct = item.reorderLevel > 0 ? (item.totalQty / item.reorderLevel) * 100 : 0;
        const isOut = item.totalQty <= 0;
        return (
          <div key={item.id} className="flex items-center gap-3 p-2.5 rounded-xl bg-slate-50">
            <div className={cls('w-7 h-7 rounded-lg flex items-center justify-center shrink-0', isOut ? 'bg-red-100' : 'bg-amber-100')}>
              <PackageOpen size={12} className={isOut ? 'text-red-600' : 'text-amber-600'} />
            </div>
            <div className="flex-1 min-w-0">
              <p className="text-xs font-semibold text-slate-700 truncate">{item.name}</p>
              <div className="h-1 bg-slate-200 rounded-full mt-1 overflow-hidden">
                <div className={cls('h-full rounded-full', isOut ? 'bg-red-500' : pct < 50 ? 'bg-amber-500' : 'bg-yellow-400')}
                  style={{ width: `${Math.min(pct, 100)}%` }} />
              </div>
            </div>
            <div className="text-right shrink-0">
              <p className={cls('text-xs font-bold', isOut ? 'text-red-600' : 'text-amber-700')}>{item.totalQty}</p>
              <p className="text-[10px] text-slate-400">/{item.reorderLevel}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}

// ─── Quick Links ──────────────────────────────────────────────────────────────
const QUICK = [
  { label: 'Open POS',     icon: ShoppingCart, to: '/pos',       color: '#2563EB' },
  { label: 'New Invoice',  icon: Receipt,      to: '/sales',     color: '#10B981' },
  { label: 'New Purchase', icon: Truck,        to: '/purchases', color: '#6366F1' },
  { label: 'View Reports', icon: BarChart2,    to: '/reports',   color: '#F59E0B' },
];

// ─── Main Page ────────────────────────────────────────────────────────────────
export default function DashboardPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const { formatMoney: formatCurrency, formatMoneyShort: formatCurrencyShort, settings } = useAppSettings();
  const [chartDays, setChartDays] = useState<30 | 60 | 90>(30);
  const showAlertsInDashboard = settings?.alertShowInDashboard !== false;

  const { data, isLoading, isError, refetch } = useQuery({
    queryKey: ['dashboard-summary'],
    queryFn: dashboardApi.summary,
    refetchInterval: 60_000,
    retry: 2,
  });

  const { data: chartData } = useQuery({
    queryKey: ['dashboard-revenue-chart', chartDays],
    queryFn:  () => dashboardApi.revenueChart(chartDays),
    staleTime: 60_000,
  });

  const { data: expiryAlerts = [] } = useQuery({
    queryKey: ['dashboard-expiry-alerts'],
    queryFn: inventoryApi.listExpiring,
    staleTime: 5 * 60_000,
    enabled: showAlertsInDashboard,
  });

  const { data: lowStockData } = useQuery({
    queryKey: ['dashboard-low-stock-count'],
    queryFn: () => inventoryApi.listStock({ lowStockOnly: true, pageSize: 1 }),
    staleTime: 5 * 60_000,
  });

  const { data: alertsData } = useQuery({
    queryKey: ['dashboard-alerts'],
    queryFn:  () => alertsApi.getAlerts({ pageSize: 5 }),
    refetchInterval: 2 * 60_000,
    enabled: showAlertsInDashboard,
  });

  const dismissExpiredMut = useMutation({
    mutationFn: () => alertsApi.dismissAll('EXPIRED'),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['dashboard-expiry-alerts'] });
      qc.invalidateQueries({ queryKey: ['dashboard-alerts'] });
      qc.invalidateQueries({ queryKey: ['alert-count'] });
    },
  });

  const { data: expenseSummary } = useQuery({
    queryKey: ['dashboard-expense-summary'],
    queryFn:  () => expensesApi.getMonthlySummary(),
    staleTime: 5 * 60_000,
  });

  const { data: liveStats } = useQuery({
    queryKey: ['dashboard-live-stats'],
    queryFn:  reportsApi.dashboardStats,
    refetchInterval: 60_000,
  });

  const kpis = data?.kpis;
  const now   = new Date();
  const hour  = now.getHours();
  const greeting = hour < 12 ? 'Good morning' : hour < 18 ? 'Good afternoon' : 'Good evening';

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="flex items-center gap-3 text-slate-400 text-sm">
          <div className="w-5 h-5 border-2 border-slate-200 border-t-blue-600 rounded-full animate-spin" />
          Loading dashboard…
        </div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-64 gap-4">
        <div className="text-center">
          <p className="text-slate-600 font-semibold text-sm mb-1">Cannot connect to the server</p>
          <p className="text-slate-400 text-xs font-mono">cd backend &amp;&amp; npm run dev</p>
        </div>
        <button onClick={() => refetch()}
          className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 transition flex items-center gap-2">
          <RefreshCw size={14} /> Retry
        </button>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col gap-4 p-4 overflow-y-auto text-base">

      {/* ── Header ─────────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div>
          <p className="text-xs text-slate-500">{greeting}, {user?.fullName?.split(' ')[0] ?? 'there'}</p>
          <h1 className="text-xl font-bold text-slate-800 leading-tight">Dashboard</h1>
        </div>
        <div className="flex items-center gap-2">
          <span className="text-xs text-slate-400">
            {now.toLocaleDateString('en-US', { weekday: 'long', month: 'long', day: 'numeric', year: 'numeric' })}
          </span>
          <Link to="/dashboard/today"
            className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 rounded-lg text-xs font-semibold text-white hover:bg-indigo-700 transition shadow-sm">
            <Sun size={13} /> Today's Summary
          </Link>
          <button onClick={() => refetch()}
            className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 transition shadow-sm">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {/* ── KPI row ────────────────────────────────────────────────────────────
          Four figures instead of six tiles: the two that were dropped (orders
          count, payables) now ride as sub-lines on the card they belong to, so
          each card answers one question and carries its own context.

          The lead card is filled with the brand colour rather than the near-black
          of the design mock. Near-black cannot survive the theme toggle — it
          would have to inverse to near-white in dark and take its text with it —
          whereas `bg-accent` is indigo in both themes and its white foreground
          stays legible. */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 flex-shrink-0">

        <Link to="/sales" className="block">
          <Card className="bg-accent border-transparent p-[18px] h-full hover:shadow-token-md transition-shadow">
            <div className="flex items-center gap-2.5 mb-3.5">
              <div className="w-8 h-8 rounded-token-md bg-white/15 flex items-center justify-center shrink-0">
                <BarChart2 size={16} className="text-white" />
              </div>
              <span className="text-[13px] font-semibold text-white/80">Revenue this month</span>
            </div>
            <p className="text-[28px] font-extrabold tracking-[-0.03em] leading-none text-white">
              {formatCurrencyShort(kpis?.monthRevenueCents ?? 0)}
            </p>
            <div className="flex items-center gap-2 mt-3">
              <TrendChip pct={kpis?.trends?.monthRevenue} onDark />
              <span className="text-[11.5px] text-white/60">{kpis?.monthOrders ?? 0} orders</span>
            </div>
          </Card>
        </Link>

        <Link to="/sales" className="block">
          <Card className="bg-success-subtle border-transparent p-[18px] h-full hover:shadow-token-md transition-shadow">
            <div className="flex items-center gap-2.5 mb-3.5">
              <div className="w-8 h-8 rounded-token-md bg-success/15 flex items-center justify-center shrink-0">
                <TrendingUp size={16} className="text-success" />
              </div>
              <span className="text-[13px] font-semibold text-content">Today's sales</span>
            </div>
            <p className="text-[28px] font-extrabold tracking-[-0.03em] leading-none text-content">
              {formatCurrencyShort(kpis?.todayRevenueCents ?? 0)}
            </p>
            <div className="flex items-center gap-2 mt-3">
              <TrendChip pct={kpis?.trends?.todayRevenue} />
              <span className="text-[11.5px] text-content-secondary">{kpis?.todayOrders ?? 0} orders today</span>
            </div>
          </Card>
        </Link>

        <Link to="/sales" className="block">
          <Card className="bg-warning-subtle border-transparent p-[18px] h-full hover:shadow-token-md transition-shadow">
            <div className="flex items-center gap-2.5 mb-3.5">
              <div className="w-8 h-8 rounded-token-md bg-warning/15 flex items-center justify-center shrink-0">
                <CreditCard size={16} className="text-warning" />
              </div>
              <span className="text-[13px] font-semibold text-content">Receivables</span>
            </div>
            <p className="text-[28px] font-extrabold tracking-[-0.03em] leading-none text-content">
              {formatCurrencyShort(liveStats?.outstandingReceivablesCents ?? 0)}
            </p>
            <div className="flex items-center gap-2 mt-3">
              <Badge variant="warning">owed to us</Badge>
              <span className="text-[11.5px] text-content-secondary">
                {formatCurrencyShort(liveStats?.outstandingPayablesCents ?? 0)} payable
              </span>
            </div>
          </Card>
        </Link>

        <Link to="/inventory" className="block">
          <Card className="p-[18px] h-full hover:shadow-token-md transition-shadow">
            <div className="flex items-center gap-2.5 mb-3.5">
              <div className="w-8 h-8 rounded-token-md bg-accent-subtle flex items-center justify-center shrink-0">
                <Warehouse size={16} className="text-accent" />
              </div>
              <span className="text-[13px] font-semibold text-content-secondary">Inventory value</span>
            </div>
            <p className="text-[28px] font-extrabold tracking-[-0.03em] leading-none text-content">
              {formatCurrencyShort(kpis?.inventoryValueCents ?? 0)}
            </p>
            <div className="flex items-center gap-2 mt-3">
              {(lowStockData?.total ?? 0) > 0
                ? <Badge variant="destructive">{lowStockData?.total} low</Badge>
                : <Badge variant="success">stock healthy</Badge>}
              <span className="text-[11.5px] text-content-muted">{data?.counts?.products ?? 0} products</span>
            </div>
          </Card>
        </Link>
      </div>

      {/* ── Main 2-column layout ───────────────────────────────────────────────── */}
      <div className="flex-1 grid grid-cols-3 gap-4 min-h-0">

        {/* ── Left 2/3 ─────────────────────────────────────────────────────────── */}
        <div className="col-span-2 flex flex-col gap-4">

          {/* Revenue Chart */}
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex-shrink-0 overflow-hidden">
            <div className="flex items-center justify-between mb-3 border-b-2 border-slate-200 pb-2">
              <div>
                <h2 className="text-base font-bold text-slate-800">Revenue Overview</h2>
                <p className="text-xs text-slate-400">Revenue vs expenses</p>
              </div>
              <div className="flex items-center gap-2">
                <div className="flex rounded-lg border border-slate-200 overflow-hidden text-xs font-medium">
                  {([30, 60, 90] as const).map((d) => (
                    <button key={d} onClick={() => setChartDays(d)}
                      className={`px-2.5 py-1 transition ${chartDays === d ? 'bg-indigo-600 text-white' : 'text-slate-500 hover:bg-slate-50'}`}>
                      {d}d
                    </button>
                  ))}
                </div>
                <Link to="/reports"
                  className="flex items-center gap-1 text-xs font-semibold text-blue-600 hover:text-blue-800 bg-blue-50 px-3 py-1.5 rounded-lg transition">
                  Full Report <ArrowUpRight size={12} />
                </Link>
              </div>
            </div>
            {chartData
              ? <LineChart data={chartData} />
              : <div className="h-40 flex items-center justify-center text-slate-400 text-sm">No chart data</div>
            }
          </div>

          {/* Bottom row: Top Products + Recent Activity */}
          <div className="flex-1 grid grid-cols-2 gap-4 min-h-0">

            {/* Revenue share by product.
                Was a list of bars scaled to the biggest seller, which answers
                "which is largest" but not "how concentrated are we" — the
                question that matters when one product is most of the revenue.
                The donut answers both, and it finally gives DonutChart a caller:
                it had been defined and never used. */}
            <Card className="p-4">
              <div className="flex items-center justify-between mb-3 border-b border-border pb-2">
                <h2 className="text-base font-bold text-content">Revenue by product</h2>
                <Link to="/products"
                  className="text-xs text-accent hover:text-accent-hover font-semibold flex items-center gap-1">
                  View all <ArrowRight size={11} />
                </Link>
              </div>
              <DonutChart data={data?.topProducts ?? []} />
            </Card>

            {/* Recent Activity */}
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex flex-col min-h-0">
              <div className="flex items-center justify-between mb-3 flex-shrink-0 border-b-2 border-slate-200 pb-2">
                <h2 className="text-base font-bold text-slate-800">Recent Activity</h2>
                <Link to="/sales"
                  className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1">
                  View all <ArrowRight size={11} />
                </Link>
              </div>
              <div className="overflow-y-auto flex-1">
                <ActivityFeed sales={(data?.recentSales ?? []).slice(0, 5)} />
              </div>
            </div>

          </div>
        </div>

        {/* ── Right 1/3 ────────────────────────────────────────────────────────── */}
        <div className="flex flex-col gap-4">

          {/* Stock Alerts */}
          {showAlertsInDashboard && (
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
              <div className="flex items-center justify-between mb-2 border-b-2 border-slate-200 pb-2">
                <div className="flex items-center gap-2">
                  <Bell size={14} className="text-indigo-500" />
                  <h2 className="text-base font-bold text-slate-800">Stock Alerts</h2>
                  {(alertsData?.unreadCount ?? 0) > 0 && (
                    <span className="text-[10px] font-bold px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full">
                      {alertsData!.unreadCount}
                    </span>
                  )}
                </div>
                <Link to="/alerts" className="text-xs text-indigo-600 hover:text-indigo-800 font-medium flex items-center gap-1">
                  View All <ArrowRight size={10} />
                </Link>
              </div>
              <div className="space-y-1">
                {(alertsData?.items ?? []).slice(0, 4).map(alert => (
                  <Link key={alert.id} to="/alerts"
                    className="flex items-start gap-2 p-1.5 rounded-lg hover:bg-slate-50 transition text-xs">
                    <span className={`mt-1 w-1.5 h-1.5 rounded-full shrink-0 ${alert.severity === 'CRITICAL' ? 'bg-red-500' : 'bg-amber-400'}`} />
                    <span className="flex-1 min-w-0">
                      <span className="text-sm font-medium text-slate-800 truncate block">{alert.product.name}</span>
                      <span className="text-slate-400 truncate block text-[11px]">{alert.message}</span>
                    </span>
                    <span className={`shrink-0 text-[9px] font-bold px-1 py-0.5 rounded ${alert.severity === 'CRITICAL' ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'}`}>
                      {alert.severity}
                    </span>
                  </Link>
                ))}
                {(alertsData?.items ?? []).length === 0 && (
                  <div className="text-center py-3 text-emerald-600">
                    <Package size={20} className="mx-auto mb-1" />
                    <p className="text-xs font-medium">All stock levels OK</p>
                  </div>
                )}
              </div>
            </div>
          )}

          {/* Quick Actions — 2×2 grid */}
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
            <h2 className="text-base font-bold text-slate-800 mb-3 border-b-2 border-slate-200 pb-2">Quick Actions</h2>
            <div className="grid grid-cols-2 gap-2">
              {QUICK.map(q => (
                <Link key={q.label} to={q.to}
                  className="flex flex-col items-center gap-1.5 py-3 px-2 rounded-xl text-center transition hover:opacity-90 active:scale-95"
                  style={{ background: q.color + '15', border: `1px solid ${q.color}25` }}>
                  <div className="w-8 h-8 rounded-lg flex items-center justify-center" style={{ background: q.color }}>
                    <q.icon size={15} color="white" />
                  </div>
                  <span className="text-xs font-semibold text-slate-700 leading-tight">{q.label}</span>
                </Link>
              ))}
            </div>
          </div>

          {/* Quick Metrics */}
          <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
            <h2 className="text-base font-bold text-slate-800 mb-2 border-b-2 border-slate-200 pb-2">Quick Metrics</h2>
            <div className="space-y-1.5">
              {[
                { label: 'Pending Invoices', value: kpis?.pendingOrders ?? 0,                         icon: Receipt,   color: 'text-amber-600 bg-amber-50',   to: '/sales' },
                { label: 'Open POs',         value: kpis?.openPOs ?? 0,                               icon: Truck,     color: 'text-blue-600 bg-blue-50',     to: '/purchases' },
                { label: 'Active Users',     value: kpis?.activeUsers ?? 0,                            icon: UserCheck, color: 'text-purple-600 bg-purple-50', to: '/users' },
                { label: 'Unpaid Balance',   value: formatCurrencyShort(kpis?.unpaidCents ?? 0),      icon: CreditCard,color: 'text-red-600 bg-red-50',       to: '/sales' },
              ].map(m => (
                <Link key={m.label} to={m.to}
                  className="flex items-center gap-2 p-1.5 rounded-lg hover:bg-slate-50 transition group">
                  <div className={cls('w-6 h-6 rounded-md flex items-center justify-center shrink-0', m.color.split(' ')[1])}>
                    <m.icon size={11} className={m.color.split(' ')[0]} />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[10px] text-slate-500">{m.label}</p>
                    <p className="text-xs font-bold text-slate-800">{m.value}</p>
                  </div>
                  <ArrowUpRight size={10} className="text-slate-300 group-hover:text-slate-500 transition shrink-0" />
                </Link>
              ))}
            </div>
          </div>

          {/* Expiry Alerts — compact, max 2 items */}
          {showAlertsInDashboard && expiryAlerts.length > 0 && (
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
              <div className="flex items-center justify-between mb-2 border-b-2 border-slate-200 pb-2">
                <div className="flex items-center gap-2">
                  <AlertTriangle size={13} className="text-red-500" />
                  <h2 className="text-base font-bold text-slate-800">Expiry Alerts</h2>
                  <span className="text-[10px] font-bold px-1.5 py-0.5 bg-red-100 text-red-600 rounded-full">
                    {expiryAlerts.length}
                  </span>
                </div>
                {expiryAlerts.some(a => a.expiryStatus === 'has_expired_batch') && (
                  <button
                    onClick={() => dismissExpiredMut.mutate()}
                    disabled={dismissExpiredMut.isPending}
                    className="text-[10px] text-slate-500 hover:text-red-600 border border-slate-200 rounded px-1.5 py-0.5 transition">
                    Dismiss
                  </button>
                )}
              </div>
              <div className="space-y-1">
                {expiryAlerts.slice(0, 2).map((a, i) => (
                  <Link key={i} to="/inventory"
                    className="flex items-center justify-between text-xs hover:bg-slate-50 rounded px-1.5 py-1 transition">
                    <div className="flex items-center gap-1.5 min-w-0">
                      <span className={`w-1.5 h-1.5 rounded-full shrink-0 ${a.expiryStatus === 'has_expired_batch' ? 'bg-red-500' : 'bg-amber-400'}`} />
                      <span className="font-medium text-slate-700 truncate">{a.product.name}</span>
                    </div>
                    <span className={`shrink-0 ml-1 font-semibold text-[10px] ${a.expiryStatus === 'has_expired_batch' ? 'text-red-600' : 'text-amber-600'}`}>
                      {a.expiryStatus === 'has_expired_batch' ? `${a.expiredQty} exp.` : `${a.expiringSoonQty} soon`}
                    </span>
                  </Link>
                ))}
              </div>
              <Link to="/inventory"
                className="mt-1.5 inline-flex items-center gap-1 text-[10px] text-blue-600 hover:underline font-medium">
                View all <ArrowRight size={10} />
              </Link>
            </div>
          )}

        </div>
      </div>

    </div>
  );
}
