import { useState, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  RotateCcw, Plus, Search, X, ChevronLeft, ChevronRight,
  Package, DollarSign, CalendarDays, CheckCircle, AlertCircle,
} from 'lucide-react';
import {
  salesApi, formatCents,
  type SaleReturn, type SaleForReturn,
} from '../../services/sales';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function cls(...a: (string | false | null | undefined)[]) {
  return a.filter(Boolean).join(' ');
}

function startOfMonth() {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString();
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

// ─── New Return Modal (3-step) ─────────────────────────────────────────────────

type Step = 'search' | 'items' | 'confirm';

interface NewReturnModalProps {
  onClose: () => void;
  prefillSaleId?: string; // skip step A if provided
}

function NewReturnModal({ onClose, prefillSaleId }: NewReturnModalProps) {
  const queryClient = useQueryClient();
  const [step, setStep]             = useState<Step>(prefillSaleId ? 'items' : 'search');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSaleId, setSelectedSaleId] = useState(prefillSaleId ?? '');
  const [qtys, setQtys]             = useState<Record<string, string>>({});
  const [reason, setReason]         = useState('');
  const [error, setError]           = useState('');

  // Step A: search confirmed sales
  const { data: salesData, isFetching: searchFetching } = useQuery({
    queryKey: ['return-sale-search', searchQuery],
    queryFn: () => salesApi.listSales({
      search: searchQuery || undefined,
      status: 'CONFIRMED',
      includePos: 'true',
      pageSize: 8,
    }),
    enabled: step === 'search' && searchQuery.length >= 2,
    staleTime: 0,
  });

  // Step B: get returnable items for selected sale
  const { data: saleData, isLoading: saleLoading } = useQuery({
    queryKey: ['sale-for-return', selectedSaleId],
    queryFn: () => salesApi.getSaleForReturn(selectedSaleId),
    enabled: !!selectedSaleId && (step === 'items' || step === 'confirm'),
  });

  const returnableLines = (saleData?.lines ?? []).filter(l => l.availableToReturn > 0);
  const nothingToReturn = !!saleData && returnableLines.length === 0;

  const refundTotal = returnableLines.reduce((sum, l) => {
    const q = parseInt(qtys[l.productId] || '0') || 0;
    return sum + q * l.unitPriceCents;
  }, 0);

  const hasSelectedItems = returnableLines.some(l => (parseInt(qtys[l.productId] || '0') || 0) > 0);

  const mutation = useMutation({
    mutationFn: () => salesApi.createReturn({
      saleId: selectedSaleId,
      reason: reason || undefined,
      lines: returnableLines
        .filter(l => parseInt(qtys[l.productId] || '0') > 0)
        .map(l => ({
          productId: l.productId,
          qty: parseInt(qtys[l.productId]),
          unitPriceCents: l.unitPriceCents,
          lineTotalCents: Math.round(l.unitPriceCents * parseInt(qtys[l.productId])),
        })),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['returns'] });
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      onClose();
    },
    onError: (err: any) => setError(err?.response?.data?.message ?? 'Return failed'),
  });

  const stepLabels: Record<Step, string> = {
    search: 'Step 1 of 3 — Find Invoice',
    items:  'Step 2 of 3 — Select Items',
    confirm:'Step 3 of 3 — Process Return',
  };

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[92vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div>
            <h2 className="font-bold text-slate-800 flex items-center gap-2">
              <RotateCcw className="w-4 h-4 text-orange-500" /> New Return
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">{stepLabels[step]}</p>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex gap-2">
              <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
            </div>
          )}

          {/* ── STEP A: Find invoice ── */}
          {step === 'search' && (
            <div className="space-y-3">
              <div className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
                <input
                  autoFocus
                  type="text"
                  placeholder="Search by invoice number or customer…"
                  value={searchQuery}
                  onChange={e => setSearchQuery(e.target.value)}
                  className="w-full pl-9 pr-3 py-2.5 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>
              {searchFetching && (
                <p className="text-xs text-slate-400 text-center py-3">Searching…</p>
              )}
              {!searchFetching && searchQuery.length >= 2 && (salesData?.data ?? []).length === 0 && (
                <p className="text-xs text-slate-400 text-center py-3">No confirmed invoices found</p>
              )}
              <div className="space-y-1.5">
                {(salesData?.data ?? []).map(s => (
                  <button
                    key={s.id}
                    onClick={() => { setSelectedSaleId(s.id); setStep('items'); setQtys({}); }}
                    className="w-full flex items-center justify-between px-4 py-3 bg-slate-50 hover:bg-orange-50 hover:border-orange-200 border border-transparent rounded-xl text-left transition"
                  >
                    <div>
                      <p className="font-mono font-bold text-indigo-600 text-sm">{s.number}</p>
                      <p className="text-xs text-slate-500 mt-0.5">
                        {s.customer?.name ?? 'Walk-in'} · {new Date(s.date).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}
                      </p>
                    </div>
                    <span className="text-sm font-semibold text-slate-700">{formatCents(s.totalCents)}</span>
                  </button>
                ))}
              </div>
              {searchQuery.length < 2 && (
                <p className="text-xs text-slate-400 text-center py-3">Type at least 2 characters to search</p>
              )}
            </div>
          )}

          {/* ── STEP B: Select items ── */}
          {step === 'items' && (
            <div className="space-y-3">
              {saleData && (
                <div className="flex items-center gap-2 px-3 py-2 bg-indigo-50 border border-indigo-100 rounded-lg text-sm">
                  <span className="font-mono font-bold text-indigo-600">{saleData.number}</span>
                  <span className="text-slate-500">·</span>
                  <span className="text-slate-600">{(saleData as any).customer?.name ?? 'Walk-in'}</span>
                </div>
              )}

              {saleLoading && <p className="text-center text-slate-400 py-4">Loading invoice…</p>}

              {nothingToReturn && (
                <div className="p-4 bg-amber-50 border border-amber-200 rounded-xl text-center text-amber-800 text-sm">
                  All items from this invoice have already been returned.
                </div>
              )}

              {!saleLoading && !nothingToReturn && returnableLines.map(l => {
                const enteredQty = parseInt(qtys[l.productId] || '0') || 0;
                return (
                  <div key={l.productId} className="flex items-center gap-3 p-3 bg-slate-50 rounded-xl">
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-slate-800 truncate">{l.product.name}</p>
                      <p className="text-xs text-slate-400">
                        Max: {l.availableToReturn} {l.product.unit?.shortCode}
                        {l.alreadyReturnedQty > 0 && ` · ${l.alreadyReturnedQty} already returned`}
                      </p>
                    </div>
                    <div className="text-right shrink-0">
                      <input
                        type="number"
                        min="0"
                        max={l.availableToReturn}
                        value={qtys[l.productId] ?? ''}
                        onChange={e => {
                          const v = e.target.value;
                          const n = parseInt(v) || 0;
                          if (n > l.availableToReturn) return;
                          setQtys(p => ({ ...p, [l.productId]: v }));
                        }}
                        placeholder="0"
                        className="w-16 border border-slate-300 rounded-lg px-2 py-1.5 text-sm text-center focus:outline-none focus:ring-2 focus:ring-orange-400"
                      />
                    </div>
                    {enteredQty > 0 && (
                      <span className="text-xs font-semibold text-orange-700 shrink-0">
                        {formatCents(enteredQty * l.unitPriceCents)}
                      </span>
                    )}
                  </div>
                );
              })}

              {!saleLoading && !nothingToReturn && refundTotal > 0 && (
                <div className="flex items-center justify-between px-3 py-2 bg-orange-50 border border-orange-200 rounded-lg text-sm">
                  <span className="font-semibold text-orange-800">Return total</span>
                  <span className="font-black text-orange-700">{formatCents(refundTotal)}</span>
                </div>
              )}
            </div>
          )}

          {/* ── STEP C: Confirm ── */}
          {step === 'confirm' && (
            <div className="space-y-4">
              {saleData && (
                <div className="bg-slate-50 rounded-xl p-4 space-y-2 text-sm">
                  <p className="font-semibold text-slate-700">Return Summary</p>
                  {returnableLines
                    .filter(l => (parseInt(qtys[l.productId] || '0') || 0) > 0)
                    .map(l => (
                      <div key={l.productId} className="flex justify-between text-slate-600">
                        <span>{l.product.name} × {qtys[l.productId]}</span>
                        <span>{formatCents((parseInt(qtys[l.productId]) || 0) * l.unitPriceCents)}</span>
                      </div>
                    ))}
                  <div className="flex justify-between font-black text-base pt-2 border-t border-slate-200 text-slate-800">
                    <span>Total Refund</span>
                    <span className="text-orange-700">{formatCents(refundTotal)}</span>
                  </div>
                </div>
              )}

              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1.5">Reason (optional)</label>
                <input
                  autoFocus
                  type="text"
                  value={reason}
                  onChange={e => setReason(e.target.value)}
                  placeholder="e.g. Damaged, Wrong item, Customer changed mind…"
                  className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
                />
              </div>
            </div>
          )}
        </div>

        {/* Footer buttons */}
        <div className="px-6 py-4 border-t flex gap-3">
          {step === 'search' && (
            <button onClick={onClose}
              className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
          )}

          {step === 'items' && (
            <>
              {!prefillSaleId && (
                <button onClick={() => { setStep('search'); setSelectedSaleId(''); setQtys({}); }}
                  className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50">
                  ← Back
                </button>
              )}
              {prefillSaleId && (
                <button onClick={onClose}
                  className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
              )}
              <button
                onClick={() => setStep('confirm')}
                disabled={!hasSelectedItems || nothingToReturn}
                className="flex-1 py-2.5 bg-orange-500 text-white rounded-xl text-sm font-semibold hover:bg-orange-600 disabled:opacity-50 transition"
              >
                Next →
              </button>
            </>
          )}

          {step === 'confirm' && (
            <>
              <button onClick={() => setStep('items')}
                className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50">
                ← Back
              </button>
              <button
                onClick={() => mutation.mutate()}
                disabled={mutation.isPending}
                className="flex-[2] py-2.5 bg-orange-500 text-white rounded-xl text-sm font-semibold hover:bg-orange-600 disabled:opacity-60 transition flex items-center justify-center gap-2"
              >
                {mutation.isPending
                  ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Processing…</>
                  : <><CheckCircle className="w-4 h-4" /> Process Return</>
                }
              </button>
            </>
          )}
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
  const [page, setPage]             = useState(1);
  const [detailId, setDetailId]     = useState<string | null>(null);
  const [showNew, setShowNew]       = useState(false);
  const PAGE_SIZE = 15;

  const { data, isLoading } = useQuery({
    queryKey: ['returns', search, page],
    queryFn: () => salesApi.listReturns({ search: search || undefined, page, pageSize: PAGE_SIZE }),
    staleTime: 0,
    placeholderData: prev => prev,
  });

  // Stats
  const { data: monthData } = useQuery({
    queryKey: ['returns-month'],
    queryFn: () => salesApi.listReturns({ from: startOfMonth(), pageSize: 200 } as any),
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

      {/* Search */}
      <div className="relative max-w-xs">
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
