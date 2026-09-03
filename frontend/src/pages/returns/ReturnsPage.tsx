import { useState, useRef, useEffect } from 'react';
import { todayLocalYMD, localMonthStartYMD } from '../../utils/local-date';
import { useQuery } from '@tanstack/react-query';
import {
  RotateCcw, Plus, Search, X, ChevronLeft, ChevronRight,
  Package, DollarSign, CalendarDays,
} from 'lucide-react';
import { salesApi, formatCents } from '../../services/sales';
import NewReturnModal from '../../components/returns/NewReturnModal';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cls(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(' ');
}

function thisMonthStart(): string {
  const d = new Date();
  return localMonthStartYMD();
}
function today(): string {
  return todayLocalYMD();
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

function ReturnDetailModal({ id, onClose }: { id: string; onClose: () => void }) {
  const { data: ret, isLoading } = useQuery({
    queryKey: ['return', id],
    queryFn: () => salesApi.getReturn(id),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-xl shadow-2xl max-h-[90vh] flex flex-col">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-bold text-slate-800 flex items-center gap-2">
            <RotateCcw className="w-4 h-4 text-orange-500" />
            {ret ? ret.number : 'Return Detail'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {isLoading ? (
          <div className="flex items-center justify-center py-12 text-slate-400">Loading…</div>
        ) : ret ? (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {/* Header info */}
            <div className="grid grid-cols-2 gap-3 text-sm">
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Return Number</p>
                <p className="font-mono font-bold text-orange-600">{ret.number}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Date</p>
                <p className="font-medium text-slate-800">
                  {new Date(ret.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Original Invoice</p>
                <p className="font-mono font-semibold text-indigo-600">{ret.sale.number}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Customer</p>
                <p className="font-medium text-slate-800">{ret.sale.customer?.name ?? 'Walk-in'}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Warehouse</p>
                <p className="font-medium text-slate-800">{ret.warehouse.name}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Processed by</p>
                <p className="font-medium text-slate-800">{ret.createdBy.fullName}</p>
              </div>
            </div>

            {ret.reason && (
              <div className="p-3 bg-amber-50 border border-amber-200 rounded-lg text-sm text-amber-800">
                <span className="font-semibold">Reason: </span>{ret.reason}
              </div>
            )}

            {/* Lines */}
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wide mb-2">Items Returned</p>
              <div className="rounded-xl overflow-hidden border border-slate-200">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Product</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Qty</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Unit Price</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Subtotal</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {ret.lines?.map((l) => (
                      <tr key={l.id}>
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-slate-800">{l.product.name}</p>
                          <p className="text-xs text-slate-400">{l.product.sku}</p>
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-700">
                          {Number(l.qty)} {l.product.unit?.shortCode}
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-700">{formatCents(l.unitPriceCents)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{formatCents(l.lineTotalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Total */}
            <div className="flex justify-end">
              <div className="bg-orange-50 border border-orange-200 rounded-xl px-5 py-3 text-right">
                <p className="text-xs text-slate-400 mb-0.5">Total Refund</p>
                <p className="text-xl font-black text-orange-700">{formatCents(ret.totalCents)}</p>
              </div>
            </div>
          </div>
        ) : (
          <div className="py-12 text-center text-slate-400">Return not found</div>
        )}

        <div className="px-6 py-4 border-t">
          <button onClick={onClose}
            className="w-full py-2.5 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Returns Page ────────────────────────────────────────────────────────

export default function ReturnsPage() {
  const [search, setSearch]         = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const active = document.activeElement;
      const tag = active?.tagName;
      if (tag !== 'INPUT' && tag !== 'TEXTAREA' && tag !== 'SELECT' &&
          e.key.length === 1 && !e.ctrlKey && !e.altKey && !e.metaKey) {
        searchRef.current?.focus();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);
  const [fromDate, setFromDate]     = useState(thisMonthStart);
  const [toDate, setToDate]         = useState(today);
  const [page, setPage]             = useState(1);
  const [detailId, setDetailId]     = useState<string | null>(null);
  const [showNew, setShowNew]       = useState(false);
  const PAGE_SIZE = 15;

  const { data, isLoading } = useQuery({
    queryKey: ['returns', search, fromDate, toDate, page],
    queryFn: () => salesApi.listReturns({ search: search || undefined, from: fromDate || undefined, to: toDate || undefined, page, pageSize: PAGE_SIZE }),
    staleTime: 0,
    placeholderData: prev => prev,
  });

  // Stats
  const { data: monthData } = useQuery({
    queryKey: ['returns-month'],
    queryFn: () => salesApi.listReturns({ from: thisMonthStart(), pageSize: 100 }),
    staleTime: 60_000,
  });

  const returns  = data?.data ?? [];
  const total    = data?.total ?? 0;
  const pages    = Math.ceil(total / PAGE_SIZE);

  const totalRefunded  = returns.reduce((s, r) => s + r.totalCents, 0);
  const totalItems     = returns.reduce((s, r) => s + (r._count?.lines ?? 0), 0);
  const monthCount     = monthData?.total ?? 0;

  return (
    <div className="p-6 space-y-6 bg-slate-50 min-h-screen">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-900">Returns</h1>
          <p className="text-sm text-slate-500 mt-0.5">Customer returns and refunds</p>
        </div>
        <button
          onClick={() => setShowNew(true)}
          className="flex items-center gap-2 bg-orange-500 text-white px-4 py-2.5 rounded-xl font-semibold text-sm hover:bg-orange-600 shadow-sm transition"
        >
          <Plus className="w-4 h-4" /> New Return
        </button>
      </div>

      {/* Stats */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        {[
          { label: 'Total Returns',   value: total,                           icon: RotateCcw,   color: 'bg-orange-500' },
          { label: 'Items Returned',  value: totalItems,                      icon: Package,     color: 'bg-indigo-500' },
          { label: 'Total Refunded',  value: formatCents(totalRefunded),      icon: DollarSign,  color: 'bg-green-500'  },
          { label: 'This Month',      value: monthCount,                      icon: CalendarDays,color: 'bg-blue-500'   },
        ].map(s => (
          <div key={s.label} className="bg-white rounded-2xl border border-slate-200 p-4 flex items-center gap-4 shadow-sm">
            <div className={cls('w-10 h-10 rounded-xl flex items-center justify-center shrink-0', s.color)}>
              <s.icon size={18} className="text-white" />
            </div>
            <div className="min-w-0">
              <p className="text-xl font-bold text-slate-800 leading-tight">{s.value}</p>
              <p className="text-xs text-slate-500">{s.label}</p>
            </div>
          </div>
        ))}
      </div>

      {/* Search + date filter */}
      <div className="flex flex-wrap items-center gap-3">
        <div className="relative max-w-xs flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            ref={searchRef}
            autoFocus
            type="text"
            placeholder="Search by return # or invoice #…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
            onKeyDown={e => { if (e.key === 'Enter') e.preventDefault(); }}
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>
        <label className="text-xs text-slate-500">From</label>
        <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(1); }}
          className="border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400" />
        <label className="text-xs text-slate-500">To</label>
        <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPage(1); }}
          className="border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-2 focus:ring-orange-400" />
        <button type="button" onClick={() => { setFromDate(thisMonthStart()); setToDate(today()); setPage(1); }}
          className="text-xs text-slate-500 hover:text-slate-700 underline">This month</button>
        <button type="button" onClick={() => { setFromDate(''); setToDate(''); setPage(1); }}
          className="text-xs text-slate-500 hover:text-slate-700 underline">All time</button>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-5 py-3 font-semibold text-slate-600">Return #</th>
              <th className="text-left px-5 py-3 font-semibold text-slate-600">Original Invoice</th>
              <th className="text-left px-5 py-3 font-semibold text-slate-600">Customer</th>
              <th className="text-left px-5 py-3 font-semibold text-slate-600">Date</th>
              <th className="text-right px-5 py-3 font-semibold text-slate-600">Items</th>
              <th className="text-right px-5 py-3 font-semibold text-slate-600">Refund</th>
              <th className="text-center px-5 py-3 font-semibold text-slate-600">Reason</th>
              <th className="text-center px-5 py-3 font-semibold text-slate-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr><td colSpan={8} className="text-center py-10 text-slate-400">Loading…</td></tr>
            )}
            {!isLoading && returns.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-12">
                  <RotateCcw size={36} className="mx-auto text-slate-200 mb-2" />
                  <p className="text-slate-400 text-sm">
                    {search ? 'No returns match your search' : 'No returns yet'}
                  </p>
                </td>
              </tr>
            )}
            {returns.map(r => (
              <tr key={r.id} className="hover:bg-slate-50 transition">
                <td className="px-5 py-3.5">
                  <span className="font-mono font-bold text-orange-600">{r.number}</span>
                </td>
                <td className="px-5 py-3.5">
                  <span className="font-mono text-indigo-600 font-medium">{r.sale.number}</span>
                </td>
                <td className="px-5 py-3.5 text-slate-700">
                  {r.sale.customer?.name ?? <span className="text-slate-400 italic">Walk-in</span>}
                </td>
                <td className="px-5 py-3.5 text-slate-500 text-xs">
                  {new Date(r.createdAt).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })}
                </td>
                <td className="px-5 py-3.5 text-right text-slate-600">{r._count?.lines ?? '—'}</td>
                <td className="px-5 py-3.5 text-right font-semibold text-orange-700">{formatCents(r.totalCents)}</td>
                <td className="px-5 py-3.5 text-center">
                  {r.reason ? (
                    <span className="text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium truncate max-w-28 inline-block">
                      {r.reason}
                    </span>
                  ) : (
                    <span className="text-slate-300 text-xs">—</span>
                  )}
                </td>
                <td className="px-5 py-3.5 text-center">
                  <button
                    onClick={() => setDetailId(r.id)}
                    className="text-xs text-indigo-600 hover:underline font-medium"
                  >
                    View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{total} returns</span>
          <div className="flex items-center gap-2">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
              className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40">
              <ChevronLeft className="w-4 h-4" />
            </button>
            <span>Page {page} of {pages}</span>
            <button disabled={page === pages} onClick={() => setPage(p => p + 1)}
              className="p-1.5 border border-slate-200 rounded-lg hover:bg-slate-50 disabled:opacity-40">
              <ChevronRight className="w-4 h-4" />
            </button>
          </div>
        </div>
      )}

      {/* Modals */}
      {detailId && <ReturnDetailModal id={detailId} onClose={() => setDetailId(null)} />}
      {showNew   && <NewReturnModal onClose={() => setShowNew(false)} />}
    </div>
  );
}
