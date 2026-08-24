import { useState } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  ComposedChart, Area, Bar, Line, CartesianGrid, XAxis, YAxis, Tooltip, ReferenceLine,
} from 'recharts';
import { ChartContainer, ChartTooltipContent, type ChartConfig } from '@/components/ui/chart';
import {
  TrendingUp, ShoppingCart, Package, Users, Warehouse, DollarSign,
  Download, RefreshCw, AlertTriangle, ChevronUp, ChevronDown, Search, X,
} from 'lucide-react';
import {
  reportsApi,
  formatMoney,
  formatMoneyShort,
  todayISO,
  thirtyDaysAgoISO,
  thisYearStartISO,
  type SalesReportData,
  type PurchasesReportData,
  type ProductReportData,
  type CustomerItem,
  type InventoryReportData,
  type ProfitLossData,
  type SlowMoverItem,
  type LowStockItem,
  type PnlComparisonResult,
} from '../../services/reports';
import { inventoryApi } from '../../services/inventory';
import { customersApi, suppliersApi } from '../../services/contacts';
import { warehousesApi } from '../../services/warehouses';
import { categoriesApi, brandsApi } from '../../services/masterData';
import {
  loadReportBranding, newReportDoc, reportLetterhead, kpiBand,
  sectionTitle, styledTable, finalizeReport, lastY, money,
} from '../../services/reportPdf';

// ─── Constants ────────────────────────────────────────────────────────────────

type ReportTab = 'sales' | 'purchases' | 'products' | 'customers' | 'inventory' | 'pl';

const TABS: { key: ReportTab; label: string; icon: React.ElementType; color: string }[] = [
  { key: 'sales',      label: 'Sales',             icon: TrendingUp,  color: 'indigo' },
  { key: 'purchases',  label: 'Purchases',          icon: ShoppingCart, color: 'blue'  },
  { key: 'products',   label: 'Products',           icon: Package,     color: 'violet' },
  { key: 'customers',  label: 'Customers',          icon: Users,       color: 'teal'  },
  { key: 'inventory',  label: 'Inventory',          icon: Warehouse,   color: 'amber' },
  { key: 'pl',         label: 'Profit & Loss',      icon: DollarSign,  color: 'green' },
];

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Cash', CARD: 'Card', BANK_TRANSFER: 'Bank Transfer', WALLET: 'Wallet', OTHER: 'Other',
};

// ─── Shared UI components ─────────────────────────────────────────────────────

function StatCard({
  label, value, sub, highlight = false, accent, trendPct,
}: {
  label: string; value: string; sub?: string; highlight?: boolean;
  accent?: string;      // Tailwind border-l colour class, e.g. 'border-emerald-400'
  trendPct?: number | null;  // % change vs previous period; renders a ▲/▼ badge
}) {
  return (
    <div
      className={`relative rounded-xl p-4 shadow-sm ${
        highlight
          ? 'bg-gradient-to-br from-indigo-600 to-indigo-700 text-white'
          : `bg-white border border-slate-200 ${accent ? `border-l-4 ${accent}` : ''}`
      }`}
    >
      <p className={`text-xs font-medium uppercase tracking-wide mb-1 ${highlight ? 'text-indigo-100' : 'text-slate-500'}`}>{label}</p>
      <p className={`text-2xl font-bold leading-tight ${highlight ? 'text-white' : 'text-slate-800'}`}>{value}</p>
      {sub && <p className={`text-xs mt-0.5 ${highlight ? 'text-indigo-100' : 'text-slate-400'}`}>{sub}</p>}
      {trendPct != null && (
        <span className={`inline-block text-xs font-medium mt-1 ${
          highlight
            ? (trendPct >= 0 ? 'text-emerald-200' : 'text-red-200')
            : (trendPct >= 0 ? 'text-emerald-600' : 'text-red-500')
        }`}>
          {trendPct >= 0 ? '▲' : '▼'} {Math.abs(trendPct)}% vs prev period
        </span>
      )}
    </div>
  );
}

function SectionHeader({ title, onPdf }: { title: string; onPdf: () => void }) {
  return (
    <div className="flex items-center justify-between mb-3">
      <h3 className="text-sm font-semibold text-slate-700">{title}</h3>
      <button
        onClick={onPdf}
        className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50"
      >
        <Download size={12} /> Export PDF
      </button>
    </div>
  );
}

/** CSS bar chart — no library needed */
function BarChart({
  data,
  labelKey,
  valueKey,
  color = 'indigo',
  maxBars = 14,
  formatValue = formatMoneyShort,
}: {
  data: Record<string, number | string>[];
  labelKey: string;
  valueKey: string;
  color?: string;
  maxBars?: number;
  formatValue?: (n: number) => string;
}) {
  const slice = data.slice(-maxBars);
  const max = Math.max(...slice.map((d) => Number(d[valueKey])), 1);
  const colors: Record<string, string> = {
    indigo: 'bg-indigo-500 group-hover:bg-indigo-600',
    blue:   'bg-blue-500 group-hover:bg-blue-600',
    green:  'bg-emerald-500 group-hover:bg-emerald-600',
    violet: 'bg-violet-500 group-hover:bg-violet-600',
    teal:   'bg-teal-500 group-hover:bg-teal-600',
    amber:  'bg-amber-400 group-hover:bg-amber-500',
  };

  // 144 px = h-36. Using explicit pixels instead of percentages because
  // height:% on a flex child resolves against the child's content height
  // (not the flex-row parent's h-36), collapsing all bars to 0.
  const BAR_H = 144;

  if (slice.length === 0) return (
    <div className="h-40 flex items-center justify-center text-slate-400 text-sm">No data</div>
  );

  return (
    <div className="flex items-end gap-1 w-full" style={{ height: `${BAR_H}px` }}>
      {slice.map((d, i) => {
        const val    = Number(d[valueKey]);
        const pct    = (val / max) * 100;
        const barPx  = Math.max(Math.round((pct / 100) * BAR_H), 2);
        return (
          <div key={i} className="flex-1 flex flex-col items-center gap-0 group relative">
            {/* Tooltip */}
            <div className="absolute bottom-full mb-1 left-1/2 -translate-x-1/2 bg-slate-800 text-white text-xs rounded px-1.5 py-0.5 whitespace-nowrap opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none z-10">
              {formatValue(val)}
            </div>
            <div
              className={`w-full rounded-t transition-all ${colors[color] ?? colors.indigo}`}
              style={{ height: `${barPx}px` }}
            />
            {slice.length <= 10 && (
              <span className="text-[9px] text-slate-400 truncate w-full text-center">
                {String(d[labelKey]).slice(5)}
              </span>
            )}
          </div>
        );
      })}
    </div>
  );
}

/** Horizontal bar for distribution charts */
function HBar({ label, value, total, color = 'bg-indigo-500', sub }: {
  label: string; value: number; total: number; color?: string; sub?: string;
}) {
  const pct = total > 0 ? (value / total) * 100 : 0;
  return (
    <div className="mb-3">
      <div className="flex justify-between text-sm mb-1">
        <span className="text-slate-700 font-medium truncate max-w-[60%]">{label}</span>
        <span className="text-slate-600 font-semibold">{formatMoneyShort(value)}</span>
      </div>
      <div className="h-2 bg-slate-100 rounded-full overflow-hidden">
        <div className={`h-full rounded-full ${color} transition-all`} style={{ width: `${Math.min(pct, 100)}%` }} />
      </div>
      {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
    </div>
  );
}

// ─── Report search ────────────────────────────────────────────────────────────
//
// Every report answered "how did the business do" but none answered "how did
// THIS one do" — five of the six tabs offered a date range and nothing else, so
// finding one supplier among forty, or one product among 3,264, meant reading
// the table. Only Inventory had a search box.
//
// Filtering is client-side on purpose. Each report already returns its full
// ranked list (top products, spend by supplier, customers by spend), so the
// rows are in the browser: matching them there is instant and needs no round
// trip. It narrows what is LISTED, and deliberately not the KPI totals above —
// those state the period's real figures, and silently rewriting them to match a
// search box would turn a report into something that quietly lies.

/** Case-insensitive substring match across the chosen fields of a row. */
function matchesQuery<T>(row: T, query: string, fields: ((r: T) => unknown)[]): boolean {
  const q = query.trim().toLowerCase();
  if (!q) return true;
  return fields.some((f) => String(f(row) ?? '').toLowerCase().includes(q));
}

// ─── Report scope ─────────────────────────────────────────────────────────────
//
// Two different jobs, deliberately kept apart:
//
//   ReportScope  narrows the REPORT — the server recomputes totals, charts and
//                breakdowns for one customer, supplier or warehouse.
//   ReportSearch narrows the LISTS on screen, leaving the figures alone.
//
// Collapsing them would mean either a search box that silently rewrites "Total
// Revenue", or a scope picker that cannot answer "how much did this customer
// actually spend". Both are needed and they are not the same question.

function ScopeSelect({
  label, value, onChange, options, allLabel,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { id: string; name: string }[];
  allLabel: string;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-slate-500">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className={`border rounded-lg px-2.5 py-1.5 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-200 ${
          value ? 'border-indigo-400 text-indigo-700 font-medium' : 'border-slate-200 text-slate-600'
        }`}
      >
        <option value="">{allLabel}</option>
        {options.map((o) => <option key={o.id} value={o.id}>{o.name}</option>)}
      </select>
    </label>
  );
}

/** Banner shown whenever a report is narrowed, so a scoped figure is never read as the whole business. */
function ScopeNotice({ what, onClear }: { what: string; onClear: () => void }) {
  return (
    <div className="flex items-center gap-2 mb-4 px-3 py-2 rounded-lg bg-indigo-50 border border-indigo-100 text-sm text-indigo-800">
      <span>Showing <strong>{what}</strong> only — every figure below is for this selection.</span>
      <button onClick={onClear} className="ml-auto text-xs font-medium text-indigo-600 hover:underline">
        Show all
      </button>
    </div>
  );
}

function ReportSearch({
  value, onChange, placeholder, shown, total,
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder: string;
  /** Rows after filtering, and before — shown only while a search is active. */
  shown?: number;
  total?: number;
}) {
  const active = value.trim().length > 0;
  return (
    <div className="flex items-center gap-3 mb-4">
      <div className="relative flex-1 max-w-md">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="w-full pl-9 pr-8 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
        {active && (
          <button
            type="button"
            onClick={() => onChange('')}
            className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-slate-400 hover:text-slate-600"
            title="Clear search"
          >
            <X size={13} />
          </button>
        )}
      </div>
      {/* Said out loud, so a filtered table is never mistaken for the whole one. */}
      {active && shown !== undefined && total !== undefined && (
        <span className="text-xs text-slate-500 whitespace-nowrap">
          <span className="font-semibold text-slate-700">{shown}</span> of {total} shown
        </span>
      )}
    </div>
  );
}

// ─── Date Range Picker ────────────────────────────────────────────────────────

type Preset = '30d' | '90d' | 'ytd' | 'custom';

function DateRangePicker({
  from, to, onFromChange, onToChange,
  groupBy, onGroupByChange,
  showGroupBy = false,
}: {
  from: string; to: string;
  onFromChange: (v: string) => void;
  onToChange: (v: string) => void;
  groupBy?: 'day' | 'week' | 'month';
  onGroupByChange?: (v: 'day' | 'week' | 'month') => void;
  showGroupBy?: boolean;
}) {
  const [preset, setPreset] = useState<Preset>('30d');

  const applyPreset = (p: Preset) => {
    setPreset(p);
    const today = todayISO();
    if (p === '30d') { onFromChange(thirtyDaysAgoISO()); onToChange(today); }
    else if (p === '90d') {
      const d = new Date(); d.setDate(d.getDate() - 89);
      onFromChange(d.toISOString().slice(0, 10)); onToChange(today);
    } else if (p === 'ytd') { onFromChange(thisYearStartISO()); onToChange(today); }
    else setPreset('custom');
  };

  const presets: { key: Preset; label: string }[] = [
    { key: '30d', label: 'Last 30 days' },
    { key: '90d', label: 'Last 90 days' },
    { key: 'ytd', label: 'Year to date' },
    { key: 'custom', label: 'Custom' },
  ];

  return (
    <div className="flex flex-wrap items-center gap-2 mb-6">
      {/* Preset pills */}
      <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
        {presets.map((p) => (
          <button
            key={p.key}
            onClick={() => applyPreset(p.key)}
            className={`px-3 py-1 rounded-md text-xs font-medium transition ${
              preset === p.key ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
          >
            {p.label}
          </button>
        ))}
      </div>

      {/* Date inputs */}
      <div className="flex items-center gap-1.5">
        <input
          type="date"
          value={from}
          onChange={(e) => { onFromChange(e.target.value); setPreset('custom'); }}
          className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <span className="text-slate-400 text-xs">to</span>
        <input
          type="date"
          value={to}
          onChange={(e) => { onToChange(e.target.value); setPreset('custom'); }}
          className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
      </div>

      {/* Group by */}
      {showGroupBy && groupBy && onGroupByChange && (
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {(['day', 'week', 'month'] as const).map((g) => (
            <button
              key={g}
              onClick={() => onGroupByChange(g)}
              className={`px-3 py-1 rounded-md text-xs font-medium capitalize transition ${
                groupBy === g ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {g}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Chart helpers ────────────────────────────────────────────────────────────

/**
 * Fill every calendar day between `from` and `to` with a zero-revenue entry
 * when the API doesn't return a row for that day. Without this, the chart
 * shows only days that had sales — making it look "empty" when all sales
 * cluster on one day.
 */
function fillDailyRange(
  data: { period: string; revenueCents: number; orders: number }[],
  from: string,
  to: string,
): { period: string; revenueCents: number; orders: number }[] {
  const byPeriod = new Map(data.map((d) => [d.period, d]));
  const result: { period: string; revenueCents: number; orders: number }[] = [];

  // Use noon UTC to avoid DST-boundary issues when stepping through days
  const cur = new Date(`${from}T12:00:00Z`);
  const end = new Date(`${to}T12:00:00Z`);

  while (cur <= end) {
    const period = cur.toISOString().slice(0, 10);
    result.push(byPeriod.get(period) ?? { period, revenueCents: 0, orders: 0 });
    cur.setUTCDate(cur.getUTCDate() + 1);
  }
  return result;
}

// ─── TopProductsTable ─────────────────────────────────────────────────────────

type SortKey = 'revenueCents' | 'qtySold' | 'marginPct';

function TopProductsTable({ products }: { products: SalesReportData['topProducts'] }) {
  const [sortKey, setSortKey] = useState<SortKey>('revenueCents');
  const [asc, setAsc] = useState(false);

  const toggle = (key: SortKey) => {
    if (sortKey === key) setAsc((a) => !a);
    else { setSortKey(key); setAsc(false); }
  };

  const sorted = [...products].sort((a, b) =>
    asc ? a[sortKey] - b[sortKey] : b[sortKey] - a[sortKey],
  );

  const Th = ({ label, col }: { label: string; col: SortKey }) => (
    <th
      className="text-right px-3 py-3 text-xs font-semibold text-slate-500 uppercase cursor-pointer select-none hover:text-slate-800"
      onClick={() => toggle(col)}
    >
      {label} {sortKey === col ? (asc ? '↑' : '↓') : ''}
    </th>
  );

  if (products.length === 0) {
    return <p className="text-sm text-slate-400 py-4">No product sales data for this period.</p>;
  }

  const totalQty     = sorted.reduce((s, p) => s + p.qtySold, 0);
  const totalRev     = sorted.reduce((s, p) => s + p.revenueCents, 0);
  const totalCogs    = sorted.reduce((s, p) => s + p.cogsCents, 0);
  const totalGP      = sorted.reduce((s, p) => s + p.grossProfitCents, 0);
  const avgMargin    = totalRev > 0 ? Math.round((totalGP / totalRev) * 1000) / 10 : 0;

  return (
    <div className="overflow-x-auto mt-1">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase w-8">#</th>
            <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase">Product</th>
            <th className="text-left px-3 py-3 text-xs font-semibold text-slate-500 uppercase hidden sm:table-cell">SKU</th>
            <Th label="Qty Sold" col="qtySold" />
            <Th label="Revenue" col="revenueCents" />
            <th className="text-right px-3 py-3 text-xs font-semibold text-slate-500 uppercase hidden lg:table-cell">COGS</th>
            <th className="text-right px-3 py-3 text-xs font-semibold text-slate-500 uppercase hidden lg:table-cell">Gross Profit</th>
            <Th label="Margin %" col="marginPct" />
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sorted.map((p, i) => (
            <tr key={p.productId} className="hover:bg-slate-50">
              <td className="px-3 py-2.5 text-slate-400 text-xs">{i + 1}</td>
              <td className="px-3 py-2.5 font-medium text-slate-800">{p.name}</td>
              <td className="px-3 py-2.5 text-slate-400 text-xs hidden sm:table-cell">{p.sku}</td>
              <td className="px-3 py-2.5 text-right text-slate-700">{p.qtySold.toFixed(1)}</td>
              <td className="px-3 py-2.5 text-right font-semibold text-slate-800">{formatMoney(p.revenueCents)}</td>
              <td className="px-3 py-2.5 text-right text-slate-500 hidden lg:table-cell">{formatMoney(p.cogsCents)}</td>
              <td className="px-3 py-2.5 text-right text-emerald-700 hidden lg:table-cell">{formatMoney(p.grossProfitCents)}</td>
              <td className="px-3 py-2.5 text-right">
                <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                  p.marginPct >= 30 ? 'bg-green-100 text-green-700'
                  : p.marginPct >= 10 ? 'bg-yellow-100 text-yellow-700'
                  : 'bg-red-100 text-red-600'
                }`}>
                  {p.marginPct}%
                </span>
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot className="border-t-2 border-slate-300 bg-slate-50">
          <tr>
            <td className="px-3 py-2.5 text-xs font-bold text-slate-600 uppercase" colSpan={2}>Total</td>
            <td className="px-3 py-2.5 text-xs text-slate-400 hidden sm:table-cell">—</td>
            <td className="px-3 py-2.5 text-right font-bold text-slate-800">{totalQty.toFixed(1)}</td>
            <td className="px-3 py-2.5 text-right font-bold text-slate-800">{formatMoney(totalRev)}</td>
            <td className="px-3 py-2.5 text-right font-bold text-slate-600 hidden lg:table-cell">{formatMoney(totalCogs)}</td>
            <td className="px-3 py-2.5 text-right font-bold text-emerald-700 hidden lg:table-cell">{formatMoney(totalGP)}</td>
            <td className="px-3 py-2.5 text-right">
              <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${
                avgMargin >= 30 ? 'bg-green-100 text-green-700'
                : avgMargin >= 10 ? 'bg-yellow-100 text-yellow-700'
                : 'bg-red-100 text-red-600'
              }`}>
                {avgMargin}%
              </span>
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ─── 1. Sales Report Tab ──────────────────────────────────────────────────────

function SalesTab() {
  const [from, setFrom] = useState(thirtyDaysAgoISO());
  const [to, setTo] = useState(todayISO());
  const [groupBy, setGroupBy] = useState<'day' | 'week' | 'month'>('day');
  const [q, setQ] = useState('');
  const [customerId, setCustomerId]   = useState('');
  const [warehouseId, setWarehouseId] = useState('');

  // Scope options. pageSize is generous because these are pickers, not tables —
  // a customer missing from the list would be a filter that cannot be applied.
  const { data: customerList } = useQuery({
    queryKey: ['report-scope-customers'],
    queryFn: () => customersApi.list({ pageSize: 100 }),
    staleTime: 5 * 60_000,
  });
  const { data: warehouseList } = useQuery({
    queryKey: ['report-scope-warehouses'],
    queryFn: () => warehousesApi.list({ pageSize: 200, isActive: true }),
    staleTime: 5 * 60_000,
  });

  // Scope is part of the key, so changing it refetches rather than showing a
  // stale unscoped report under a scoped heading.
  const { data, isLoading, refetch } = useQuery({
    queryKey: ['report-sales', from, to, groupBy, customerId, warehouseId],
    queryFn: () => reportsApi.sales({ from, to, groupBy, customerId: customerId || undefined, warehouseId: warehouseId || undefined }),
  });

  const scopeLabel = [
    customerId  ? customerList?.data.find((c) => c.id === customerId)?.name : null,
    warehouseId ? warehouseList?.items.find((w) => w.id === warehouseId)?.name : null,
  ].filter(Boolean).join(' · ');

  const exportPdf = async (d: SalesReportData) => {
    const { settings, logo } = await loadReportBranding();
    const doc = newReportDoc();
    const s = d.summary;
    let y = reportLetterhead(doc, { settings, logo, title: 'Sales Report', period: `${from} to ${to}` });
    y = kpiBand(doc, y, [
      { label: 'Total Revenue', value: money(s.totalRevenueCents, settings) },
      { label: 'Orders', value: String(s.orderCount) },
      { label: 'Avg Order', value: money(s.avgOrderCents, settings) },
      { label: 'Gross Profit', value: money(s.totalRevenueCents - s.totalCogsCents, settings), accent: true },
    ]);
    y = sectionTitle(doc, y, 'Revenue by period');
    styledTable(doc, {
      startY: y,
      head: [['Period', 'Orders', 'Revenue']],
      body: d.byPeriod.map((r) => [r.period, r.orders, formatMoney(r.revenueCents)]),
      foot: [['Total', d.byPeriod.reduce((a, r) => a + r.orders, 0), formatMoney(d.byPeriod.reduce((a, r) => a + r.revenueCents, 0))]],
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    });
    y = sectionTitle(doc, lastY(doc) + 8, 'By payment method');
    styledTable(doc, {
      startY: y,
      head: [['Payment Method', 'Orders', 'Revenue']],
      body: d.byPayment.map((r) => [PAYMENT_LABELS[r.method] ?? r.method, r.count, formatMoney(r.revenueCents)]),
      foot: [['Total', d.byPayment.reduce((a, r) => a + r.count, 0), formatMoney(d.byPayment.reduce((a, r) => a + r.revenueCents, 0))]],
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    });
    finalizeReport(doc, settings);
    doc.save(`Sales-Report-${from}-${to}.pdf`);
  };

  return (
    <div>
      <DateRangePicker
        from={from} to={to} onFromChange={setFrom} onToChange={setTo}
        groupBy={groupBy} onGroupByChange={setGroupBy} showGroupBy
      />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <ScopeSelect
          label="Customer" value={customerId} onChange={setCustomerId}
          allLabel="All customers"
          options={(customerList?.data ?? []).map((c) => ({ id: c.id, name: c.name }))}
        />
        <ScopeSelect
          label="Warehouse" value={warehouseId} onChange={setWarehouseId}
          allLabel="All warehouses"
          options={(warehouseList?.items ?? []).map((w) => ({ id: w.id, name: w.name }))}
        />
      </div>

      {scopeLabel && (
        <ScopeNotice what={scopeLabel} onClear={() => { setCustomerId(''); setWarehouseId(''); }} />
      )}

      <ReportSearch
        value={q} onChange={setQ}
        placeholder="Filter by product, SKU, warehouse or payment method…"
        shown={(data?.topProducts ?? []).filter((tp) => matchesQuery(tp, q, [(x) => x.name, (x) => x.sku])).length}
        total={(data?.topProducts ?? []).length}
      />

      {isLoading && <LoadingState />}
      {!isLoading && !data && <EmptyState />}
      {data && (
        <>
          {/* Summary cards */}
          {(() => {
            const revTrend = data.summary.prevPeriodRevenueCents > 0
              ? ((data.summary.totalRevenueCents - data.summary.prevPeriodRevenueCents)
                 / data.summary.prevPeriodRevenueCents * 100).toFixed(1)
              : null;
            return (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <StatCard
                  label="Total Revenue"
                  value={formatMoneyShort(data.summary.totalRevenueCents)}
                  sub={`${data.summary.orderCount} orders`}
                  highlight
                  trendPct={revTrend != null ? Number(revTrend) : null}
                />
                <StatCard label="Avg Order Value" value={formatMoney(data.summary.avgOrderCents)} />
                <StatCard
                  label="Gross Profit"
                  value={formatMoney(data.summary.totalRevenueCents - data.summary.totalCogsCents)}
                  sub={`${((data.summary.totalRevenueCents - data.summary.totalCogsCents) / Math.max(data.summary.totalRevenueCents, 1) * 100).toFixed(1)}% margin`}
                />
                <StatCard label="Discounts Given" value={formatMoneyShort(data.summary.totalDiscountCents)} />
              </div>
            );
          })()}

          {/* Revenue over time — filled so every day in the range shows a bar */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm mb-4">
            <SectionHeader title={`Revenue by ${groupBy}`} onPdf={() => exportPdf(data)} />
            <p className="text-sm text-slate-500 mb-3">
              {new Date(from).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              {' – '}
              {new Date(to).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
              {' · '}{data.summary.orderCount} orders
              {' · '}{formatMoney(data.summary.totalRevenueCents)} total
            </p>
            {data.summary.totalRevenueCents === 0 ? (
              <EmptyStateReport entity="sales" />
            ) : (
              <div className="h-48">
                <BarChart
                  data={groupBy === 'day' ? fillDailyRange(data.byPeriod, from, to) : data.byPeriod}
                  labelKey="period"
                  valueKey="revenueCents"
                  color="indigo"
                  maxBars={31}
                />
              </div>
            )}
          </div>

          {/* Two-column: warehouse + payment */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 mb-4">
            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">Revenue by Warehouse</h3>
              {data.byWarehouse.filter((w) => matchesQuery(w, q, [(x) => x.name, (x) => x.code])).length === 0
                ? <p className="text-sm text-slate-400">No data</p>
                : data.byWarehouse.filter((w) => matchesQuery(w, q, [(x) => x.name, (x) => x.code])).map((w) => (
                  <HBar key={w.code} label={w.name} value={w.revenueCents}
                    total={data.summary.totalRevenueCents}
                    sub={`${w.orders} orders`} color="bg-indigo-500" />
                ))}
            </div>

            <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-700 mb-4">Payment Methods</h3>
              {data.byPayment.filter((pm) => matchesQuery(pm, q, [(x) => PAYMENT_LABELS[x.method] ?? x.method])).length === 0
                ? <p className="text-sm text-slate-400">No data</p>
                : data.byPayment.filter((pm) => matchesQuery(pm, q, [(x) => PAYMENT_LABELS[x.method] ?? x.method])).map((p) => (
                  <HBar key={p.method} label={PAYMENT_LABELS[p.method] ?? p.method}
                    value={p.revenueCents} total={data.summary.totalRevenueCents}
                    sub={`${p.count} orders`} color="bg-violet-500" />
                ))}
            </div>
          </div>

          {/* Top 10 Products */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm mb-4">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700">Top 10 Products</h3>
              <a
                href={reportsApi.salesCsvUrl({ from, to, groupBy })}
                download
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50"
              >
                <Download size={12} /> Export CSV
              </a>
            </div>
            <TopProductsTable products={(data.topProducts ?? []).filter((tp) => matchesQuery(tp, q, [(x) => x.name, (x) => x.sku]))} />
          </div>
        </>
      )}
    </div>
  );
}

// ─── 2. Purchases Report Tab ──────────────────────────────────────────────────

function PurchasesTab() {
  const [from, setFrom] = useState(thirtyDaysAgoISO());
  const [to, setTo] = useState(todayISO());

  const [q, setQ] = useState('');
  const [supplierId, setSupplierId]   = useState('');
  const [warehouseId, setWarehouseId] = useState('');

  const { data: supplierList } = useQuery({
    queryKey: ['report-scope-suppliers'],
    queryFn: () => suppliersApi.list({ pageSize: 100 }),
    staleTime: 5 * 60_000,
  });
  const { data: warehouseList } = useQuery({
    queryKey: ['report-scope-warehouses'],
    queryFn: () => warehousesApi.list({ pageSize: 200, isActive: true }),
    staleTime: 5 * 60_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['report-purchases', from, to, supplierId, warehouseId],
    queryFn: () => reportsApi.purchases({ from, to, supplierId: supplierId || undefined, warehouseId: warehouseId || undefined }),
  });

  const scopeLabel = [
    supplierId  ? supplierList?.data.find((s) => s.id === supplierId)?.name : null,
    warehouseId ? warehouseList?.items.find((w) => w.id === warehouseId)?.name : null,
  ].filter(Boolean).join(' · ');

  const exportPdf = async (d: PurchasesReportData) => {
    const { settings, logo } = await loadReportBranding();
    const doc = newReportDoc();
    const s = d.summary;
    let y = reportLetterhead(doc, { settings, logo, title: 'Purchases Report', period: `${from} to ${to}` });
    y = kpiBand(doc, y, [
      { label: 'Total Spend', value: money(s.totalSpendCents, settings), accent: true },
      { label: 'Purchase Orders', value: String(s.poCount) },
      { label: 'Avg PO', value: money(s.avgPoCents, settings) },
    ]);
    y = sectionTitle(doc, y, 'Spend by supplier');
    styledTable(doc, {
      startY: y,
      head: [['Supplier', 'POs', 'Total Spend']],
      body: d.bySupplier.map((r) => [r.name, r.poCount, formatMoney(r.spendCents)]),
      foot: [['Total', d.bySupplier.reduce((a, r) => a + r.poCount, 0), formatMoney(d.bySupplier.reduce((a, r) => a + r.spendCents, 0))]],
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
    });
    finalizeReport(doc, settings);
    doc.save(`Purchases-Report-${from}-${to}.pdf`);
  };

  return (
    <div>
      <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <ScopeSelect
          label="Supplier" value={supplierId} onChange={setSupplierId}
          allLabel="All suppliers"
          options={(supplierList?.data ?? []).map((s) => ({ id: s.id, name: s.name }))}
        />
        <ScopeSelect
          label="Warehouse" value={warehouseId} onChange={setWarehouseId}
          allLabel="All warehouses"
          options={(warehouseList?.items ?? []).map((w) => ({ id: w.id, name: w.name }))}
        />
      </div>

      {scopeLabel && (
        <ScopeNotice what={scopeLabel} onClear={() => { setSupplierId(''); setWarehouseId(''); }} />
      )}

      <ReportSearch
        value={q} onChange={setQ}
        placeholder="Filter by supplier name…"
        shown={(data?.bySupplier ?? []).filter((sp) => matchesQuery(sp, q, [(x) => x.name])).length}
        total={(data?.bySupplier ?? []).length}
      />

      {isLoading && <LoadingState />}
      {!isLoading && !data && <EmptyState />}
      {data && data.summary.poCount === 0 && <EmptyStateReport entity="purchase" />}
      {data && data.summary.poCount > 0 && (
        <>
          <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
            <StatCard label="Total Spend"     value={formatMoneyShort(data.summary.totalSpendCents)} sub={`${data.summary.poCount} purchase orders`} highlight />
            <StatCard label="Avg PO Value"    value={formatMoney(data.summary.avgPoCents)} />
            <StatCard label="Items Received"  value={data.summary.totalItemsReceived.toFixed(0)} sub="units across all POs" />
            <StatCard label="Suppliers"       value={String(data.summary.uniqueSuppliers)} sub="unique suppliers" />
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm mb-4">
            <SectionHeader title="Spend Over Time" onPdf={() => exportPdf(data)} />
            <div className="h-48">
              <BarChart data={data.byPeriod} labelKey="period" valueKey="spendCents" color="blue" maxBars={30} />
            </div>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <h3 className="text-sm font-semibold text-slate-700 mb-4">Top Suppliers by Spend</h3>
            {data.bySupplier.filter((sp) => matchesQuery(sp, q, [(x) => x.name])).length === 0
              ? <p className="text-sm text-slate-400">{q.trim() ? 'No supplier matches this search' : 'No confirmed purchase orders in this period'}</p>
              : data.bySupplier.filter((sp) => matchesQuery(sp, q, [(x) => x.name])).map((s) => (
                <HBar key={s.name} label={s.name} value={s.spendCents}
                  total={data.summary.totalSpendCents}
                  sub={`${s.poCount} orders`} color="bg-blue-500" />
              ))}
          </div>
        </>
      )}
    </div>
  );
}

// ─── 3. Product Performance Tab ───────────────────────────────────────────────

function ProductsTab() {
  const [from, setFrom] = useState(thirtyDaysAgoISO());
  const [to, setTo] = useState(todayISO());
  const [view, setView] = useState<'revenue' | 'qty'>('revenue');
  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId]       = useState('');

  const { data: categories } = useQuery({
    queryKey: ['report-scope-categories'], queryFn: categoriesApi.list, staleTime: 5 * 60_000,
  });
  const { data: brands } = useQuery({
    queryKey: ['report-scope-brands'], queryFn: brandsApi.list, staleTime: 5 * 60_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['report-products', from, to, categoryId, brandId],
    queryFn: () => reportsApi.products({ from, to, categoryId: categoryId || undefined, brandId: brandId || undefined }),
  });

  const scopeLabel = [
    categoryId ? categories?.find((c) => c.id === categoryId)?.name : null,
    brandId    ? brands?.find((b) => b.id === brandId)?.name        : null,
  ].filter(Boolean).join(' · ');
  const [q, setQ] = useState('');

  const exportPdf = async (d: ProductReportData) => {
    const { settings, logo } = await loadReportBranding();
    const doc = newReportDoc();
    const rev = d.topByRevenue.reduce((a, r) => a + r.revenueCents, 0);
    const gp  = d.topByRevenue.reduce((a, r) => a + r.grossProfitCents, 0);
    let y = reportLetterhead(doc, { settings, logo, title: 'Product Performance', period: `${from} to ${to}` });
    y = kpiBand(doc, y, [
      { label: 'Top Products', value: String(d.topByRevenue.length) },
      { label: 'Revenue (shown)', value: money(rev, settings) },
      { label: 'Gross Profit (shown)', value: money(gp, settings), accent: true },
    ]);
    y = sectionTitle(doc, y, 'Top products by revenue');
    styledTable(doc, {
      startY: y,
      head: [['Product', 'SKU', 'Qty Sold', 'Revenue', 'COGS', 'Gross Profit', 'Margin']],
      body: d.topByRevenue.map((r) => [r.name, r.sku, r.qtySold.toFixed(1), formatMoney(r.revenueCents), formatMoney(r.cogsCents), formatMoney(r.grossProfitCents), `${r.marginPct}%`]),
      foot: [['Total (shown)', '', '', formatMoney(rev), formatMoney(d.topByRevenue.reduce((a, r) => a + r.cogsCents, 0)), formatMoney(gp), '']],
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
      fontSize: 7.5,
    });
    finalizeReport(doc, settings);
    doc.save(`Product-Performance-${from}-${to}.pdf`);
  };

  const allRows = data ? (view === 'revenue' ? data.topByRevenue : data.topByQty) : [];
  const list = allRows.filter((r) => matchesQuery(r, q, [(x) => x.name, (x) => x.sku]));
  const maxRev = Math.max(...list.map((p) => p.revenueCents), 1);

  return (
    <div>
      <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} />

      <div className="flex flex-wrap items-center gap-3 mb-4">
        <ScopeSelect
          label="Category" value={categoryId} onChange={setCategoryId}
          allLabel="All categories"
          options={(categories ?? []).map((c) => ({ id: c.id, name: c.name }))}
        />
        <ScopeSelect
          label="Brand" value={brandId} onChange={setBrandId}
          allLabel="All brands"
          options={(brands ?? []).map((b) => ({ id: b.id, name: b.name }))}
        />
      </div>

      {scopeLabel && (
        <ScopeNotice what={scopeLabel} onClear={() => { setCategoryId(''); setBrandId(''); }} />
      )}

      <ReportSearch
        value={q} onChange={setQ}
        placeholder="Filter by product name or SKU…"
        shown={list.length}
        total={allRows.length}
      />

      {isLoading && <LoadingState />}
      {data && (
        <>
          {/* KPI tiles — computed from the currently-visible list */}
          {(() => {
            const allItems     = [...data.topByRevenue, ...data.topByQty]
              .filter((v, i, a) => a.findIndex(x => x.productId === v.productId) === i);
            const totalRevenue = allItems.reduce((s, p) => s + p.revenueCents, 0);
            const totalQtySold = allItems.reduce((s, p) => s + p.qtySold, 0);
            const totalGP      = allItems.reduce((s, p) => s + p.grossProfitCents, 0);
            const avgMargin    = totalRevenue > 0 ? (totalGP / totalRevenue * 100) : 0;
            return (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <StatCard label="Total Revenue"  value={formatMoneyShort(totalRevenue)} highlight />
                <StatCard label="Units Sold"     value={totalQtySold.toFixed(0)} sub="across all products" />
                <StatCard label="Gross Profit"   value={formatMoneyShort(totalGP)} />
                <StatCard label="Avg Margin"     value={`${avgMargin.toFixed(1)}%`} sub="across portfolio" />
              </div>
            );
          })()}

          {/* View toggle */}
          <div className="flex items-center justify-between mb-4">
            <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
              <button onClick={() => setView('revenue')} className={`px-3 py-1 rounded-md text-xs font-medium transition ${view === 'revenue' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}>By Revenue</button>
              <button onClick={() => setView('qty')} className={`px-3 py-1 rounded-md text-xs font-medium transition ${view === 'qty' ? 'bg-white text-violet-700 shadow-sm' : 'text-slate-500'}`}>By Quantity</button>
            </div>
            <button onClick={() => exportPdf(data)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50">
              <Download size={12} /> Export PDF
            </button>
          </div>

          {list.length === 0
            ? <EmptyStateReport entity="products" />
            : (
              <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">#</th>
                      <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Product</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Qty Sold</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Revenue</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase hidden lg:table-cell">COGS</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase hidden lg:table-cell">Gross Profit</th>
                      <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Margin</th>
                      <th className="px-4 py-3 w-28 hidden md:table-cell" />
                    </tr>
                  </thead>
                  <tbody>
                    {list.map((p, i) => {
                      const barPct = (p.revenueCents / maxRev) * 100;
                      return (
                        <tr key={p.productId} className="border-b border-slate-100 hover:bg-slate-50">
                          <td className="px-4 py-3 text-slate-400 text-xs">{i + 1}</td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-800">{p.name}</p>
                            <p className="text-xs text-slate-400">{p.sku}</p>
                          </td>
                          <td className="px-4 py-3 text-right text-slate-700">{p.qtySold.toFixed(1)}</td>
                          <td className="px-4 py-3 text-right font-semibold text-slate-800">{formatMoney(p.revenueCents)}</td>
                          <td className="px-4 py-3 text-right text-slate-500 hidden lg:table-cell">{formatMoney(p.cogsCents)}</td>
                          <td className="px-4 py-3 text-right text-emerald-700 hidden lg:table-cell">{formatMoney(p.grossProfitCents)}</td>
                          <td className="px-4 py-3 text-right">
                            <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${p.marginPct >= 30 ? 'bg-green-100 text-green-700' : p.marginPct >= 10 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-600'}`}>
                              {p.marginPct}%
                            </span>
                          </td>
                          <td className="px-4 py-3 hidden md:table-cell">
                            <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                              <div className="h-full bg-violet-400 rounded-full" style={{ width: `${barPct}%` }} />
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
        </>
      )}
    </div>
  );
}

// ─── 4. Customer Insights Tab ─────────────────────────────────────────────────

function CustomersTab() {
  const [from, setFrom] = useState(thirtyDaysAgoISO());
  const [to, setTo] = useState(todayISO());
  const [q, setQ] = useState('');
  const [warehouseId, setWarehouseId] = useState('');

  const { data: whList } = useQuery({
    queryKey: ['report-scope-warehouses'],
    queryFn: () => warehousesApi.list({ pageSize: 100, isActive: true }),
    staleTime: 5 * 60_000,
  });

  const { data: customers, isLoading } = useQuery({
    queryKey: ['report-customers', from, to, warehouseId],
    queryFn: () => reportsApi.customers({ from, to, warehouseId: warehouseId || undefined }),
  });

  const exportPdf = async (d: CustomerItem[]) => {
    const { settings, logo } = await loadReportBranding();
    const doc = newReportDoc();
    const spent  = d.reduce((a, c) => a + c.totalSpentCents, 0);
  const [q, setQ] = useState('');
    const orders = d.reduce((a, c) => a + c.orderCount, 0);
    let y = reportLetterhead(doc, { settings, logo, title: 'Customer Insights', period: `${from} to ${to}` });
    y = kpiBand(doc, y, [
      { label: 'Customers', value: String(d.length) },
      { label: 'Orders', value: String(orders) },
      { label: 'Total Spent', value: money(spent, settings), accent: true },
    ]);
    y = sectionTitle(doc, y, 'Top customers by spend');
    styledTable(doc, {
      startY: y,
      head: [['Customer', 'Orders', 'Total Spent', 'Avg Order', 'Last Order']],
      body: d.map((c) => [c.name, c.orderCount, formatMoney(c.totalSpentCents), formatMoney(c.avgOrderCents), c.lastOrder]),
      foot: [['Total', orders, formatMoney(spent), '', '']],
      columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' } },
    });
    finalizeReport(doc, settings);
    doc.save(`Customer-Report-${from}-${to}.pdf`);
  };

  const total = customers?.reduce((s, c) => s + c.totalSpentCents, 0) ?? 0;

  return (
    <div>
      <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
      {/* Warehouse only. Narrowing a customer RANKING to one customer leaves a
          single row, which the customer detail page already shows better. */}
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <ScopeSelect
          label="Warehouse" value={warehouseId} onChange={setWarehouseId}
          allLabel="All warehouses"
          options={(whList?.items ?? []).map((w) => ({ id: w.id, name: w.name }))}
        />
      </div>

      {warehouseId && (
        <ScopeNotice
          what={whList?.items.find((w) => w.id === warehouseId)?.name ?? 'this warehouse'}
          onClear={() => setWarehouseId('')}
        />
      )}

      <ReportSearch
        value={q} onChange={setQ}
        placeholder="Filter by customer name…"
        shown={(customers ?? []).filter((c) => matchesQuery(c, q, [(x) => x.name])).length}
        total={(customers ?? []).length}
      />

      {isLoading && <LoadingState />}
      {customers && (
        <>
          {(() => {
            const totalOrders = customers.reduce((s, c) => s + c.orderCount, 0);
            const avgOrderVal = totalOrders > 0 ? Math.round(total / totalOrders) : 0;
            return (
              <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
                <StatCard label="Active Customers" value={String(customers.length)} sub="with purchases this period" highlight />
                <StatCard label="Total Revenue"    value={formatMoneyShort(total)} />
                <StatCard label="Avg Order Value"  value={avgOrderVal > 0 ? formatMoney(avgOrderVal) : '—'} sub="per transaction" />
                <StatCard
                  label="Top Customer"
                  value={customers[0]?.name ?? '—'}
                  sub={customers[0] ? formatMoney(customers[0].totalSpentCents) : ''}
                />
              </div>
            );
          })()}

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-700">Top Customers by Revenue</h3>
              <button onClick={() => exportPdf(customers)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50">
                <Download size={12} /> Export PDF
              </button>
            </div>
            {customers.length === 0
              ? <EmptyStateReport entity="customers" />
              : (
                <table className="w-full text-sm">
                  <thead className="bg-slate-50 border-b border-slate-200">
                    <tr>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">#</th>
                      <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Customer</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Orders</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Total Spent</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase hidden md:table-cell">Avg Order</th>
                      <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase hidden lg:table-cell">Last Order</th>
                      <th className="px-4 py-2.5 w-24 hidden md:table-cell" />
                    </tr>
                  </thead>
                  <tbody>
                    {customers.filter((c) => matchesQuery(c, q, [(x) => x.name])).map((c, i) => (
                      <tr key={c.customerId} className="border-b border-slate-100 hover:bg-slate-50">
                        <td className="px-4 py-3 text-xs text-slate-400">{i + 1}</td>
                        <td className="px-4 py-3 font-medium text-slate-800">{c.name}</td>
                        <td className="px-4 py-3 text-right text-slate-600">{c.orderCount}</td>
                        <td className="px-4 py-3 text-right font-semibold text-teal-700">{formatMoney(c.totalSpentCents)}</td>
                        <td className="px-4 py-3 text-right text-slate-500 hidden md:table-cell">{formatMoney(c.avgOrderCents)}</td>
                        <td className="px-4 py-3 text-right text-slate-400 text-xs hidden lg:table-cell">{c.lastOrder}</td>
                        <td className="px-4 py-3 hidden md:table-cell">
                          <div className="h-1.5 bg-slate-100 rounded-full overflow-hidden">
                            <div className="h-full bg-teal-400 rounded-full" style={{ width: `${(c.totalSpentCents / Math.max(customers[0]?.totalSpentCents ?? 1, 1)) * 100}%` }} />
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── 5. Inventory Valuation Tab ───────────────────────────────────────────────

// ─── LowStockPanel ────────────────────────────────────────────────────────────

function LowStockPanel({ items, count }: { items: LowStockItem[]; count: number }) {
  const [open, setOpen] = useState(count > 0);
  if (count === 0) return null;
  return (
    <div className="mb-4 border border-amber-200 rounded-xl overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-amber-50 text-left"
      >
        <span className="flex items-center gap-2 text-sm font-semibold text-amber-800">
          <AlertTriangle size={15} /> {count} product{count !== 1 ? 's' : ''} below reorder level
        </span>
        {open ? <ChevronUp size={14} className="text-amber-600" /> : <ChevronDown size={14} className="text-amber-600" />}
      </button>
      {open && (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-amber-50 border-y border-amber-100">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-semibold text-amber-700 uppercase">Product</th>
                <th className="text-left px-4 py-2 text-xs font-semibold text-amber-700 uppercase hidden sm:table-cell">SKU</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-amber-700 uppercase">In Stock</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-amber-700 uppercase">Reorder At</th>
                <th className="text-right px-4 py-2 text-xs font-semibold text-amber-700 uppercase">Short By</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100 bg-white">
              {items.map((i) => (
                <tr key={i.productId} className="hover:bg-amber-50/30">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{i.name}</td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs hidden sm:table-cell">{i.sku}</td>
                  <td className="px-4 py-2.5 text-right text-slate-700">{i.totalQty.toFixed(1)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-500">{i.reorderLevel}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-red-600">{i.deficit.toFixed(1)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── SlowMoversTable ──────────────────────────────────────────────────────────

function daysAgo(dateStr: string | null): string {
  if (!dateStr) return 'Never';
  const diff = Math.floor((Date.now() - new Date(dateStr).getTime()) / 86_400_000);
  return diff === 0 ? 'Today' : `${diff} day${diff !== 1 ? 's' : ''} ago`;
}

function SlowMoversTable({ items }: { items: SlowMoverItem[] }) {
  return (
    <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mt-4">
      <div className="px-4 py-3 border-b border-slate-200">
        <h3 className="text-sm font-semibold text-slate-700">Slow Movers — no sales in last 30 days</h3>
      </div>
      {items.length === 0 ? (
        <p className="px-4 py-6 text-sm text-emerald-700 flex items-center gap-2">
          <span>✓</span> All stocked products had sales activity in the last 30 days.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Product</th>
                <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase hidden sm:table-cell">SKU</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Stock Qty</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Stock Value</th>
                <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Last Sold</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {items.map((i) => (
                <tr key={i.productId} className="hover:bg-slate-50">
                  <td className="px-4 py-2.5 font-medium text-slate-800">{i.name}</td>
                  <td className="px-4 py-2.5 text-slate-400 text-xs hidden sm:table-cell">{i.sku}</td>
                  <td className="px-4 py-2.5 text-right text-slate-700">{i.totalQty.toFixed(1)}</td>
                  <td className="px-4 py-2.5 text-right font-semibold text-amber-700">{formatMoney(i.costValueCents)}</td>
                  <td className="px-4 py-2.5 text-right text-slate-500 text-xs">{daysAgo(i.lastSaleDate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function InventoryTab() {
  const [warehouseId, setWarehouseId] = useState('');
  const [search, setSearch] = useState('');
  const [sortDir, setSortDir] = useState<'desc' | 'asc'>('desc');

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: inventoryApi.getWarehouses,
  });

  const [categoryId, setCategoryId] = useState('');
  const [brandId, setBrandId]       = useState('');

  const { data: categories } = useQuery({
    queryKey: ['report-scope-categories'], queryFn: categoriesApi.list, staleTime: 5 * 60_000,
  });
  const { data: brands } = useQuery({
    queryKey: ['report-scope-brands'], queryFn: brandsApi.list, staleTime: 5 * 60_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['report-inventory', warehouseId, categoryId, brandId],
    queryFn: () => reportsApi.inventory({
      warehouseId: warehouseId || undefined,
      categoryId:  categoryId  || undefined,
      brandId:     brandId     || undefined,
    }),
  });

  const exportPdf = async (d: InventoryReportData) => {
    const { settings, logo } = await loadReportBranding();
    const doc = newReportDoc('landscape');
    const t = d.totals;
    let y = reportLetterhead(doc, { settings, logo, title: 'Inventory Valuation', period: warehouseId ? 'Warehouse filtered' : 'All warehouses' });
    y = kpiBand(doc, y, [
      { label: 'Cost Value', value: money(t.totalCostValueCents, settings), accent: true },
      { label: 'Sale Value', value: money(t.totalSaleValueCents, settings) },
      { label: 'Potential Margin', value: money(t.totalMarginCents, settings) },
    ]);
    styledTable(doc, {
      startY: y,
      head: [['Product', 'SKU', 'Qty', 'Avg Cost', 'Last Cost', 'Unit Price', 'Cost Value', 'Sale Value', 'Margin']],
      body: d.items.map((r) => [r.name, r.sku, r.totalQty.toFixed(1), formatMoney(r.costCents), r.lastCostCents ? formatMoney(r.lastCostCents) : '—', formatMoney(r.priceCents), formatMoney(r.costValueCents), formatMoney(r.saleValueCents), formatMoney(r.potentialMarginCents)]),
      foot: [['Total', '', '', '', '', '', formatMoney(t.totalCostValueCents), formatMoney(t.totalSaleValueCents), formatMoney(t.totalMarginCents)]],
      columnStyles: { 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' }, 7: { halign: 'right' }, 8: { halign: 'right' } },
      fontSize: 7.5,
    });
    finalizeReport(doc, settings);
    doc.save('Inventory-Valuation.pdf');
  };

  const filtered = (data?.items ?? [])
    .filter((i) => !search || i.name.toLowerCase().includes(search.toLowerCase()) || i.sku.toLowerCase().includes(search.toLowerCase()))
    .sort((a, b) => sortDir === 'desc' ? b.costValueCents - a.costValueCents : a.costValueCents - b.costValueCents);

  return (
    <div>
      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-6">
        <select
          value={warehouseId}
          onChange={(e) => setWarehouseId(e.target.value)}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Warehouses</option>
          {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <ScopeSelect
          label="Category" value={categoryId} onChange={setCategoryId}
          allLabel="All categories"
          options={(categories ?? []).map((c) => ({ id: c.id, name: c.name }))}
        />
        <ScopeSelect
          label="Brand" value={brandId} onChange={setBrandId}
          allLabel="All brands"
          options={(brands ?? []).map((b) => ({ id: b.id, name: b.name }))}
        />
        {/* Inventory already had a search; it keeps its place beside the
            warehouse filter, and gains the icon, clear button and match count
            the other five tabs now have. */}
        <div className="flex-1 min-w-[220px] max-w-md -mb-4">
          <ReportSearch
            value={search} onChange={setSearch}
            placeholder="Filter by product name or SKU…"
            shown={filtered.length}
            total={(data?.items ?? []).length}
          />
        </div>
      </div>

      {isLoading && <LoadingState />}
      {data && (
        <>
          {/* Summary cards */}
          <div className="grid grid-cols-2 lg:grid-cols-5 gap-4 mb-6">
            <StatCard label="Total Stock Value" value={formatMoneyShort(data.totals.totalCostValueCents)} sub="at cost price" highlight />
            <StatCard label="Retail Value" value={formatMoneyShort(data.totals.totalSaleValueCents)} sub="at selling price" />
            <StatCard label="Potential Margin" value={formatMoneyShort(data.totals.totalMarginCents)} sub="retail − cost" />
            <StatCard label="Total SKUs" value={String(data.totals.skuCount)} sub="active products" />
            <StatCard
              label="Low Stock SKUs"
              value={String(data.totals.lowStockCount)}
              sub={`of ${data.totals.skuCount} below reorder`}
            />
          </div>

          {/* Stock health summary bar */}
          <div className="flex flex-wrap gap-4 text-sm text-slate-600 mb-4 p-3 bg-slate-50 rounded-lg border border-slate-200">
            <span>📦 {data.totals.skuCount} products tracked</span>
            <span>⚠️ {data.totals.lowStockCount} below reorder</span>
            <span>💰 {formatMoney(data.totals.totalCostValueCents)} tied up in stock</span>
            <span>📈 {formatMoney(data.totals.totalMarginCents)} potential margin</span>
          </div>

          <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
            <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
              <h3 className="text-sm font-semibold text-slate-700">{filtered.length} products</h3>
              <div className="flex items-center gap-2">
                <button onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')} className="flex items-center gap-1 text-xs text-slate-500 hover:text-slate-700">
                  Cost Value {sortDir === 'desc' ? <ChevronDown size={12} /> : <ChevronUp size={12} />}
                </button>
                <button onClick={() => exportPdf(data)} className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50">
                  <Download size={12} /> Export PDF
                </button>
              </div>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-slate-50 border-b border-slate-200">
                  <tr>
                    <th className="text-left px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Product</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Qty</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Avg Cost</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Last Cost</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Unit Price</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Cost Value</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Sale Value</th>
                    <th className="text-right px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Margin</th>
                    <th className="text-center px-4 py-2.5 text-xs font-semibold text-slate-500 uppercase">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.slice(0, 100).map((item) => (
                    <tr key={item.productId} className="border-b border-slate-100 hover:bg-slate-50">
                      <td className="px-4 py-2.5">
                        <p className="font-medium text-slate-800">{item.name}</p>
                        <p className="text-xs text-slate-400">{item.sku}</p>
                      </td>
                      <td className="px-4 py-2.5 text-right text-slate-700">{item.totalQty.toFixed(1)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500">{formatMoney(item.costCents)}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500">{item.lastCostCents ? formatMoney(item.lastCostCents) : '—'}</td>
                      <td className="px-4 py-2.5 text-right text-slate-500">{formatMoney(item.priceCents)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-amber-700">{formatMoney(item.costValueCents)}</td>
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{formatMoney(item.saleValueCents)}</td>
                      <td className="px-4 py-2.5 text-right text-emerald-700 font-medium">{formatMoney(item.potentialMarginCents)}</td>
                      <td className="px-4 py-2.5 text-center">
                        {item.isLowStock ? (
                          <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-xs font-medium bg-red-100 text-red-700">
                            <AlertTriangle size={10} /> Low
                          </span>
                        ) : (
                          <span className="px-1.5 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">OK</span>
                        )}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {filtered.length > 100 && (
              <div className="px-4 py-2 text-xs text-slate-400 border-t border-slate-100">
                Showing first 100 of {filtered.length} products. Use search to narrow down.
              </div>
            )}
          </div>

          <LowStockPanel items={data.lowStockItems ?? []} count={data.totals.lowStockCount} />
          <SlowMoversTable items={data.slowMovers ?? []} />
        </>
      )}
    </div>
  );
}

// ─── Compare Periods Panel ────────────────────────────────────────────────────

function ComparePeriodsPanel() {
  const [open, setOpen]             = useState(false);
  const [dateFrom, setDateFrom]     = useState('');
  const [dateTo, setDateTo]         = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [enabled, setEnabled]       = useState(false);

  const { data, isFetching } = useQuery<PnlComparisonResult>({
    queryKey: ['pnl-compare', dateFrom, dateTo, warehouseId],
    queryFn:  () => reportsApi.pnlComparison({ dateFrom, dateTo, warehouseId: warehouseId || undefined }),
    enabled:  enabled && !!dateFrom && !!dateTo,
  });

  const { data: warehouses = [] } = useQuery<{ id: string; name: string }[]>({
    queryKey: ['warehouses-pnl'],
    queryFn:  inventoryApi.getWarehouses,
  });

  const formatRs = (cents: number) =>
    `Rs. ${(cents / 100).toLocaleString('en-LK', { minimumFractionDigits: 2 })}`;
  const fmtPct   = (v: number) => `${v.toFixed(1)}%`;
  const valClass = (v: number) => v >= 0 ? 'text-green-600' : 'text-red-600';

  type Row = { label: string; curr: number; prev: number; bold?: boolean; separator?: boolean };

  const rows: Row[] = data ? [
    { label: 'Revenue',           curr:  data.current.revenue,         prev: data.previous.revenue },
    { label: 'Cost of Goods Sold',curr: -data.current.cogs,            prev: -data.previous.cogs },
    { label: 'Purchase Returns',  curr:  data.current.purchaseReturns, prev: data.previous.purchaseReturns },
    { separator: true, label: '', curr: 0, prev: 0 },
    { label: 'Gross Profit',      curr:  data.current.grossProfit,     prev: data.previous.grossProfit, bold: true },
    { label: 'Gross Margin %',    curr:  data.current.grossMarginPct,  prev: data.previous.grossMarginPct },
    { separator: true, label: '', curr: 0, prev: 0 },
    { label: 'Operating Expenses',curr: -data.current.expenses,        prev: -data.previous.expenses },
    { separator: true, label: '', curr: 0, prev: 0 },
    { label: 'NET PROFIT',        curr:  data.current.netProfit,       prev: data.previous.netProfit, bold: true },
    { label: 'Net Margin %',      curr:  data.current.netMarginPct,    prev: data.previous.netMarginPct },
  ] : [];

  const isPct = (label: string) => label.includes('%');

  return (
    <div className="mt-6 border border-slate-200 rounded-lg overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-slate-100 text-sm font-semibold text-slate-700 transition"
      >
        Compare Two Periods
        <span className="text-slate-400">{open ? '▲' : '▼'}</span>
      </button>

      {open && (
        <div className="p-4 space-y-4">
          <div className="flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs text-slate-500 mb-1">From</label>
              <input type="date" value={dateFrom}
                onChange={(e) => { setDateFrom(e.target.value); setEnabled(false); }}
                className="border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">To</label>
              <input type="date" value={dateTo}
                onChange={(e) => { setDateTo(e.target.value); setEnabled(false); }}
                className="border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs text-slate-500 mb-1">Warehouse</label>
              <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}
                className="border border-slate-300 rounded px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                <option value="">All</option>
                {warehouses.map((w) => (
                  <option key={w.id} value={w.id}>{w.name}</option>
                ))}
              </select>
            </div>
            <button
              onClick={() => setEnabled(true)}
              disabled={!dateFrom || !dateTo}
              className="px-4 py-1.5 bg-indigo-600 text-white rounded text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition"
            >
              {isFetching ? 'Loading…' : 'Generate'}
            </button>
          </div>

          {data && (
            <>
              <table className="w-full text-sm border-collapse">
                <thead>
                  <tr className="bg-slate-50">
                    <th className="text-left py-2 px-3 border-b border-slate-200 font-medium text-slate-600 text-xs"></th>
                    <th className="text-right py-2 px-3 border-b border-slate-200 font-medium text-slate-600 text-xs">Current Period</th>
                    <th className="text-right py-2 px-3 border-b border-slate-200 font-medium text-slate-600 text-xs">Previous Period</th>
                  </tr>
                </thead>
                <tbody>
                  {rows.map((row, i) =>
                    row.separator ? (
                      <tr key={i}><td colSpan={3} className="border-t border-slate-100 py-0.5" /></tr>
                    ) : (
                      <tr key={i} className={
                        row.label === 'NET PROFIT'
                          ? (row.curr >= 0 ? 'bg-green-50' : 'bg-red-50')
                          : 'hover:bg-slate-50'
                      }>
                        <td className={`py-2 px-3 text-slate-700 ${row.bold ? 'font-bold' : ''}`}>{row.label}</td>
                        <td className={`text-right py-2 px-3 ${row.bold ? 'font-bold' : ''} ${valClass(row.curr)}`}>
                          {isPct(row.label) ? fmtPct(row.curr) : formatRs(row.curr)}
                        </td>
                        <td className={`text-right py-2 px-3 ${row.bold ? 'font-bold' : ''} ${valClass(row.prev)}`}>
                          {isPct(row.label) ? fmtPct(row.prev) : formatRs(row.prev)}
                        </td>
                      </tr>
                    )
                  )}
                </tbody>
              </table>
              <button onClick={() => window.print()} className="text-sm text-indigo-600 hover:underline">
                Print Comparison
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

// ─── 6. Profit & Loss Tab ─────────────────────────────────────────────────────

// ─── P&L trend ────────────────────────────────────────────────────────────────
//
// Replaces two stacked hand-rolled bar charts — gross profit above, net profit
// below — which forced the eye to compare two series across a gap, on two
// independent scales, with no way to read a single month across both.
//
// One composed chart on a shared axis instead: revenue as a soft gradient for
// context, gross profit as bars, net profit as a line that can dip below the
// zero rule. Recharts animates on mount, and the shared ChartContainer publishes
// --color-* variables so the series follow the app theme in light and dark
// exactly as the Dashboard does.
function PLTrendChart({ rows }: { rows: ProfitLossData['byPeriod'] }) {
  const config: ChartConfig = {
    revenue:     { label: 'Revenue',      color: 'hsl(238 75% 62%)' },
    grossProfit: { label: 'Gross Profit', color: 'hsl(160 70% 42%)' },
    netProfit:   { label: 'Net Profit',   color: 'hsl(217 85% 58%)' },
  };

  // Cents are kept as the plotted values and formatted at the edges, so no
  // rounding is introduced between the table and the chart.
  const data = rows.slice(-12).map((r) => ({
    period:      r.period,
    revenue:     r.revenueCents,
    grossProfit: r.grossProfitCents,
    netProfit:   r.netProfitCents,
  }));

  const monthLabel = (iso: string) =>
    new Date(iso).toLocaleDateString('en-US', { month: 'short', year: '2-digit' });

  // A zero rule only earns its place when something actually crosses it.
  const hasLoss = data.some((d) => d.netProfit < 0);

  // One period is not a trend: an area and a line have nothing to span, and
  // would render as an orphaned dot beside a lone bar. The same three figures
  // are shown side by side instead, which is what a single month can honestly
  // say. The chart becomes a trend on its own once a second month exists.
  const single = data.length < 2;
  if (single) {
    return (
      <div>
        <ChartContainer config={config} className="h-[260px]">
          <ComposedChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
            <CartesianGrid vertical={false} strokeDasharray="3 3" />
            <XAxis dataKey="period" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={monthLabel} />
            <YAxis tickLine={false} axisLine={false} width={58} tickFormatter={(v: number) => formatMoneyShort(v)} />
            <Tooltip
              cursor={{ fill: 'hsl(var(--muted))', opacity: 0.35 }}
              content={<ChartTooltipContent labelFormatter={(l) => monthLabel(String(l))} formatter={(value) => formatMoney(Number(value))} />}
            />
            {hasLoss && <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1.5} />}
            <Bar dataKey="revenue"     fill="var(--color-revenue)"     radius={[5, 5, 0, 0]} maxBarSize={54} animationDuration={800} />
            <Bar dataKey="grossProfit" fill="var(--color-grossProfit)" radius={[5, 5, 0, 0]} maxBarSize={54} animationDuration={800} animationBegin={110} />
            <Bar dataKey="netProfit"   fill="var(--color-netProfit)"   radius={[5, 5, 0, 0]} maxBarSize={54} animationDuration={800} animationBegin={220} />
          </ComposedChart>
        </ChartContainer>
        <p className="text-xs text-slate-400 mt-1">
          One month in this range — the trend lines appear once a second month has data.
        </p>
      </div>
    );
  }

  return (
    <ChartContainer config={config} className="h-[260px]">
      <ComposedChart data={data} margin={{ top: 10, right: 8, bottom: 0, left: 0 }}>
        <defs>
          <linearGradient id="fillPLRevenue" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--color-revenue)" stopOpacity={0.20} />
            <stop offset="100%" stopColor="var(--color-revenue)" stopOpacity={0.01} />
          </linearGradient>
          <linearGradient id="fillPLGross" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%"   stopColor="var(--color-grossProfit)" stopOpacity={0.95} />
            <stop offset="100%" stopColor="var(--color-grossProfit)" stopOpacity={0.55} />
          </linearGradient>
        </defs>

        <CartesianGrid vertical={false} strokeDasharray="3 3" />
        <XAxis dataKey="period" tickLine={false} axisLine={false} tickMargin={8} tickFormatter={monthLabel} />
        <YAxis tickLine={false} axisLine={false} width={58} tickFormatter={(v: number) => formatMoneyShort(v)} />
        <Tooltip
          cursor={{ fill: 'hsl(var(--muted))', opacity: 0.35 }}
          content={
            <ChartTooltipContent
              labelFormatter={(l) => monthLabel(String(l))}
              formatter={(value) => formatMoney(Number(value))}
            />
          }
        />

        {hasLoss && <ReferenceLine y={0} stroke="hsl(var(--border))" strokeWidth={1.5} />}

        <Area
          type="monotone"
          dataKey="revenue"
          stroke="var(--color-revenue)"
          strokeWidth={2}
          fill="url(#fillPLRevenue)"
          animationDuration={900}
        />
        <Bar
          dataKey="grossProfit"
          fill="url(#fillPLGross)"
          radius={[5, 5, 0, 0]}
          maxBarSize={40}
          animationDuration={900}
          animationBegin={120}
        />
        <Line
          type="monotone"
          dataKey="netProfit"
          stroke="var(--color-netProfit)"
          strokeWidth={2.4}
          dot={{ r: 3, strokeWidth: 0, fill: 'var(--color-netProfit)' }}
          activeDot={{ r: 5 }}
          animationDuration={1000}
          animationBegin={260}
        />
      </ComposedChart>
    </ChartContainer>
  );
}

function ProfitLossTab() {
  const [from, setFrom] = useState(thirtyDaysAgoISO());
  const [to, setTo] = useState(todayISO());
  const [q, setQ] = useState('');
  const [warehouseId, setWarehouseId] = useState('');

  const { data: whList } = useQuery({
    queryKey: ['report-scope-warehouses'],
    queryFn: () => warehousesApi.list({ pageSize: 100, isActive: true }),
    staleTime: 5 * 60_000,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['report-pl', from, to, warehouseId],
    queryFn: () => reportsApi.profitLoss({ from, to, warehouseId: warehouseId || undefined }),
  });

  const exportPdf = async (d: ProfitLossData) => {
    const { settings, logo } = await loadReportBranding();
    const doc = newReportDoc();
    const s = d.summary;
    let y = reportLetterhead(doc, { settings, logo, title: 'Profit & Loss Summary', period: `${from} to ${to}` });
    y = kpiBand(doc, y, [
      { label: 'Total Revenue', value: money(s.revenueCents, settings) },
      { label: 'Gross Profit', value: money(s.grossProfitCents, settings) },
      { label: 'Net Profit', value: money(s.netProfitCents, settings), accent: true },
    ]);
    const expenseRows = d.expensesByCategory.map((c) => [`    ${c.name}`, `- ${formatMoney(c.totalCents)}`]);
    y = sectionTitle(doc, y, 'Statement');
    styledTable(doc, {
      startY: y,
      theme: 'plain',
      body: [
        ['Total Revenue', formatMoney(s.revenueCents)],
        ['Tax Collected', formatMoney(s.taxCents)],
        ['Discounts', `- ${formatMoney(s.discountCents)}`],
        ['COGS (Cost of Goods Sold)', `- ${formatMoney(s.cogsCents)}`],
        ['Gross Profit', formatMoney(s.grossProfitCents)],
        ['Gross Margin', `${s.grossMarginPct}%`],
        ['Operating Expenses', ''],
        ...expenseRows,
        ['Total Expenses', `- ${formatMoney(s.totalExpensesCents)}`],
      ],
      foot: [['NET PROFIT', `${formatMoney(s.netProfitCents)}   (${s.netMarginPct}%)`]],
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 90 }, 1: { halign: 'right' } },
      fontSize: 9,
    });
    if (d.byPeriod.length > 0) {
      y = sectionTitle(doc, lastY(doc) + 8, 'Monthly breakdown');
      styledTable(doc, {
        startY: y,
        head: [['Month', 'Revenue', 'COGS', 'Gross Profit', 'Gross Margin', 'Expenses', 'Net Profit']],
        body: d.byPeriod.map((r) => [new Date(r.period).toLocaleDateString('en-US', { month: 'long', year: 'numeric' }), formatMoney(r.revenueCents), formatMoney(r.cogsCents), formatMoney(r.grossProfitCents), `${r.grossMarginPct}%`, formatMoney(r.expensesCents), formatMoney(r.netProfitCents)]),
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' }, 3: { halign: 'right' }, 4: { halign: 'right' }, 5: { halign: 'right' }, 6: { halign: 'right' } },
      });
    }
    finalizeReport(doc, settings);
    doc.save(`ProfitLoss-${from}-${to}.pdf`);
  };

  return (
    <div>
      <DateRangePicker from={from} to={to} onFromChange={setFrom} onToChange={setTo} />
      <div className="flex flex-wrap items-center gap-3 mb-4">
        <ScopeSelect
          label="Warehouse" value={warehouseId} onChange={setWarehouseId}
          allLabel="All warehouses"
          options={(whList?.items ?? []).map((w) => ({ id: w.id, name: w.name }))}
        />
      </div>

      {warehouseId && (
        <ScopeNotice
          what={whList?.items.find((w) => w.id === warehouseId)?.name ?? 'this warehouse'}
          onClear={() => setWarehouseId('')}
        />
      )}

      <ReportSearch
        value={q} onChange={setQ}
        placeholder="Filter by month or expense category…"
      />

      {isLoading && <LoadingState />}
      {data && (
        <>
          {/* Warning: expenses heavily exceed revenue */}
          {data.summary.totalExpensesCents > data.summary.revenueCents * 3 && (
            <div className="bg-amber-50 border border-amber-200 rounded-lg p-3 text-amber-800 text-sm mb-4 flex items-start gap-2">
              <span>⚠️</span>
              <span>
                Expenses are significantly higher than revenue for this period.
                Check your date range or review recurring expense entries.
              </span>
            </div>
          )}

          {/* Hero P&L cards */}
          <div className="grid grid-cols-2 lg:grid-cols-3 xl:grid-cols-6 gap-4 mb-6">
            <StatCard label="Total Revenue" value={formatMoneyShort(data.summary.revenueCents)} sub={`${data.summary.orderCount} orders`} highlight />
            <StatCard label="COGS" value={formatMoneyShort(data.summary.cogsCents)} sub="Cost of goods sold" />
            <StatCard label="Gross Profit" value={formatMoneyShort(data.summary.grossProfitCents)} sub={`${data.summary.grossMarginPct}% margin`} accent="border-emerald-400" />
            <StatCard label="Total Expenses" value={formatMoneyShort(data.summary.totalExpensesCents)} sub="Operating expenses" accent="border-amber-400" />
            <StatCard label="Net Profit" value={formatMoneyShort(data.summary.netProfitCents)} sub={`${data.summary.netMarginPct}% net margin`} accent={data.summary.netProfitCents >= 0 ? 'border-emerald-400' : 'border-red-400'} />
            <StatCard label="Orders" value={String(data.summary.orderCount)} sub="Confirmed sales" />
          </div>

          {/* P&L waterfall summary */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm mb-4">
            <SectionHeader title="Income Statement Summary" onPdf={() => exportPdf(data)} />
            <div className="space-y-2 max-w-md">
              {[
                { label: 'Revenue', value: data.summary.revenueCents, type: 'income' },
                { label: '- Tax Collected', value: data.summary.taxCents, type: 'deduct' },
                { label: '- Discounts', value: data.summary.discountCents, type: 'deduct' },
                { label: '- COGS', value: data.summary.cogsCents, type: 'deduct' },
              ].map(({ label, value, type }) => (
                <div key={label} className="flex justify-between items-center py-2 border-b border-slate-100">
                  <span className="text-sm text-slate-600">{label}</span>
                  <span className={`text-sm font-semibold ${type === 'income' ? 'text-green-700' : 'text-red-600'}`}>
                    {type === 'deduct' ? '−' : ''}{formatMoney(value)}
                  </span>
                </div>
              ))}
              <div className="flex justify-between items-center py-2 border-b border-slate-100 bg-slate-50 px-2 rounded">
                <span className="text-sm font-semibold text-slate-700">= Gross Profit</span>
                <span className="text-sm font-semibold text-emerald-700">{formatMoney(data.summary.grossProfitCents)}</span>
              </div>

              {/* Expenses section — always rendered; shows empty state when no expenses */}
              <>
                <div className="pt-1 pb-0.5">
                  <span className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Operating Expenses</span>
                </div>
                {data.expensesByCategory.length === 0
                  ? <p className="text-sm text-slate-400 pl-4 py-1.5">No expenses recorded in this period</p>
                  : data.expensesByCategory.filter((ec) => matchesQuery(ec, q, [(x) => x.name])).map((cat) => (
                    <div key={cat.name} className="flex justify-between items-center py-1.5 pl-4 border-b border-slate-50">
                      <span className="text-sm text-slate-500 flex items-center gap-2">
                        <span className="inline-block w-2 h-2 rounded-full flex-shrink-0" style={{ backgroundColor: cat.color }} />
                        {cat.name}
                      </span>
                      <span className="text-sm text-red-600">− {formatMoney(cat.totalCents)}</span>
                    </div>
                  ))
                }
                <div className="flex justify-between items-center py-2 border-b border-slate-100 px-2">
                  <span className="text-sm font-semibold text-slate-700">Total Expenses</span>
                  <span className="text-sm font-semibold text-red-600">− {formatMoney(data.summary.totalExpensesCents)}</span>
                </div>
              </>

              {/* NET PROFIT */}
              <div className={`flex justify-between items-center py-3 rounded-lg px-3 mt-2 ${data.summary.netProfitCents >= 0 ? 'bg-emerald-50' : 'bg-red-50'}`}>
                <div>
                  <span className="text-base font-bold text-slate-800">NET PROFIT</span>
                  <span className="ml-2 text-xs text-slate-500">{data.summary.netMarginPct}% net margin</span>
                </div>
                <span className={`text-xl font-bold ${data.summary.netProfitCents >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                  {formatMoney(data.summary.netProfitCents)}
                </span>
              </div>
            </div>
          </div>

          {/* Monthly trend */}
          <div className="bg-white border border-slate-200 rounded-xl p-5 shadow-sm">
            <div className="flex items-center justify-between mb-3">
              <h3 className="text-sm font-semibold text-slate-700">Monthly P&L Trend</h3>
              {/* Swatch shapes match how each series is drawn — a line for the
                  two lines, a block for the bars — so the key is readable
                  without tracing colours back to the chart. */}
              <div className="flex items-center gap-4 text-xs text-slate-500">
                <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 rounded-full bg-indigo-500" /> Revenue</span>
                <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-3 rounded-sm bg-emerald-500" /> Gross Profit</span>
                <span className="flex items-center gap-1.5"><span className="inline-block w-3 h-0.5 rounded-full bg-blue-500" /> Net Profit</span>
              </div>
            </div>
            {data.byPeriod.length === 0 ? (
              <div className="h-36 flex items-center justify-center text-slate-400 text-sm">
                No monthly data for this period
              </div>
            ) : (
              <>
              <PLTrendChart rows={data.byPeriod} />
              <div className="mt-4 overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-slate-500 border-b border-slate-100">
                      <th className="pb-2 font-medium">Month</th>
                      <th className="pb-2 font-medium text-right">Revenue</th>
                      <th className="pb-2 font-medium text-right hidden md:table-cell">COGS</th>
                      <th className="pb-2 font-medium text-right">Gross Profit</th>
                      <th className="pb-2 font-medium text-right">Gross Margin</th>
                      <th className="pb-2 font-medium text-right hidden md:table-cell">Expenses</th>
                      <th className="pb-2 font-medium text-right">Net Profit</th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.byPeriod.map((r) => (
                      <tr key={r.period} className="border-b border-slate-50">
                        <td className="py-2 text-slate-700">{new Date(r.period).toLocaleDateString('en-US', { month: 'long', year: 'numeric' })}</td>
                        <td className="py-2 text-right text-slate-700">{formatMoney(r.revenueCents)}</td>
                        <td className="py-2 text-right text-slate-500 hidden md:table-cell">{formatMoney(r.cogsCents)}</td>
                        <td className="py-2 text-right font-semibold text-emerald-700">{formatMoney(r.grossProfitCents)}</td>
                        <td className="py-2 text-right">
                          <span className={`text-xs font-bold px-1.5 py-0.5 rounded ${r.grossMarginPct >= 30 ? 'bg-green-100 text-green-700' : r.grossMarginPct >= 10 ? 'bg-yellow-100 text-yellow-700' : 'bg-red-100 text-red-600'}`}>
                            {r.grossMarginPct}%
                          </span>
                        </td>
                        <td className="py-2 text-right text-red-600 hidden md:table-cell">{formatMoney(r.expensesCents)}</td>
                        <td className={`py-2 text-right font-semibold ${r.netProfitCents >= 0 ? 'text-emerald-700' : 'text-red-600'}`}>
                          {formatMoney(r.netProfitCents)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
              </>
            )}
          </div>
        </>
      )}

      {/* ── Compare Two Periods ──────────────────────────────────────────────── */}
      <ComparePeriodsPanel />
    </div>
  );
}

// ─── Utility states ───────────────────────────────────────────────────────────

function LoadingState() {
  return (
    <div className="flex items-center justify-center py-20">
      <div className="flex items-center gap-3 text-slate-400">
        <RefreshCw size={18} className="animate-spin" />
        <span className="text-sm">Loading report…</span>
      </div>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="text-center py-20 text-slate-400">
      <p className="text-sm">No data for this period</p>
    </div>
  );
}

function EmptyStateReport({ entity }: { entity: string }) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
      <div className="w-12 h-12 rounded-full bg-slate-100 flex items-center justify-center">
        <Package size={22} className="text-slate-300" />
      </div>
      <div className="text-center">
        <p className="text-sm font-medium text-slate-500">No {entity} data for this period</p>
        <p className="text-xs text-slate-400 mt-0.5">Try adjusting the date range</p>
      </div>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function ReportsPage() {
  const location = useLocation();
  const navigate  = useNavigate();

  const tabFromUrl = (): ReportTab => {
    const p = location.pathname;
    if (p.includes('profit-loss')) return 'pl';
    if (p.includes('inventory'))   return 'inventory';
    if (p.includes('purchases'))   return 'purchases';
    if (p.includes('products'))    return 'products';
    if (p.includes('customers'))   return 'customers';
    return 'sales';
  };

  const activeTab = tabFromUrl();

  const setActiveTab = (tab: ReportTab) => {
    const paths: Record<ReportTab, string> = {
      sales:     '/reports/sales',
      purchases: '/reports/purchases',
      products:  '/reports/products',
      customers: '/reports/customers',
      inventory: '/reports/inventory',
      pl:        '/reports/profit-loss',
    };
    navigate(paths[tab]);
  };

  const tabColorMap: Record<string, string> = {
    indigo: 'border-indigo-600 text-indigo-700',
    blue:   'border-blue-600 text-blue-700',
    violet: 'border-violet-600 text-violet-700',
    teal:   'border-teal-600 text-teal-700',
    amber:  'border-amber-500 text-amber-700',
    green:  'border-emerald-600 text-emerald-700',
  };

  return (
    // Reports used to carry a 208px sidebar of its own, next to the app's 240px
    // one — half the window was navigation before a single figure appeared, and
    // two identically-styled rails read as two nav panels of equal rank rather
    // than a hierarchy. The destinations now sit in the page header as tabs,
    // which is the pattern the rest of the app already uses (Sales, Contacts,
    // Customer detail) and hands the width back to charts and tables, which is
    // what a report actually needs.
    <div className="flex flex-col h-full min-h-0">
      <header className="shrink-0 bg-white border-b border-slate-200 px-6 pt-5">
        <div className="flex items-baseline justify-between gap-4">
          <h1 className="text-xl font-bold text-slate-800">Reports</h1>
          <p className="text-xs text-slate-400 shrink-0">PDF export available on each report</p>
        </div>

        {/* Underline tabs. Horizontally scrollable so six destinations never
            wrap or squeeze on a narrow window. */}
        <nav className="flex gap-6 mt-4 overflow-x-auto no-scrollbar">
          {TABS.map((tab) => {
            const Icon = tab.icon;
            const isActive = activeTab === tab.key;
            return (
              <button
                key={tab.key}
                onClick={() => setActiveTab(tab.key)}
                className={`flex items-center gap-2 whitespace-nowrap border-b-2 pb-3 text-sm font-medium transition ${
                  isActive
                    ? tabColorMap[tab.color]
                    : 'border-transparent text-slate-500 hover:text-slate-800 hover:border-slate-300'
                }`}
              >
                <Icon size={15} />
                {tab.label}
              </button>
            );
          })}
        </nav>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-y-auto p-6">
        {/* Which report is open, and what it shows. The name lives on the active
            tab, so this is the description alone — repeating the title here
            would say it twice. */}
        <div className="mb-6">
          <p className="text-sm text-slate-500">
            {activeTab === 'sales'     && 'Revenue analytics, payment method breakdown, and warehouse performance.'}
            {activeTab === 'purchases' && 'Purchase spend over time and top supplier breakdown.'}
            {activeTab === 'products'  && 'Best-selling products by revenue and quantity, with margin analysis.'}
            {activeTab === 'customers' && 'Top customers ranked by total spend, order frequency, and recency.'}
            {activeTab === 'inventory' && 'Current stock levels valued at cost and retail, with low-stock alerts.'}
            {activeTab === 'pl'        && 'Revenue vs cost of goods sold, gross profit, and margin trends.'}
          </p>
        </div>

        {/* Tab content */}
        {activeTab === 'sales'     && <SalesTab />}
        {activeTab === 'purchases' && <PurchasesTab />}
        {activeTab === 'products'  && <ProductsTab />}
        {activeTab === 'customers' && <CustomersTab />}
        {activeTab === 'inventory' && <InventoryTab />}
        {activeTab === 'pl'        && <ProfitLossTab />}
      </main>
    </div>
  );
}
