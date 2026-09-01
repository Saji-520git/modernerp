import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { RotateCcw, Search, AlertCircle, CheckCircle } from 'lucide-react';
import { salesApi, formatCents } from '../../services/sales';

// ─── New Return Modal (3-step) ─────────────────────────────────────────────────

type Step = 'search' | 'items' | 'confirm';

interface NewReturnModalProps {
  onClose: () => void;
  prefillSaleId?: string; // skip step A if provided
}

export default function NewReturnModal({ onClose, prefillSaleId }: NewReturnModalProps) {
  const queryClient = useQueryClient();
  const [step, setStep]             = useState<Step>(prefillSaleId ? 'items' : 'search');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedSaleId, setSelectedSaleId] = useState(prefillSaleId ?? '');
  const [qtys, setQtys]             = useState<Record<string, string>>({});
  const [reason, setReason]         = useState('');
  const [error, setError]           = useState('');
  const [refundMethod, setRefundMethod]   = useState<'NONE' | 'CASH' | 'CARD' | 'BANK'>('NONE');
  const [refundedCents, setRefundedCents] = useState(0);

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
    return sum + q * l.refundUnitCents;
  }, 0);

  const hasSelectedItems = returnableLines.some(l => (parseInt(qtys[l.productId] || '0') || 0) > 0);

  const mutation = useMutation({
    mutationFn: () => salesApi.createReturn({
      saleId: selectedSaleId,
      reason: reason || undefined,
      refundMethod,
      refundedCents: refundMethod === 'NONE' ? 0 : refundedCents,
      lines: returnableLines
        .filter(l => parseInt(qtys[l.productId] || '0') > 0)
        .map(l => ({
          productId: l.productId,
          qty: parseInt(qtys[l.productId]),
          unitPriceCents: l.refundUnitCents,
          lineTotalCents: Math.round(l.refundUnitCents * parseInt(qtys[l.productId])),
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
                        {formatCents(enteredQty * l.refundUnitCents)}
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
                        <span>{formatCents((parseInt(qtys[l.productId]) || 0) * l.refundUnitCents)}</span>
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

              <div className="border-t pt-4">
                <label className="block text-xs font-semibold text-slate-600 mb-2">Refund to Customer</label>
                <div className="grid grid-cols-4 gap-2">
                  {(['NONE', 'CASH', 'CARD', 'BANK'] as const).map(m => (
                    <button key={m} type="button"
                      onClick={() => { setRefundMethod(m); if (m === 'NONE') setRefundedCents(0); else if (refundedCents === 0) setRefundedCents(refundTotal); }}
                      className={`py-2 rounded-xl text-xs font-semibold border transition ${refundMethod === m ? 'bg-green-600 text-white border-green-600' : 'bg-white text-slate-600 border-slate-200 hover:border-green-400'}`}>
                      {m === 'NONE' ? 'No Refund' : m === 'BANK' ? 'Bank' : m.charAt(0) + m.slice(1).toLowerCase()}
                    </button>
                  ))}
                </div>
                {refundMethod !== 'NONE' ? (
                  <div className="mt-3">
                    <label className="block text-xs font-semibold text-slate-600 mb-1.5">Refund Amount (Rs.)</label>
                    <input type="number" min="0" step="0.01" value={(refundedCents / 100).toFixed(2)}
                      onChange={e => setRefundedCents(Math.round(parseFloat(e.target.value) * 100) || 0)}
                      className="w-full border border-slate-200 rounded-xl px-3 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-green-400" />
                    <p className="text-xs text-slate-400 mt-1">Amount of cash/card refund given to customer.</p>
                  </div>
                ) : (
                  <p className="text-xs text-slate-400 mt-2">No cash refund — return will be recorded as store credit against this invoice.</p>
                )}
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
