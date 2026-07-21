import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  ArrowLeft, RefreshCw, FileDown, TrendingUp, TrendingDown,
  ShoppingCart, Package, Wallet, Receipt, AlertTriangle,
  Clock, UserPlus, Sun,
} from 'lucide-react';
import { reportsApi, type TodaySummary } from '../../services/reports';
import { useAppSettings } from '../../context/SettingsContext';
import {
  loadReportBranding, newReportDoc, reportLetterhead, kpiBand,
  sectionTitle, styledTable, finalizeReport, lastY, money,
} from '../../services/reportPdf';

// ─── Local constants ──────────────────────────────────────────────────────────

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Cash', CARD: 'Card', BANK_TRANSFER: 'Bank Transfer',
  QR_PAY: 'QR Pay', WALLET: 'Wallet', CREDIT: 'Credit', OTHER: 'Other',
};

function prettyDate(iso: string): string {
  return new Date(`${iso}T12:00:00`).toLocaleDateString('en-US', {
    weekday: 'long', month: 'long', day: 'numeric', year: 'numeric',
  });
}

// ─── Small UI atoms ───────────────────────────────────────────────────────────

function StatTile({
  label, value, sub, Icon, accent,
}: { label: string; value: string; sub?: string; Icon: typeof Package; accent: string }) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4 flex items-start gap-3">
      <div className="w-10 h-10 rounded-lg flex items-center justify-center flex-shrink-0" style={{ backgroundColor: `${accent}1a` }}>
        <Icon size={18} style={{ color: accent }} />
      </div>
      <div className="min-w-0">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</p>
        <p className="text-lg font-bold text-slate-800 leading-tight truncate">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

function SectionCard({ title, icon, children, right }: {
  title: string; icon: React.ReactNode; children: React.ReactNode; right?: React.ReactNode;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-100 shadow-sm p-4">
      <div className="flex items-center justify-between mb-3 border-b border-slate-100 pb-2">
        <h2 className="text-sm font-bold text-slate-700 flex items-center gap-2">{icon} {title}</h2>
        {right}
      </div>
      {children}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function TodaySummaryPage() {
  const { formatMoney, formatMoneyShort } = useAppSettings();

  const { data, isLoading, isError, refetch, isFetching } = useQuery({
    queryKey: ['today-summary'],
    queryFn: reportsApi.todaySummary,
    refetchOnWindowFocus: false,
  });

  const exportPdf = async (d: TodaySummary) => {
    const { settings, logo } = await loadReportBranding();
    const doc = newReportDoc();
    let y = reportLetterhead(doc, {
      settings, logo, title: "Today's Summary",
      period: `${prettyDate(d.date)} — generated ${new Date(d.generatedAt).toLocaleTimeString()}`,
    });
    y = kpiBand(doc, y, [
      { label: 'Net Revenue', value: money(d.headline.revenueCents, settings) },
      { label: 'Orders', value: String(d.headline.orderCount) },
      { label: 'Gross Profit', value: money(d.headline.grossProfitCents, settings) },
      { label: 'Net Profit', value: money(d.money.netProfitCents, settings), accent: true },
    ]);

    y = sectionTitle(doc, y, 'Performance');
    styledTable(doc, {
      startY: y,
      theme: 'plain',
      body: [
        ['Net Revenue',   money(d.headline.revenueCents, settings)],
        ['Gross Revenue', money(d.headline.grossRevenueCents, settings)],
        ['Returns',       money(d.headline.returnsCents, settings)],
        ['Orders',        String(d.headline.orderCount)],
        ['Items Sold',    String(d.headline.itemsSold)],
        ['Avg Order',     money(d.headline.avgOrderCents, settings)],
        ['COGS',          money(d.headline.cogsCents, settings)],
        ['Gross Profit',  `${money(d.headline.grossProfitCents, settings)}  (${d.headline.grossMarginPct}%)`],
        ['Expenses',      money(d.money.expensesCents, settings)],
        ['New Customers', String(d.context.newCustomers)],
      ],
      foot: [['Net Profit', money(d.money.netProfitCents, settings)]],
      columnStyles: { 0: { fontStyle: 'bold', cellWidth: 90 }, 1: { halign: 'right' } },
    });

    if (d.payments.length) {
      y = sectionTitle(doc, lastY(doc) + 8, 'By payment method');
      styledTable(doc, {
        startY: y,
        head: [['Payment Method', 'Orders', 'Revenue']],
        body: d.payments.map((p) => [PAYMENT_LABELS[p.method] ?? p.method, String(p.count), money(p.revenueCents, settings)]),
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      });
    }

    if (d.topItems.length) {
      y = sectionTitle(doc, lastY(doc) + 8, 'Top items');
      styledTable(doc, {
        startY: y,
        head: [['Top Item', 'Qty', 'Revenue']],
        body: d.topItems.map((t) => [t.name, String(t.qty), money(t.revenueCents, settings)]),
        columnStyles: { 1: { halign: 'right' }, 2: { halign: 'right' } },
      });
    }

    if (d.alerts.lowStockItems.length || d.alerts.expiringItems.length) {
      y = sectionTitle(doc, lastY(doc) + 8, 'Alerts');
      styledTable(doc, {
        startY: y,
        head: [['Alert', 'Item', 'Detail']],
        body: [
          ...d.alerts.lowStockItems.map((i) => ['Low stock', i.name, `${i.totalQty} on hand (reorder ${i.reorderLevel})`]),
          ...d.alerts.expiringItems.map((i) => ['Expiring', i.name, `${i.daysLeft}d left (${i.expiryDate})`]),
        ],
      });
    }

    finalizeReport(doc, settings);
    doc.save(`Today-Summary-${d.date}.pdf`);
  };

  // ── Loading / error ──────────────────────────────────────────────────────────
  if (isLoading) {
    return (
      <div className="h-full flex items-center justify-center text-slate-400 text-sm">
        <RefreshCw size={16} className="animate-spin mr-2" /> Loading today's summary…
      </div>
    );
  }
  if (isError || !data) {
    return (
      <div className="h-full flex flex-col items-center justify-center gap-3 text-slate-500">
        <p>Failed to load today's summary.</p>
        <button onClick={() => refetch()} className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium hover:bg-slate-50">
          <RefreshCw size={13} /> Retry
        </button>
      </div>
    );
  }

  const d = data;
  const vs = d.context.revenueVsYesterdayPct;
  const maxHourRev = Math.max(...d.hourly.map((h) => h.revenueCents), 1);
  const netPositive = d.money.netProfitCents >= 0;

  return (
    <div className="h-full flex flex-col gap-4 p-4 overflow-y-auto text-base">

      {/* Header */}
      <div className="flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3">
          <Link to="/" className="w-8 h-8 rounded-lg flex items-center justify-center bg-white border border-slate-200 text-slate-500 hover:bg-slate-50">
            <ArrowLeft size={16} />
          </Link>
          <div>
            <p className="text-xs text-slate-500 flex items-center gap-1"><Sun size={12} /> Today's Summary</p>
            <h1 className="text-xl font-bold text-slate-800 leading-tight">{prettyDate(d.date)}</h1>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()} disabled={isFetching}
            className="flex items-center gap-2 px-3 py-1.5 bg-white border border-slate-200 rounded-lg text-xs font-medium text-slate-600 hover:bg-slate-50 transition shadow-sm disabled:opacity-50">
            <RefreshCw size={13} className={isFetching ? 'animate-spin' : ''} /> Refresh
          </button>
          <button onClick={() => exportPdf(d)}
            className="flex items-center gap-2 px-3 py-1.5 bg-indigo-600 rounded-lg text-xs font-semibold text-white hover:bg-indigo-700 transition shadow-sm">
            <FileDown size={13} /> Export PDF
          </button>
        </div>
      </div>

      {/* Hero revenue card */}
      <div className="rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white p-5 shadow-md flex-shrink-0">
        <p className="text-xs font-medium uppercase tracking-wide text-indigo-200">Revenue so far today</p>
        <div className="flex items-end gap-4 mt-1 flex-wrap">
          <p className="text-4xl font-bold leading-none">{formatMoney(d.headline.revenueCents)}</p>
          {vs !== null && (
            <span className={`flex items-center gap-1 text-sm font-semibold ${vs >= 0 ? 'text-emerald-200' : 'text-rose-200'}`}>
              {vs >= 0 ? <TrendingUp size={15} /> : <TrendingDown size={15} />}
              {Math.abs(vs)}% vs yesterday
            </span>
          )}
        </div>
        <p className="text-xs text-indigo-200 mt-1">
          {d.headline.orderCount} orders · {d.headline.itemsSold} items · avg {formatMoney(d.headline.avgOrderCents)}
          {d.headline.returnsCents > 0 && ` · ${formatMoney(d.headline.returnsCents)} returned`}
        </p>
      </div>

      {/* Profit + money tiles */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 flex-shrink-0">
        <StatTile label="Gross Profit" value={formatMoneyShort(d.headline.grossProfitCents)} sub={`${d.headline.grossMarginPct}% margin`} Icon={TrendingUp} accent="#059669" />
        <StatTile label="COGS" value={formatMoneyShort(d.headline.cogsCents)} Icon={Package} accent="#7C3AED" />
        <StatTile label="Expenses" value={formatMoneyShort(d.money.expensesCents)} Icon={Receipt} accent="#D97706" />
        <StatTile label="Net Profit" value={formatMoneyShort(d.money.netProfitCents)} sub={netPositive ? 'in the black' : 'in the red'} Icon={netPositive ? TrendingUp : TrendingDown} accent={netPositive ? '#059669' : '#E11D48'} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        {/* Payment breakdown */}
        <SectionCard title="Payment Methods" icon={<Wallet size={15} className="text-indigo-500" />}>
          {d.payments.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">No sales yet today.</p>
          ) : (
            <div className="space-y-2">
              {d.payments.map((p) => {
                const total = d.payments.reduce((s, x) => s + x.revenueCents, 0) || 1;
                const pct = Math.round((p.revenueCents / total) * 100);
                return (
                  <div key={p.method}>
                    <div className="flex justify-between text-xs mb-0.5">
                      <span className="font-medium text-slate-600">{PAYMENT_LABELS[p.method] ?? p.method} <span className="text-slate-400">· {p.count}</span></span>
                      <span className="font-semibold text-slate-700">{formatMoney(p.revenueCents)}</span>
                    </div>
                    <div className="h-2 rounded-full bg-slate-100 overflow-hidden">
                      <div className="h-full bg-indigo-500 rounded-full" style={{ width: `${pct}%` }} />
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </SectionCard>

        {/* Top items */}
        <SectionCard title="Top Selling Items" icon={<ShoppingCart size={15} className="text-violet-500" />}>
          {d.topItems.length === 0 ? (
            <p className="text-sm text-slate-400 py-4 text-center">No items sold yet today.</p>
          ) : (
            <table className="w-full text-sm">
              <tbody>
                {d.topItems.map((t, i) => (
                  <tr key={t.productId} className="border-b border-slate-50 last:border-0">
                    <td className="py-1.5 text-slate-400 w-6">{i + 1}</td>
                    <td className="py-1.5">
                      <p className="font-medium text-slate-700 leading-tight">{t.name}</p>
                      <p className="text-xs text-slate-400">{t.sku} · {t.qty} sold</p>
                    </td>
                    <td className="py-1.5 text-right font-semibold text-slate-700">{formatMoney(t.revenueCents)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </SectionCard>
      </div>

      {/* Hourly trend */}
      <SectionCard title="Hourly Revenue" icon={<Clock size={15} className="text-cyan-500" />}>
        {d.hourly.length === 0 ? (
          <p className="text-sm text-slate-400 py-4 text-center">No hourly activity yet.</p>
        ) : (
          <div className="flex items-end gap-1 h-28">
            {d.hourly.map((h) => (
              <div key={h.hour} className="flex-1 flex flex-col items-center justify-end group">
                <div
                  className="w-full bg-cyan-400 group-hover:bg-cyan-500 rounded-t transition-all relative"
                  style={{ height: `${Math.max(4, (h.revenueCents / maxHourRev) * 100)}%` }}
                  title={`${h.hour}:00 — ${formatMoney(h.revenueCents)} (${h.orders} orders)`}
                />
                <span className="text-[9px] text-slate-400 mt-1">{h.hour}</span>
              </div>
            ))}
          </div>
        )}
      </SectionCard>

      {/* Alerts + context */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <SectionCard
          title="Low Stock"
          icon={<AlertTriangle size={15} className="text-amber-500" />}
          right={<span className="text-xs font-bold text-amber-600">{d.alerts.lowStockCount}</span>}
        >
          {d.alerts.lowStockItems.length === 0 ? (
            <p className="text-sm text-slate-400 py-3 text-center">All stocked up.</p>
          ) : (
            <ul className="space-y-1.5">
              {d.alerts.lowStockItems.map((i) => (
                <li key={i.sku} className="flex justify-between text-xs">
                  <span className="font-medium text-slate-600 truncate">{i.name}</span>
                  <span className="text-amber-600 font-semibold flex-shrink-0 ml-2">{i.totalQty}/{i.reorderLevel}</span>
                </li>
              ))}
              {d.alerts.lowStockCount > d.alerts.lowStockItems.length && (
                <li className="text-xs text-slate-400">+{d.alerts.lowStockCount - d.alerts.lowStockItems.length} more</li>
              )}
            </ul>
          )}
        </SectionCard>

        <SectionCard
          title="Expiring Soon"
          icon={<Clock size={15} className="text-rose-500" />}
          right={<span className="text-xs font-bold text-rose-600">{d.alerts.expiringCount}</span>}
        >
          {d.alerts.expiringItems.length === 0 ? (
            <p className="text-sm text-slate-400 py-3 text-center">Nothing expiring soon.</p>
          ) : (
            <ul className="space-y-1.5">
              {d.alerts.expiringItems.map((i) => (
                <li key={i.sku} className="flex justify-between text-xs">
                  <span className="font-medium text-slate-600 truncate">{i.name}</span>
                  <span className={`font-semibold flex-shrink-0 ml-2 ${i.daysLeft <= 0 ? 'text-rose-600' : 'text-amber-600'}`}>
                    {i.daysLeft <= 0 ? 'expired' : `${i.daysLeft}d`}
                  </span>
                </li>
              ))}
            </ul>
          )}
        </SectionCard>

        <SectionCard title="Context" icon={<UserPlus size={15} className="text-emerald-500" />}>
          <ul className="space-y-2 text-sm">
            <li className="flex justify-between">
              <span className="text-slate-500">New customers</span>
              <span className="font-semibold text-slate-700">{d.context.newCustomers}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-slate-500">Yesterday (same time)</span>
              <span className="font-semibold text-slate-700">{formatMoney(d.context.yesterdayRevenueCents)}</span>
            </li>
            <li className="flex justify-between">
              <span className="text-slate-500">vs yesterday</span>
              <span className={`font-semibold ${vs === null ? 'text-slate-400' : vs >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                {vs === null ? '—' : `${vs >= 0 ? '+' : ''}${vs}%`}
              </span>
            </li>
          </ul>
        </SectionCard>
      </div>

      <p className="text-center text-[11px] text-slate-400 pb-2">
        Generated {new Date(d.generatedAt).toLocaleString()} · figures cover 12:00 AM to now
      </p>
    </div>
  );
}
