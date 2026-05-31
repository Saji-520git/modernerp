import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  TrendingUp, TrendingDown, ShoppingCart, AlertTriangle,
  Package, Truck, ArrowRight, BarChart2, CreditCard,
  Warehouse, Receipt, ArrowUpRight, Users, UserCheck,
  PackageOpen, RefreshCw, Bell,
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

function cls(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(' ');
}

// ─── SVG Line Chart ───────────────────────────────────────────────────────────
function LineChart({ data }: { data: RevenuePoint[] }) {
  const [hov, setHov] = useState<number | null>(null);
  const { formatMoney: formatCurrency, formatMoneyShort: formatCurrencyShort } = useAppSettings();
  if (!data.length) return <div className="h-44 flex items-center justify-center text-slate-400 text-sm">No data</div>;

  const W = 560, H = 160;
  const PAD = { t: 16, r: 12, b: 28, l: 52 };
  const iW = W - PAD.l - PAD.r;
  const iH = H - PAD.t - PAD.b;
  const maxR = Math.max(...data.map(d => Math.max(d.revenue, d.expensesCents ?? 0)), 1);
  const pts = data.map((d, i) => ({
    x: PAD.l + (data.length === 1 ? iW / 2 : (i / (data.length - 1)) * iW),
    y: PAD.t + (1 - d.revenue / maxR) * iH,
    ...d,
  }));

  const line = pts.reduce((acc, p, i) => {
    if (i === 0) return `M${p.x},${p.y}`;
    const prev = pts[i - 1];
    const cx = (prev.x + p.x) / 2;
    return `${acc} C${cx},${prev.y} ${cx},${p.y} ${p.x},${p.y}`;
  }, '');
  const fill = `${line} L${pts[pts.length - 1].x},${PAD.t + iH} L${pts[0].x},${PAD.t + iH}Z`;

  const yTicks = [0, 0.25, 0.5, 0.75, 1];
  const totalRevenue  = data.reduce((s, d) => s + d.revenue, 0);
  const totalExpenses = data.reduce((s, d) => s + (d.expensesCents ?? 0), 0);
  const netProfit     = totalRevenue - totalExpenses;
  const xLabels = pts.filter((_, i) => i % Math.ceil(pts.length / 5) === 0 || i === pts.length - 1);

  // Bar width for expense overlay — each bar spans the per-point column width
  const colW = data.length > 1 ? (iW / (data.length - 1)) * 0.45 : iW * 0.45;

  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="w-full" style={{ height: 160, overflow: 'visible' }}>
        <defs>
          <linearGradient id="lg1" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#2563EB" stopOpacity="0.18" />
            <stop offset="100%" stopColor="#2563EB" stopOpacity="0.01" />
          </linearGradient>
        </defs>
        {yTicks.map(t => {
          const y = PAD.t + t * iH;
          return (
            <g key={t}>
              <line x1={PAD.l} y1={y} x2={W - PAD.r} y2={y} stroke="#f1f5f9" strokeWidth="1" />
              <text x={PAD.l - 6} y={y + 4} textAnchor="end" fontSize="10" fill="#94a3b8">
                {formatCurrencyShort(maxR * (1 - t))}
              </text>
            </g>
          );
        })}
        {/* Expense bars — orange, 45% column width, behind revenue line */}
        {pts.map((p, i) => {
          const exp = data[i].expensesCents ?? 0;
          if (!exp) return null;
          const barH = (exp / maxR) * iH;
          return (
            <rect
              key={i}
              x={p.x - colW / 2}
              y={PAD.t + iH - barH}
              width={colW}
              height={barH}
              fill="#F97316"
              opacity="0.55"
              rx="1"
            />
          );
        })}
        <path d={fill} fill="url(#lg1)" />
        <path d={line} fill="none" stroke="#2563EB" strokeWidth="2.5" strokeLinecap="round" />
        {xLabels.map((p, i) => (
          <text key={i} x={p.x} y={H - 4} textAnchor="middle" fontSize="10" fill="#94a3b8">
            {formatDateShort(p.date)}
          </text>
        ))}
        {pts.map((p, i) => (
          <g key={i} onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}>
            <circle cx={p.x} cy={p.y} r="14" fill="transparent" style={{ cursor: 'crosshair' }} />
            {(hov === i || i === pts.length - 1) && (
              <circle cx={p.x} cy={p.y} r="4.5" fill="white" stroke="#2563EB" strokeWidth="2" />
            )}
            {hov === i && (
              <g>
                <rect x={p.x - 56} y={p.y - 52} width="112" height="44" rx="6" fill="#1e293b" />
                <text x={p.x} y={p.y - 34} textAnchor="middle" fontSize="10" fontWeight="700" fill="white">
                  {formatCurrency(p.revenue)}
                </text>
                <text x={p.x} y={p.y - 20} textAnchor="middle" fontSize="10" fill="#94a3b8">
                  {formatDateShort(p.date)} · {p.orders} orders
                </text>
                {(data[i].expensesCents ?? 0) > 0 && (
                  <text x={p.x} y={p.y - 8} textAnchor="middle" fontSize="9" fill="#fb923c">
                    exp: {formatCurrencyShort(data[i].expensesCents ?? 0)}
                  </text>
                )}
              </g>
            )}
          </g>
        ))}
      </svg>

      {/* Legend */}
      <div className="flex items-center gap-4 mt-2 mb-1">
        <span className="flex items-center gap-1.5 text-sm text-slate-500">
          <span className="inline-block w-3 h-0.5 rounded bg-blue-600" /> Revenue
        </span>
        <span className="flex items-center gap-1.5 text-sm text-slate-500">
          <span className="inline-block w-3 h-2.5 rounded-sm bg-orange-400 opacity-60" /> Expenses
        </span>
      </div>

      <div className="grid grid-cols-3 gap-3 mt-2 pt-3 border-t border-slate-100">
        {[
          { label: 'Total Revenue',  value: formatCurrency(totalRevenue) },
          { label: 'Total Expenses', value: formatCurrencyShort(totalExpenses) },
          { label: 'Net Profit',     value: formatCurrencyShort(netProfit), color: netProfit >= 0 ? 'text-emerald-700' : 'text-red-600' },
        ].map(s => (
          <div key={s.label}>
            <p className="text-sm text-slate-400">{s.label}</p>
            <p className={`text-base font-bold mt-0.5 ${s.color ?? 'text-slate-800'}`}>{s.value}</p>
          </div>
        ))}
      </div>
    </div>
  );
}

// ─── SVG Donut Chart ──────────────────────────────────────────────────────────
const DONUT_COLORS = ['#2563EB', '#F59E0B', '#8B5CF6', '#10B981', '#EF4444'];

function DonutChart({ data }: { data: TopProduct[] }) {
  const [hov, setHov] = useState<number | null>(null);
  const { formatMoneyShort: formatCurrencyShort } = useAppSettings();
  const total = data.reduce((s, p) => s + p.revenueCents, 0) || 1;
  const R = 58, cx = 75, cy = 75, sw = 22;
  let angle = -90;

  const arcs = data.slice(0, 5).map((p, i) => {
    const pct = p.revenueCents / total;
    const deg = pct * 360;
    const rad = (a: number) => (a * Math.PI) / 180;
    const x1 = cx + R * Math.cos(rad(angle));
    const y1 = cy + R * Math.sin(rad(angle));
    const x2 = cx + R * Math.cos(rad(angle + deg - 0.4));
    const y2 = cy + R * Math.sin(rad(angle + deg - 0.4));
    const path = `M${x1},${y1} A${R},${R} 0 ${deg > 180 ? 1 : 0} 1 ${x2},${y2}`;
    angle += deg;
    return { path, color: DONUT_COLORS[i], pct, name: p.name, rev: p.revenueCents, qty: p.qty };
  });

  const hovItem = hov !== null ? arcs[hov] : null;
  const totalQty = data.reduce((s, p) => s + p.qty, 0);

  if (data.length === 0) {
    return <div className="h-32 flex items-center justify-center text-slate-400 text-sm">No sales data yet</div>;
  }

  return (
    <div className="flex items-center gap-4">
      <div className="shrink-0">
        <svg width="150" height="150" viewBox="0 0 150 150">
          <circle cx={cx} cy={cy} r={R} fill="none" stroke="#f1f5f9" strokeWidth={sw} />
          {arcs.map((arc, i) => (
            <path key={i} d={arc.path} fill="none" stroke={arc.color}
              strokeWidth={hov === i ? sw + 5 : sw} strokeLinecap="butt"
              style={{ cursor: 'pointer', transition: 'stroke-width 0.15s' }}
              onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)} />
          ))}
          <text x={cx} y={cy - 8} textAnchor="middle" fontSize="10" fill="#94a3b8" fontWeight="500">Total</text>
          <text x={cx} y={cy + 10} textAnchor="middle" fontSize="17" fill="#1e293b" fontWeight="700">
            {hovItem ? `${Math.round(hovItem.pct * 100)}%` : totalQty.toLocaleString()}
          </text>
          {hovItem && (
            <text x={cx} y={cy + 24} textAnchor="middle" fontSize="8" fill="#94a3b8">
              {hovItem.name.length > 10 ? hovItem.name.slice(0, 10) + '…' : hovItem.name}
            </text>
          )}
        </svg>
      </div>
      <div className="flex-1 space-y-2 min-w-0">
        {arcs.map((arc, i) => (
          <div key={i} className="flex items-center justify-between gap-2 cursor-default"
            style={{ opacity: hov !== null && hov !== i ? 0.45 : 1, transition: 'opacity 0.15s' }}
            onMouseEnter={() => setHov(i)} onMouseLeave={() => setHov(null)}>
            <div className="flex items-center gap-1.5 min-w-0">
              <div className="w-2 h-2 rounded-full shrink-0" style={{ background: arc.color }} />
              <span className="text-xs text-slate-700 font-medium truncate">{arc.name}</span>
            </div>
            <div className="text-right shrink-0">
              <div className="text-xs font-bold text-slate-800">{Math.round(arc.pct * 100)}%</div>
              <div className="text-[10px] text-slate-400">{formatCurrencyShort(arc.rev)}</div>
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
          <button onClick={() => refetch()}
            className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 transition shadow-sm">
            <RefreshCw size={13} /> Refresh
          </button>
        </div>
      </div>

      {/* ── 6 KPI tiles ────────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3 flex-shrink-0">
        {([
          { label: 'Total Revenue',    value: formatCurrencyShort(kpis?.monthRevenueCents ?? 0),           bg: 'bg-blue-50',    iconColor: 'text-blue-600',    borderColor: '#2563EB', Icon: BarChart2,   to: '/sales' },
          { label: "Today's Orders",   value: String(kpis?.todayOrders ?? 0),                              bg: 'bg-violet-50',  iconColor: 'text-violet-600',  borderColor: '#7C3AED', Icon: ShoppingCart,to: '/sales' },
          { label: 'Inventory Value',  value: formatCurrencyShort(kpis?.inventoryValueCents ?? 0),         bg: 'bg-emerald-50', iconColor: 'text-emerald-600', borderColor: '#059669', Icon: Warehouse,   to: '/inventory' },
          { label: 'Low Stock',        value: String(lowStockData?.total ?? 0),                            bg: 'bg-amber-50',   iconColor: 'text-amber-600',   borderColor: '#D97706', Icon: PackageOpen, to: '/inventory' },
          { label: 'Receivables',      value: formatCurrencyShort(liveStats?.outstandingReceivablesCents ?? 0), bg: 'bg-cyan-50', iconColor: 'text-cyan-600',  borderColor: '#0891B2', Icon: CreditCard,  to: '/sales' },
          { label: 'Payables',         value: formatCurrencyShort(liveStats?.outstandingPayablesCents ?? 0),   bg: 'bg-rose-50', iconColor: 'text-rose-600',   borderColor: '#E11D48', Icon: Truck,       to: '/purchases' },
        ] as const).map(({ label, value, bg, iconColor, borderColor, Icon, to }) => (
          <Link key={label} to={to} className="block">
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-3 flex items-center gap-3 hover:shadow-md transition-shadow" style={{ borderLeft: `3px solid ${borderColor}` }}>
              <div className={cls('w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0', bg)}>
                <Icon size={18} className={iconColor} />
              </div>
              <div className="min-w-0">
                <p className="text-sm text-slate-500 truncate">{label}</p>
                <p className="text-xl font-bold text-slate-800 leading-tight">{value}</p>
              </div>
            </div>
          </Link>
        ))}
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

            {/* Top Products — horizontal bar list */}
            <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
              <div className="flex items-center justify-between mb-3 border-b-2 border-slate-200 pb-2">
                <h2 className="text-base font-bold text-slate-800">Top Products</h2>
                <Link to="/products"
                  className="text-xs text-blue-600 hover:text-blue-800 font-semibold flex items-center gap-1">
                  View all <ArrowRight size={11} />
                </Link>
              </div>
              {(data?.topProducts ?? []).length === 0 ? (
                <div className="h-24 flex items-center justify-center text-slate-400 text-sm">No sales data yet</div>
              ) : (() => {
                const maxRev = Math.max(...(data?.topProducts ?? []).map(p => p.revenueCents), 1);
                return (
                  <div className="space-y-3">
                    {(data?.topProducts ?? []).slice(0, 4).map(p => (
                      <div key={p.productId}>
                        <div className="flex justify-between text-xs mb-1">
                          <span className="text-slate-600 truncate max-w-[140px]">{p.name}</span>
                          <span className="text-slate-500 font-medium ml-2 flex-shrink-0">
                            {formatCurrencyShort(p.revenueCents)}
                          </span>
                        </div>
                        <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                          <div
                            className="h-full bg-blue-500 rounded-full"
                            style={{ width: `${Math.round((p.revenueCents / maxRev) * 100)}%` }}
                          />
                        </div>
                      </div>
                    ))}
                  </div>
                );
              })()}
            </div>

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
