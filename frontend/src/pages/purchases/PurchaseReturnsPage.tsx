import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  CornerUpLeft, Plus, X, CheckCircle, XCircle, Trash2, Eye,
  RefreshCw, Printer, Search, ChevronDown, ChevronUp, AlertCircle,
} from 'lucide-react';
import {
  purchaseReturnsApi, printDebitNote, formatCents,
  RETURN_STATUS_LABELS, RETURN_STATUS_COLORS,
  type PurchaseReturn, type ReturnStatus,
} from '../../services/purchaseReturns';
import { purchasesApi } from '../../services/purchases';
import AttachmentPanel from '../../components/common/AttachmentPanel';

// ─── New Return Drawer ────────────────────────────────────────────────────────

function NewReturnDrawer({ onClose }: { onClose: () => void }) {
  const qc = useQueryClient();
  const [purchaseId, setPurchaseId]   = useState('');
  const [reason, setReason]           = useState('');
  const [lineQtys, setLineQtys]       = useState<Record<string, string>>({});
  const [error, setError]             = useState('');

  const { data: purchases = [] } = useQuery({
    queryKey: ['purchases-for-return'],
    queryFn:  () => purchasesApi.listPurchases({ status: 'CONFIRMED', page: 1, pageSize: 100 }).then((r) => r.data),
  });

  const { data: selectedPO } = useQuery({
    queryKey: ['purchase-detail-for-return', purchaseId],
    queryFn:  () => purchasesApi.getPurchase(purchaseId),
    enabled:  !!purchaseId,
  });

  const createMut = useMutation({
    mutationFn: () => {
      const lines = (selectedPO?.lines ?? [])
        .filter((l: any) => {
          const q = parseFloat(lineQtys[l.id] ?? '0');
          return q > 0;
        })
        .map((l: any) => ({
          purchaseLineId: l.id,
          qty:            parseFloat(lineQtys[l.id]),
        }));

      if (lines.length === 0) throw new Error('Enter qty for at least one line');
      return purchaseReturnsApi.create({ purchaseId, reason: reason || undefined, lines });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-returns'] });
      onClose();
    },
    onError: (err: any) => setError(err?.response?.data?.message ?? err.message ?? 'Failed to create return'),
  });

  const poLines = selectedPO?.lines ?? [];

  return (
    <div className="fixed inset-0 bg-black/40 flex items-end sm:items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-2">
            <CornerUpLeft className="w-5 h-5 text-orange-600" />
            <h2 className="text-base font-bold text-slate-800">New Purchase Return</h2>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-500" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <div className="flex items-center gap-2 p-3 bg-red-50 border border-red-200 text-red-700 rounded-xl text-sm">
              <AlertCircle className="w-4 h-4 shrink-0" />{error}
            </div>
          )}

          {/* PO selector */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Purchase Order (CONFIRMED only)</label>
            <select value={purchaseId} onChange={(e) => { setPurchaseId(e.target.value); setLineQtys({}); }}
              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400">
              <option value="">— Select PO —</option>
              {purchases.map((po: any) => (
                <option key={po.id} value={po.id}>{po.number} · {po.supplier?.name ?? ''}</option>
              ))}
            </select>
          </div>

          {/* Reason */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Reason (optional)</label>
            <input type="text" value={reason} onChange={(e) => setReason(e.target.value)}
              placeholder="e.g. Damaged goods, wrong items"
              className="w-full border border-slate-300 rounded-xl px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
          </div>

          {/* Lines */}
          {selectedPO && poLines.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Return Quantities</p>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Product</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Ordered</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Received</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Returned</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Return Qty</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {poLines.map((l: any) => {
                      const maxReturn = Number(l.receivedQty ?? 0) - Number(l.returnedQty ?? 0);
                      return (
                        <tr key={l.id} className={maxReturn <= 0 ? 'opacity-40' : ''}>
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-slate-800">{l.product?.name}</p>
                            <p className="text-xs text-slate-400">{l.product?.sku}</p>
                          </td>
                          <td className="px-4 py-2.5 text-right text-slate-600">{Number(l.qty)}</td>
                          <td className="px-4 py-2.5 text-right text-slate-600">{Number(l.receivedQty ?? 0)}</td>
                          <td className="px-4 py-2.5 text-right text-slate-600">{Number(l.returnedQty ?? 0)}</td>
                          <td className="px-4 py-2.5 text-right">
                            <input
                              type="number" min="0" max={maxReturn} step="1"
                              disabled={maxReturn <= 0}
                              value={lineQtys[l.id] ?? ''}
                              onChange={(e) => setLineQtys((prev) => ({ ...prev, [l.id]: e.target.value }))}
                              placeholder="0"
                              className="w-20 text-right border border-slate-300 rounded-lg px-2 py-1 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400 disabled:bg-slate-50 disabled:text-slate-400"
                            />
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
              <p className="text-[10px] text-slate-400 mt-1.5">Only received qty minus already-returned qty can be returned.</p>
            </div>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-200 flex gap-3">
          <button onClick={onClose}
            className="flex-1 py-2 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50">
            Cancel
          </button>
          <button onClick={() => createMut.mutate()} disabled={!purchaseId || createMut.isPending}
            className="flex-1 py-2 bg-orange-600 text-white rounded-xl text-sm font-semibold hover:bg-orange-700 disabled:opacity-60">
            {createMut.isPending ? 'Creating…' : 'Create Draft Return'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Return Detail Modal ──────────────────────────────────────────────────────

function ReturnDetailModal({ ret, onClose }: { ret: PurchaseReturn; onClose: () => void }) {
  const qc = useQueryClient();

  const { data: detail, isLoading } = useQuery({
    queryKey: ['purchase-return', ret.id],
    queryFn:  () => purchaseReturnsApi.get(ret.id),
  });

  const confirmMut = useMutation({
    mutationFn: () => purchaseReturnsApi.confirm(ret.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchase-returns'] }); qc.invalidateQueries({ queryKey: ['purchase-return', ret.id] }); },
  });
  const cancelMut = useMutation({
    mutationFn: () => purchaseReturnsApi.cancel(ret.id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchase-returns'] }); qc.invalidateQueries({ queryKey: ['purchase-return', ret.id] }); },
  });

  const r = detail ?? ret;
  const sc = RETURN_STATUS_COLORS[r.status as ReturnStatus];

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="p-2 bg-orange-50 rounded-lg"><CornerUpLeft className="w-4 h-4 text-orange-600" /></div>
            <div>
              <h2 className="font-bold text-slate-800">{r.number}</h2>
              <p className="text-xs text-slate-400">Purchase Return · {new Date(r.createdAt).toLocaleDateString()}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${sc}`}>{RETURN_STATUS_LABELS[r.status as ReturnStatus]}</span>
            {r.status === 'CONFIRMED' && (
              <button onClick={() => printDebitNote(r)}
                className="p-2 text-slate-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition" title="Print Debit Note">
                <Printer className="w-4 h-4" />
              </button>
            )}
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-500" /></button>
          </div>
        </div>

        {isLoading ? (
          <div className="flex-1 flex items-center justify-center py-12">
            <RefreshCw className="w-6 h-6 text-slate-400 animate-spin" />
          </div>
        ) : (
          <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
            {/* Info grid */}
            <div className="grid grid-cols-3 gap-4 text-sm">
              <div><p className="text-xs text-slate-400 mb-0.5">Supplier</p><p className="font-medium text-slate-800">{r.supplier.name}</p></div>
              <div><p className="text-xs text-slate-400 mb-0.5">Original PO</p><p className="font-medium text-slate-800">{r.purchase.number}</p></div>
              <div><p className="text-xs text-slate-400 mb-0.5">Warehouse</p><p className="font-medium text-slate-800">{r.warehouse.name}</p></div>
              <div><p className="text-xs text-slate-400 mb-0.5">Prepared by</p><p className="font-medium text-slate-800">{r.createdBy.fullName}</p></div>
              {r.reason && <div className="col-span-2"><p className="text-xs text-slate-400 mb-0.5">Reason</p><p className="font-medium text-slate-800">{r.reason}</p></div>}
            </div>

            {/* Lines */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Items Returned</p>
              <div className="border border-slate-200 rounded-xl overflow-hidden">
                <table className="w-full text-sm">
                  <thead className="bg-slate-50">
                    <tr>
                      <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Product</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Qty</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Unit Cost</th>
                      <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {(r.lines ?? []).map((l) => (
                      <tr key={l.id} className="hover:bg-slate-50">
                        <td className="px-4 py-2.5">
                          <p className="font-medium text-slate-800">{l.product.name}</p>
                          <p className="text-xs text-slate-400">{l.product.sku}</p>
                        </td>
                        <td className="px-4 py-2.5 text-right text-slate-700">{Number(l.qty)}</td>
                        <td className="px-4 py-2.5 text-right text-slate-700">{formatCents(l.unitCostCents)}</td>
                        <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{formatCents(l.lineTotalCents)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>

            {/* Total */}
            <div className="bg-slate-50 rounded-xl p-4 flex justify-between items-center">
              <span className="text-sm text-slate-500 font-medium">Total Credit to Claim</span>
              <span className="text-lg font-bold text-orange-700">{formatCents(r.totalCents)}</span>
            </div>

            {/* Attachments — only visible on confirmed returns */}
            {r.status === 'CONFIRMED' && (
              <AttachmentPanel refType="PurchaseReturn" refId={r.id} />
            )}
          </div>
        )}

        {/* Footer actions */}
        {r.status === 'DRAFT' && (
          <div className="px-6 py-4 border-t border-slate-200 flex gap-2">
            <button onClick={() => confirmMut.mutate()} disabled={confirmMut.isPending}
              className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-xl text-sm font-semibold hover:bg-green-700 disabled:opacity-60">
              <CheckCircle className="w-4 h-4" /> Confirm & Return Stock
            </button>
            <button onClick={() => cancelMut.mutate()} disabled={cancelMut.isPending}
              className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 text-slate-600 rounded-xl text-sm hover:bg-slate-50 disabled:opacity-60">
              <XCircle className="w-4 h-4" /> Cancel
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function PurchaseReturnsPage() {
  const qc = useQueryClient();
  const [showNew, setShowNew]         = useState(false);
  const [selected, setSelected]       = useState<PurchaseReturn | null>(null);
  const [search, setSearch]           = useState('');
  const [statusFilter, setStatusFilter] = useState<ReturnStatus | 'ALL'>('ALL');

  const { data: returns = [], isLoading } = useQuery<PurchaseReturn[]>({
    queryKey: ['purchase-returns'],
    queryFn:  () => purchaseReturnsApi.list(),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => purchaseReturnsApi.delete(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['purchase-returns'] }),
  });

  const filtered = returns.filter((r) => {
    const matchStatus = statusFilter === 'ALL' || r.status === statusFilter;
    const matchSearch = !search
      || r.number.toLowerCase().includes(search.toLowerCase())
      || r.supplier.name.toLowerCase().includes(search.toLowerCase())
      || r.purchase.number.toLowerCase().includes(search.toLowerCase());
    return matchStatus && matchSearch;
  });

  return (
    <div className="p-6 space-y-6">
      {/* Page header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <CornerUpLeft className="w-6 h-6 text-orange-600" /> Purchase Returns
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Return goods to suppliers and generate debit notes</p>
        </div>
        <button onClick={() => setShowNew(true)}
          className="flex items-center gap-1.5 px-4 py-2 bg-orange-600 text-white rounded-xl text-sm font-semibold hover:bg-orange-700 transition shadow-sm">
          <Plus className="w-4 h-4" /> New Return
        </button>
      </div>

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text" value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by number, supplier, PO…"
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-xl text-sm focus:outline-none focus:ring-2 focus:ring-orange-400"
          />
        </div>
        <div className="flex gap-1.5">
          {(['ALL', 'DRAFT', 'CONFIRMED', 'CANCELLED'] as const).map((s) => (
            <button key={s} onClick={() => setStatusFilter(s)}
              className={`px-3 py-1.5 rounded-xl text-xs font-medium border transition ${
                statusFilter === s
                  ? 'bg-orange-600 border-orange-600 text-white'
                  : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}>
              {s === 'ALL' ? 'All' : RETURN_STATUS_LABELS[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-2xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center py-16 gap-2 text-slate-400">
            <RefreshCw className="w-5 h-5 animate-spin" /><span className="text-sm">Loading…</span>
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <CornerUpLeft className="w-10 h-10 mx-auto mb-3 opacity-30" />
            <p className="text-sm">No purchase returns found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">Return #</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">PO #</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">Supplier</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">Date</th>
                <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">Status</th>
                <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500">Total Credit</th>
                <th className="px-5 py-3 text-center text-xs font-semibold text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((r) => (
                <tr key={r.id} className="hover:bg-slate-50 transition group">
                  <td className="px-5 py-3 font-mono text-xs font-semibold text-orange-700">{r.number}</td>
                  <td className="px-5 py-3 text-slate-600 font-mono text-xs">{r.purchase.number}</td>
                  <td className="px-5 py-3 font-medium text-slate-800">{r.supplier.name}</td>
                  <td className="px-5 py-3 text-slate-500">{new Date(r.createdAt).toLocaleDateString()}</td>
                  <td className="px-5 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${RETURN_STATUS_COLORS[r.status as ReturnStatus]}`}>
                      {RETURN_STATUS_LABELS[r.status as ReturnStatus]}
                    </span>
                  </td>
                  <td className="px-5 py-3 text-right font-semibold text-slate-800">{formatCents(r.totalCents)}</td>
                  <td className="px-5 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button onClick={() => setSelected(r)}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition" title="View">
                        <Eye className="w-4 h-4" />
                      </button>
                      {r.status === 'CONFIRMED' && (
                        <button onClick={() => printDebitNote(r)}
                          className="p-1.5 text-slate-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition" title="Print Debit Note">
                          <Printer className="w-4 h-4" />
                        </button>
                      )}
                      {r.status === 'DRAFT' && (
                        <button
                          onClick={() => { if (window.confirm(`Delete ${r.number}?`)) deleteMut.mutate(r.id); }}
                          disabled={deleteMut.isPending}
                          className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded-lg transition" title="Delete">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {showNew  && <NewReturnDrawer onClose={() => setShowNew(false)} />}
      {selected && <ReturnDetailModal ret={selected} onClose={() => setSelected(null)} />}
    </div>
  );
}
