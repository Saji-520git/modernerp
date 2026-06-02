import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import {
  Users, UserPlus, Crown, Star, AlertTriangle, CreditCard,
  TrendingUp, Clock, ChevronRight,
} from 'lucide-react';
import { crmService } from '../../services/crmService';
import type { SpendPeriod } from '../../types/crm';

function fmtCents(cents: number) {
  return `Rs. ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}
function fmtDate(iso: string | null) {
  return iso ? new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : '—';
}

const PERIODS: { value: SpendPeriod; label: string }[] = [
  { value: 'all', label: 'All time' },
  { value: '1y',  label: 'Last year' },
  { value: '90d', label: 'Last 90 days' },
  { value: '30d', label: 'Last 30 days' },
];

function KpiCard({ icon, label, value, sub, accent }: {
  icon: React.ReactNode; label: string; value: string; sub?: string; accent: string;
}) {
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg flex items-center justify-center ${accent}`}>{icon}</div>
        <div className="min-w-0">
          <p className="text-xs text-slate-500 font-medium">{label}</p>
          <p className="text-xl font-bold text-slate-800 truncate">{value}</p>
          {sub && <p className="text-xs text-slate-400 truncate">{sub}</p>}
        </div>
      </div>
    </div>
  );
}

export default function CRMDashboardPage() {
  const navigate = useNavigate();
  const [period, setPeriod] = useState<SpendPeriod>('all');

  const { data: dash } = useQuery({ queryKey: ['crm', 'dashboard'], queryFn: crmService.getOwnerDashboard });
  const { data: top } = useQuery({ queryKey: ['crm', 'top', period], queryFn: () => crmService.getTopCustomers(10, period) });
  const { data: inactive } = useQuery({ queryKey: ['crm', 'inactive'], queryFn: () => crmService.getInactiveCustomers(30) });
  const { data: followups } = useQuery({ queryKey: ['crm', 'followups'], queryFn: crmService.getPendingFollowUps });

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Customer Intelligence</h1>
          <p className="text-sm text-slate-500">An at-a-glance view of your customer base.</p>
        </div>
        <div className="flex gap-2">
          <button onClick={() => navigate('/crm/loyalty')}
            className="px-3 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50 transition-colors">
            Loyalty Settings
          </button>
          <button onClick={() => navigate('/crm/tiers')}
            className="px-3 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50 transition-colors">
            Price Tiers
          </button>
        </div>
      </div>

      {/* KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <KpiCard icon={<Users size={18} className="text-indigo-600" />} accent="bg-indigo-100"
          label="Total Customers" value={(dash?.totalCustomers ?? 0).toLocaleString()} />
        <KpiCard icon={<UserPlus size={18} className="text-emerald-600" />} accent="bg-emerald-100"
          label="New This Month" value={(dash?.newThisMonth ?? 0).toLocaleString()} />
        <KpiCard icon={<Crown size={18} className="text-amber-600" />} accent="bg-amber-100"
          label="Top Spender (Month)"
          value={dash?.topSpenderThisMonth ? dash.topSpenderThisMonth.name : '—'}
          sub={dash?.topSpenderThisMonth ? fmtCents(dash.topSpenderThisMonth.amount) : undefined} />
        <KpiCard icon={<AlertTriangle size={18} className="text-rose-600" />} accent="bg-rose-100"
          label="Customers at Risk" value={(dash?.customersAtRisk ?? 0).toLocaleString()}
          sub="No purchase in 30+ days" />
        <KpiCard icon={<Star size={18} className="text-indigo-600" />} accent="bg-indigo-100"
          label="Loyalty Points Outstanding" value={(dash?.totalLoyaltyPointsOutstanding ?? 0).toLocaleString()} />
        <KpiCard icon={<CreditCard size={18} className="text-orange-600" />} accent="bg-orange-100"
          label="Loyalty Liability" value={fmtCents(dash?.loyaltyLiabilityCents ?? 0)} />
        <KpiCard icon={<CreditCard size={18} className="text-rose-600" />} accent="bg-rose-100"
          label="Credit Exposure" value={fmtCents(dash?.creditExposureCents ?? 0)} />
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Top customers */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200">
            <h2 className="font-semibold text-slate-700 flex items-center gap-1.5"><TrendingUp size={16} /> Top Customers</h2>
            <select value={period} onChange={(e) => setPeriod(e.target.value as SpendPeriod)}
              className="text-sm border border-slate-200 rounded-lg px-2 py-1 focus:outline-none focus:ring-2 focus:ring-indigo-200">
              {PERIODS.map((p) => <option key={p.value} value={p.value}>{p.label}</option>)}
            </select>
          </div>
          <div className="divide-y divide-slate-100">
            {(top ?? []).length === 0 && <p className="text-center py-10 text-slate-400 text-sm">No sales data</p>}
            {(top ?? []).map((c, i) => (
              <button key={c.customerId} onClick={() => navigate(`/customers/${c.customerId}`)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors text-left">
                <div className="flex items-center gap-3 min-w-0">
                  <span className="w-6 h-6 rounded-full bg-slate-100 text-slate-500 text-xs font-bold flex items-center justify-center shrink-0">{i + 1}</span>
                  <div className="min-w-0">
                    <p className="font-medium text-slate-800 truncate">{c.name}</p>
                    <p className="text-xs text-slate-400">{c.orderCount} order{c.orderCount !== 1 ? 's' : ''} · {c.loyaltyPoints.toLocaleString()} pts</p>
                  </div>
                </div>
                <div className="flex items-center gap-1 shrink-0">
                  <span className="font-semibold text-emerald-600">{fmtCents(c.totalSpent)}</span>
                  <ChevronRight size={14} className="text-slate-300" />
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Pending follow-ups */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
          <div className="px-4 py-3 border-b border-slate-200">
            <h2 className="font-semibold text-slate-700 flex items-center gap-1.5"><Clock size={16} /> Pending Follow-ups</h2>
          </div>
          <div className="divide-y divide-slate-100">
            {(followups ?? []).length === 0 && <p className="text-center py-10 text-slate-400 text-sm">No follow-ups due</p>}
            {(followups ?? []).map((f) => (
              <button key={f.id} onClick={() => navigate(`/customers/${f.customer.id}`)}
                className="w-full flex items-center justify-between px-4 py-3 hover:bg-slate-50 transition-colors text-left">
                <div className="min-w-0">
                  <p className="font-medium text-slate-800 truncate">{f.customer.name}</p>
                  <p className="text-xs text-slate-500 truncate">{f.note}</p>
                </div>
                <span className="text-xs text-rose-600 font-medium shrink-0 ml-2">{fmtDate(f.followUpAt)}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Inactive customers */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">
        <div className="px-4 py-3 border-b border-slate-200">
          <h2 className="font-semibold text-slate-700 flex items-center gap-1.5"><AlertTriangle size={16} /> Inactive Customers (30+ days)</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Customer</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Last Purchase</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Lifetime Spend</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(inactive ?? []).length === 0 && (
                <tr><td colSpan={3} className="text-center py-10 text-slate-400">No inactive customers</td></tr>
              )}
              {(inactive ?? []).map((c) => (
                <tr key={c.customerId} className="hover:bg-slate-50 cursor-pointer transition-colors"
                  onClick={() => navigate(`/customers/${c.customerId}`)}>
                  <td className="px-4 py-3 font-medium text-slate-800">{c.name}</td>
                  <td className="px-4 py-3 text-slate-600">{fmtDate(c.lastPurchase)}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-700">{fmtCents(c.totalSpent)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
