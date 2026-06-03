import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  Plus, Search, FileText, TrendingUp, CheckCircle, DollarSign, RefreshCw,
} from 'lucide-react';
import { quotationService } from '../../services/quotationService';
import {
  QUOTATION_STATUS_COLORS, type Quotation, type QuotationStatus, type QuotationStats,
} from '../../types/quotation';

const money = (cents: number) => `Rs. ${(cents / 100).toFixed(2)}`;

const STATUS_OPTIONS: (QuotationStatus | 'ALL')[] = [
  'ALL', 'DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED',
];

export default function QuotationsPage() {
  const navigate = useNavigate();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<QuotationStatus | 'ALL'>('ALL');

  const { data: stats } = useQuery<QuotationStats>({
    queryKey: ['quotation-stats'],
    queryFn: () => quotationService.stats(),
  });

  const { data: quotations = [], isLoading } = useQuery<Quotation[]>({
    queryKey: ['quotations', status, search],
    queryFn: () => quotationService.list({
      status: status === 'ALL' ? undefined : status,
      search: search || undefined,
    }),
  });

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <FileText className="w-5 h-5 text-indigo-600" /> Quotations
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">Estimates and quotes for customers</p>
        </div>
        <button onClick={() => navigate('/quotations/new')}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition">
          <Plus className="w-4 h-4" /> New Quotation
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-medium"><FileText className="w-4 h-4" /> This Month</div>
            <p className="text-2xl font-bold text-slate-800 mt-1">{stats.totalThisMonth}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-medium"><CheckCircle className="w-4 h-4" /> Accepted</div>
            <p className="text-2xl font-bold text-green-600 mt-1">{stats.byStatus.ACCEPTED + stats.byStatus.CONVERTED}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-medium"><TrendingUp className="w-4 h-4" /> Conversion</div>
            <p className="text-2xl font-bold text-indigo-600 mt-1">{stats.conversionRate}%</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-medium"><DollarSign className="w-4 h-4" /> Accepted Value</div>
            <p className="text-2xl font-bold text-slate-800 mt-1">{money(stats.totalValueAcceptedCents)}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by number, title or customer…"
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_OPTIONS.map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                status === s ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}>
              {s === 'ALL' ? 'All' : s.charAt(0) + s.slice(1).toLowerCase()}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : quotations.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <FileText className="w-10 h-10 mx-auto text-slate-200 mb-2" />
            <p className="text-sm">No quotations found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Number</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Customer</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Title</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">Total</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Valid Until</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Created</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {quotations.map((q) => (
                <tr key={q.id} onClick={() => navigate(`/quotations/${q.id}`)}
                  className="hover:bg-slate-50 cursor-pointer">
                  <td className="px-4 py-3 font-mono font-semibold text-indigo-600">{q.number}</td>
                  <td className="px-4 py-3 text-slate-700">{q.customer?.name ?? 'Walk-in'}</td>
                  <td className="px-4 py-3 text-slate-500 max-w-[200px] truncate">{q.title ?? '—'}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${QUOTATION_STATUS_COLORS[q.status]}`}>
                      {q.status.charAt(0) + q.status.slice(1).toLowerCase()}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-800">{money(q.totalCents)}</td>
                  <td className="px-4 py-3 text-slate-500">
                    {q.validUntil ? new Date(q.validUntil).toLocaleDateString('en-GB') : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-400 text-xs">
                    {new Date(q.createdAt).toLocaleDateString('en-GB')}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
