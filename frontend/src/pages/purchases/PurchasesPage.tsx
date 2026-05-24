import { useState, useMemo, useRef } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, X, CheckCircle, XCircle, Eye, Search, ChevronLeft, ChevronRight, Download,
} from 'lucide-react';
import {
  purchasesApi,
  formatCents,
  STATUS_LABELS,
  STATUS_COLORS,
  type PurchaseStatus,
  type PurchaseProduct,
  type PurchaseLine,
  type Purchase,
} from '../../services/purchases';
import { inventoryApi } from '../../services/inventory';
import { exportPurchaseOrder } from '../../services/pdfExport';
import { productsApi } from '../../services/products';
import BarcodeInput from '../../components/common/BarcodeInput';
import axios from 'axios';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LineForm {
  key: number;
  productId: string;
  qty: string;
  unitCost: string; // displayed as dollars
  taxPercent: string;
  unitId?: string;  // selected purchase unit (undefined = base unit)
  expiryDate: string; // YYYY-MM-DD or ''
}

// ─── Supplier Payment Section ─────────────────────────────────────────────────

function SupplierPaymentSection({ poId, totalCents, paidCents }: { poId: string; totalCents: number; paidCents: number }) {
  const queryClient = useQueryClient();
  const outstanding = totalCents - paidCents;
  const [show, setShow]   = useState(false);
  const [amount, setAmount] = useState((outstanding / 100).toFixed(2));
  const [method, setMethod] = useState('CASH');
  const [note, setNote]   = useState('');
  const [err, setErr]     = useState('');

  const { data: history = [] } = useQuery({
    queryKey: ['po-payments', poId],
    queryFn:  () => purchasesApi.listPurchasePayments(poId),
  });

  const mutation = useMutation({
    mutationFn: () => purchasesApi.recordSupplierPayment(poId, {
      amountCents: Math.round(parseFloat(amount) * 100),
      method,
      note: note || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      queryClient.invalidateQueries({ queryKey: ['purchase', poId] });
      queryClient.invalidateQueries({ queryKey: ['po-payments', poId] });
      setShow(false); setErr('');
    },
    onError: (e: any) => setErr(e?.response?.data?.message ?? 'Failed'),
  });

  return (
    <div className="px-6 py-4 border-t border-slate-100">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Supplier Payments</p>
        {outstanding > 0 && (
          <button onClick={() => setShow(s => !s)}
            className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold">
            {show ? 'Cancel' : '+ Record Supplier Payment'}
          </button>
        )}
      </div>

      {history.length > 0 && (
        <div className="space-y-1 mb-3">
          {history.map((p: any) => (
            <div key={p.id} className="flex items-center justify-between text-xs px-3 py-1.5 bg-slate-50 rounded-lg">
              <span className="text-slate-500">{new Date(p.date).toLocaleDateString()}</span>
              <span className="text-slate-600">{p.method.replace('_', ' ')}</span>
              <span className="font-semibold">{formatCents(p.amountCents)}</span>
              {p.note && <span className="text-slate-400">{p.note}</span>}
            </div>
          ))}
        </div>
      )}

      <div className="text-xs text-slate-600 flex gap-4">
        <span>Total: <strong>{formatCents(totalCents)}</strong></span>
        <span>Paid: <strong className="text-green-600">{formatCents(paidCents)}</strong></span>
        <span>Outstanding: <strong className={outstanding > 0 ? 'text-red-600' : 'text-green-600'}>{formatCents(outstanding)}</strong></span>
      </div>

      {show && (
        <div className="mt-3 p-4 bg-indigo-50 rounded-xl space-y-3 border border-indigo-100">
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="grid grid-cols-3 gap-2">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Amount (Rs.)</label>
              <input type="number" min="0.01" step="0.01" value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Method</label>
              <select value={method} onChange={e => setMethod(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400">
                {['CASH','CARD','BANK_TRANSFER','QR_PAY'].map(m => <option key={m} value={m}>{m.replace('_',' ')}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Note</label>
              <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Optional"
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400" />
            </div>
          </div>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="w-full py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 transition">
            {mutation.isPending ? 'Saving…' : 'Record Payment'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Detail Modal ─────────────────────────────────────────────────────────────

function PurchaseDetailModal({
  id,
  onClose,
  onConfirm,
  onCancel,
  onEdit,
}: {
  id: string;
  onClose: () => void;
  onConfirm: (id: string) => void;
  onCancel: (id: string) => void;
  onEdit?: (po: Purchase) => void;
}) {
  const { data: po, isLoading } = useQuery({
    queryKey: ['purchase', id],
    queryFn: () => purchasesApi.getPurchase(id),
  });

  if (isLoading || !po) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-8 w-[700px] max-h-[90vh] overflow-y-auto">
          <div className="text-center text-slate-400 py-10">Loading…</div>
        </div>
      </div>
    );
  }

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-3xl max-h-[90vh] overflow-y-auto shadow-xl">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <div className="text-lg font-bold text-slate-800">{po.number}</div>
            <div className="text-sm text-slate-500">
              {po.supplier.name} · {po.warehouse.name} ·{' '}
              {new Date(po.date).toLocaleDateString()}
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[po.status]}`}>
              {STATUS_LABELS[po.status]}
            </span>
            <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg">
              <X className="w-5 h-5 text-slate-500" />
            </button>
          </div>
        </div>

        {/* Lines table */}
        <div className="px-6 py-4">
          {po.note && (
            <div className="mb-4 p-3 bg-slate-50 rounded-lg text-sm text-slate-600">
              <span className="font-medium">Note: </span>{po.note}
            </div>
          )}
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-slate-500 border-b border-slate-100">
                <th className="pb-2 font-medium">Product</th>
                <th className="pb-2 font-medium text-right">Qty</th>
                <th className="pb-2 font-medium text-right">Unit Cost</th>
                {/* Tax % hidden */}
                <th className="pb-2 font-medium text-right">Expiry</th>
                <th className="pb-2 font-medium text-right">Line Total</th>
              </tr>
            </thead>
            <tbody>
              {(po.lines as PurchaseLine[])?.map((line) => (
                <tr key={line.id} className="border-b border-slate-50">
                  <td className="py-2">
                    <div className="font-medium text-slate-800">{line.product.name}</div>
                    <div className="text-xs text-slate-400">{line.product.sku}</div>
                  </td>
                  <td className="py-2 text-right text-slate-700">
                    {Number(line.qty)} {line.product.unit?.shortCode}
                  </td>
                  <td className="py-2 text-right text-slate-700">
                    {formatCents(line.unitCostCents)}
                  </td>
                  {/* Tax % cell hidden */}
                  <td className="py-2 text-right text-slate-500 text-xs">
                    {(line as any).expiryDate
                      ? new Date((line as any).expiryDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' })
                      : '—'}
                  </td>
                  <td className="py-2 text-right font-medium text-slate-800">
                    {formatCents(line.lineTotalCents)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>

          {/* Totals */}
          <div className="mt-4 flex justify-end">
            <div className="w-56 space-y-1 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span>{formatCents(po.subtotalCents)}</span>
              </div>
              {/* Tax hidden per business decision */}
              <div className="flex justify-between font-bold text-slate-800 border-t border-slate-200 pt-1 mt-1">
                <span>Total</span>
                <span>{formatCents(po.totalCents)}</span>
              </div>
            </div>
          </div>
        </div>

        {/* Supplier Payments section — shown on CONFIRMED POs */}
        {po.status === 'CONFIRMED' && (
          <SupplierPaymentSection poId={id} totalCents={po.totalCents} paidCents={(po as any).paidCents ?? 0} />
        )}

        {/* Footer actions */}
        <div className="flex justify-between items-center px-6 py-4 border-t border-slate-100">
          {/* PDF download — always available */}
          <button
            onClick={() => exportPurchaseOrder(po)}
            className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
          >
            <Download className="w-4 h-4" /> Download PDF
          </button>

          <div className="flex gap-3">
            {po.status === 'DRAFT' && (
              <>
                {onEdit && (
                  <button
                    onClick={() => { onEdit(po); onClose(); }}
                    className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
                  >
                    Edit Draft
                  </button>
                )}
                <button
                  onClick={() => onCancel(id)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
                >
                  <XCircle className="w-4 h-4" /> Cancel Order
                </button>
                <button
                  onClick={() => onConfirm(id)}
                  className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-green-600 text-white text-sm font-medium hover:bg-green-700"
                >
                  <CheckCircle className="w-4 h-4" /> Confirm & Receive Stock
                </button>
              </>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}

// ─── Orders Tab ───────────────────────────────────────────────────────────────

function OrdersTab({ onNewOrder, onEdit }: { onNewOrder: () => void; onEdit: (po: Purchase) => void }) {
  const queryClient = useQueryClient();
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<PurchaseStatus | ''>('');
  const [page, setPage] = useState(1);
  const [detailId, setDetailId]       = useState<string | null>(null);
  const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
  const PAGE_SIZE = 15;

  const { data, isLoading } = useQuery({
    queryKey: ['purchases', search, statusFilter, page],
    queryFn: () =>
      purchasesApi.listPurchases({
        search: search || undefined,
        status: statusFilter || undefined,
        page,
        pageSize: PAGE_SIZE,
      }),
    placeholderData: (prev) => prev,
  });

  const confirmMutation = useMutation({
    mutationFn: (id: string) => purchasesApi.confirmPurchase(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      queryClient.invalidateQueries({ queryKey: ['purchase', detailId] });
      setDetailId(null);
    },
  });

  const cancelMutation = useMutation({
    mutationFn: (id: string) => purchasesApi.cancelPurchase(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      queryClient.invalidateQueries({ queryKey: ['purchase', detailId] });
      setDetailId(null);
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => purchasesApi.deletePurchase(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      setDeleteConfirmId(null);
    },
  });

  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);

  const statusTabs: { label: string; value: PurchaseStatus | '' }[] = [
    { label: 'All', value: '' },
    { label: 'Draft', value: 'DRAFT' },
    { label: 'Confirmed', value: 'CONFIRMED' },
    { label: 'Cancelled', value: 'CANCELLED' },
  ];

  return (
    <div>
      {/* Top bar */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search PO number or supplier…"
            className="pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm w-64 focus:outline-none focus:ring-2 focus:ring-brand-500"
          />
        </div>
        <button
          onClick={onNewOrder}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700"
        >
          <Plus className="w-4 h-4" /> New Purchase Order
        </button>
      </div>

      {/* Status filter pills */}
      <div className="flex gap-1 mb-4">
        {statusTabs.map((t) => (
          <button
            key={t.value}
            onClick={() => { setStatusFilter(t.value); setPage(1); }}
            className={`px-3 py-1 rounded-full text-sm font-medium transition ${
              statusFilter === t.value
                ? 'bg-brand-600 text-white'
                : 'bg-slate-100 text-slate-600 hover:bg-slate-200'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">PO #</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Supplier</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Warehouse</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Lines</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Total</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={8} className="text-center py-12 text-slate-400">Loading…</td>
              </tr>
            )}
            {!isLoading && data?.data.length === 0 && (
              <tr>
                <td colSpan={8} className="text-center py-12 text-slate-400">No purchase orders found</td>
              </tr>
            )}
            {data?.data.map((po) => (
              <tr key={po.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3 font-mono font-medium text-brand-700">{po.number}</td>
                <td className="px-4 py-3 text-slate-700">{po.supplier.name}</td>
                <td className="px-4 py-3 text-slate-500">{po.warehouse.name}</td>
                <td className="px-4 py-3 text-slate-500">
                  {new Date(po.date).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right text-slate-500">
                  {po._count?.lines ?? 0}
                </td>
                <td className="px-4 py-3 text-right font-medium text-slate-800">
                  {formatCents(po.totalCents)}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[po.status]}`}>
                    {STATUS_LABELS[po.status]}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-1">
                    <button
                      title="View details"
                      onClick={() => setDetailId(po.id)}
                      className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700"
                    >
                      <Eye className="w-4 h-4" />
                    </button>
                    {po.status === 'DRAFT' && (
                      <>
                        <button
                          title="Confirm & receive stock"
                          onClick={() => confirmMutation.mutate(po.id)}
                          disabled={confirmMutation.isPending}
                          className="p-1.5 rounded hover:bg-green-50 text-green-600 hover:text-green-700"
                        >
                          <CheckCircle className="w-4 h-4" />
                        </button>
                        <button
                          title="Cancel order"
                          onClick={() => cancelMutation.mutate(po.id)}
                          disabled={cancelMutation.isPending}
                          className="p-1.5 rounded hover:bg-red-50 text-red-500 hover:text-red-600"
                        >
                          <XCircle className="w-4 h-4" />
                        </button>
                        <button
                          title="Delete draft"
                          onClick={() => setDeleteConfirmId(po.id)}
                          className="p-1.5 rounded hover:bg-red-50 text-red-400 hover:text-red-600"
                        >
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm text-slate-600">
            <span>{total} orders</span>
            <div className="flex items-center gap-2">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-40"
              >
                <ChevronLeft className="w-4 h-4" />
              </button>
              <span>Page {page} of {totalPages}</span>
              <button
                disabled={page === totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-40"
              >
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Detail modal */}
      {detailId && (
        <PurchaseDetailModal
          id={detailId}
          onClose={() => setDetailId(null)}
          onConfirm={(id) => confirmMutation.mutate(id)}
          onCancel={(id) => cancelMutation.mutate(id)}
          onEdit={(po) => { setDetailId(null); onEdit(po); }}
        />
      )}

      {/* Delete DRAFT confirm dialog */}
      {deleteConfirmId && (() => {
        const po = data?.data.find(p => p.id === deleteConfirmId);
        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl w-full max-w-sm shadow-xl p-6">
              <h3 className="font-bold text-slate-800 mb-2">Delete {po?.number ?? 'Draft'}?</h3>
              <p className="text-sm text-slate-500 mb-5">This cannot be undone. Only DRAFT orders can be deleted.</p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteConfirmId(null)}
                  className="flex-1 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
                <button onClick={() => deleteMutation.mutate(deleteConfirmId!)}
                  disabled={deleteMutation.isPending}
                  className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-60">
                  {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ─── New Order Tab ────────────────────────────────────────────────────────────

function NewOrderTab({ onSuccess, editPO }: { onSuccess: () => void; editPO?: Purchase }) {
  const queryClient = useQueryClient();
  const isEdit = !!editPO;

  const [supplierId, setSupplierId] = useState(editPO?.supplier?.id ?? '');
  const [warehouseId, setWarehouseId] = useState(editPO?.warehouse?.id ?? '');
  const [date, setDate] = useState(
    editPO ? new Date(editPO.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
  );
  const [note, setNote] = useState(editPO?.note ?? '');
  const [lines, setLines] = useState<LineForm[]>(
    editPO?.lines?.length
      ? editPO.lines.map((l, i) => ({
          key:        i,
          productId:  l.productId,
          qty:        String(Number(l.qty)),
          unitCost:   (l.unitCostCents / 100).toFixed(2),
          taxPercent: String(l.taxPercent),
          expiryDate: (l as any).expiryDate
            ? new Date((l as any).expiryDate).toISOString().slice(0, 10)
            : '',
        }))
      : [],
  );
  const [error, setError]         = useState('');
  const [scanToast, setScanToast] = useState<{ msg: string; ok: boolean } | null>(null);
  const scanToastTimer            = useRef<ReturnType<typeof setTimeout> | null>(null);

  function showScanToast(msg: string, ok: boolean) {
    if (scanToastTimer.current) clearTimeout(scanToastTimer.current);
    setScanToast({ msg, ok });
    scanToastTimer.current = setTimeout(() => setScanToast(null), 2500);
  }

  async function handlePurchaseScan(barcode: string) {
    try {
      const found = await productsApi.getByBarcode(barcode);

      // Check if product already exists in lines
      const existingLineIdx = lines.findIndex(l => l.productId === found.id);
      if (existingLineIdx !== -1) {
        // Increment qty on existing line
        setLines(prev => prev.map((l, i) =>
          i === existingLineIdx
            ? { ...l, qty: String((parseFloat(l.qty) || 0) + 1) }
            : l,
        ));
        showScanToast(`✓ ${found.name} — qty +1`, true);
      } else {
        // Add new line, re-use handleProductChange logic
        const newKey = Date.now();
        setLines(prev => [
          ...prev,
          {
            key:        newKey,
            productId:  found.id,
            qty:        '1',
            unitCost:   (found.costCents / 100).toFixed(2),
            taxPercent: String(found.taxPercent),
            expiryDate: '',
          },
        ]);
        showScanToast(`✓ ${found.name} added`, true);
      }
    } catch (err: unknown) {
      if (axios.isAxiosError(err) && err.response?.status === 404) {
        showScanToast(`No product: "${barcode}". Add it in Products first.`, false);
      } else {
        showScanToast('Scan error — try again', false);
      }
    }
  }

  const { data: suppliers = [] } = useQuery({
    queryKey: ['purchase-suppliers'],
    queryFn: purchasesApi.listSuppliers,
  });

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn: inventoryApi.getWarehouses,
  });

  const { data: products = [] } = useQuery({
    queryKey: ['purchase-products'],
    queryFn: purchasesApi.listProducts,
  });

  const productMap = useMemo<Record<string, PurchaseProduct>>(
    () => Object.fromEntries(products.map((p) => [p.id, p])),
    [products],
  );

  const createMutation = useMutation({
    mutationFn: purchasesApi.createPurchase,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      onSuccess();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })
        ?.response?.data?.message;
      setError(msg ?? 'Failed to create purchase order');
    },
  });

  const updateMutation = useMutation({
    mutationFn: (payload: Parameters<typeof purchasesApi.updatePurchase>[1]) =>
      purchasesApi.updatePurchase(editPO!.id, payload),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      queryClient.invalidateQueries({ queryKey: ['purchase', editPO!.id] });
      onSuccess();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })
        ?.response?.data?.message;
      setError(msg ?? 'Failed to update purchase order');
    },
  });

  // When user picks a product, prefill the unit cost from the product's last cost
  const handleProductChange = (key: number, productId: string) => {
    const product = productMap[productId];
    setLines((prev) =>
      prev.map((l) =>
        l.key === key
          ? {
              ...l,
              productId,
              unitCost: product ? (product.costCents / 100).toFixed(2) : '',
              taxPercent: product ? String(product.taxPercent) : '0',
            }
          : l,
      ),
    );
  };

  const updateLine = (key: number, field: keyof LineForm, value: string) => {
    setLines((prev) =>
      prev.map((l) => (l.key === key ? { ...l, [field]: value } : l)),
    );
  };

  const addLine = () => {
    setLines((prev) => [
      ...prev,
      { key: Date.now(), productId: '', qty: '1', unitCost: '', taxPercent: '0', expiryDate: '' },
    ]);
  };

  const removeLine = (key: number) => {
    setLines((prev) => prev.filter((l) => l.key !== key));
  };

  // Compute totals for display — no tax per business decision
  const computed = useMemo(() => {
    let subtotal = 0;
    lines.forEach((l) => {
      const qty = parseFloat(l.qty) || 0;
      const cost = Math.round((parseFloat(l.unitCost) || 0) * 100);
      subtotal += Math.round(qty * cost);
    });
    return { subtotal, total: subtotal };
  }, [lines]);

  const handleSubmit = () => {
    setError('');
    if (!supplierId) return setError('Please select a supplier');
    if (!warehouseId) return setError('Please select a warehouse');
    if (lines.length === 0) return setError('Add at least one line item');

    for (const l of lines) {
      if (!l.productId) return setError('Select a product for every line');
      if (!(parseFloat(l.qty) > 0)) return setError('Quantity must be > 0');
      if (parseFloat(l.unitCost) < 0) return setError('Unit cost cannot be negative');
    }

    const payload = {
      supplierId,
      warehouseId,
      date: new Date(date).toISOString(),
      note: note || undefined,
      lines: lines.map((l) => {
        const product    = l.productId ? productMap[l.productId] : null;
        const baseUnitId = product?.baseUnitId ?? product?.unitId ?? undefined;
        return {
          productId:     l.productId,
          qty:           parseFloat(l.qty),
          unitCostCents: Math.round((parseFloat(l.unitCost) || 0) * 100),
          taxPercent:    parseFloat(l.taxPercent) || 0,
          unitId:        l.unitId && l.unitId !== baseUnitId ? l.unitId : undefined,
          expiryDate:    l.expiryDate ? new Date(l.expiryDate).toISOString() : null,
        };
      }),
    };

    if (isEdit) {
      updateMutation.mutate(payload);
    } else {
      createMutation.mutate(payload);
    }
  };

  const isPending = createMutation.isPending || updateMutation.isPending;
  const isSuccess = createMutation.isSuccess || updateMutation.isSuccess;

  return (
    <div className="max-w-4xl">
      {/* Header */}
      <h2 className="text-base font-semibold text-slate-800 mb-4">
        {isEdit ? `Edit Draft — ${editPO!.number}` : 'Create Purchase Order'}
      </h2>

      {error && (
        <div className="mb-4 p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">
          {error}
        </div>
      )}

      {/* PO details */}
      <div className="bg-white border border-slate-200 rounded-xl p-5 mb-4">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Supplier *</label>
            <select
              value={supplierId}
              onChange={(e) => setSupplierId(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Select supplier…</option>
              {suppliers.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Receive to Warehouse *</label>
            <select
              value={warehouseId}
              onChange={(e) => setWarehouseId(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            >
              <option value="">Select warehouse…</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
              ))}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Order Date</label>
            <input
              type="date"
              value={date}
              onChange={(e) => setDate(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Note (optional)</label>
            <input
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="e.g. Urgent, deliver by Friday"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            />
          </div>
        </div>
      </div>

      {/* Barcode scan to add lines */}
      <div className="mb-3">
        <label className="block text-xs font-medium text-slate-500 mb-1">Scan product barcode to add line</label>
        <div className="flex items-center gap-2">
          <BarcodeInput
            onScan={(code) => { void handlePurchaseScan(code); }}
            placeholder="Scan barcode to add line…"
            showScanning
            className="max-w-xs"
          />
          {scanToast && (
            <span className={`text-xs font-medium px-2.5 py-1 rounded-lg ${scanToast.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
              {scanToast.msg}
            </span>
          )}
        </div>
      </div>

      {/* Lines table */}
      <div className="bg-white border border-slate-200 rounded-xl overflow-hidden mb-4">
        <div className="px-5 py-3 border-b border-slate-100 flex items-center justify-between">
          <span className="text-sm font-semibold text-slate-700">Line Items</span>
          <button
            onClick={addLine}
            className="flex items-center gap-1 text-sm text-brand-600 hover:text-brand-700 font-medium"
          >
            <Plus className="w-4 h-4" /> Add Line
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-100">
              <tr>
                <th className="text-left px-4 py-2 text-xs font-medium text-slate-500">Product</th>
                <th className="text-left px-3 py-2 text-xs font-medium text-slate-500 w-28">Unit</th>
                <th className="text-right px-3 py-2 text-xs font-medium text-slate-500 w-24">Qty</th>
                <th className="text-right px-3 py-2 text-xs font-medium text-slate-500 w-32">Unit Cost (Rs.)</th>
                {/* Tax % hidden per business decision */}
                <th className="text-right px-3 py-2 text-xs font-medium text-slate-500 w-30">Expiry Date</th>
                <th className="text-right px-3 py-2 text-xs font-medium text-slate-500 w-28">Line Total</th>
                <th className="w-10" />
              </tr>
            </thead>
            <tbody>
              {lines.length === 0 && (
                <tr>
                  <td colSpan={7} className="px-5 py-6 text-center text-sm text-slate-400">
                    Scan a barcode or click <strong>+ Add Line</strong> to begin
                  </td>
                </tr>
              )}
              {lines.map((line) => {
                const qty = parseFloat(line.qty) || 0;
                const cost = Math.round((parseFloat(line.unitCost) || 0) * 100);
                const lineTotal = Math.round(qty * cost); // No tax per business decision

                return (
                  <tr key={line.key} className="border-b border-slate-50 align-top">
                    <td className="px-4 py-2">
                      <select
                        value={line.productId}
                        onChange={(e) => handleProductChange(line.key, e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                      >
                        <option value="">Select product…</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>
                            {p.name} ({p.sku})
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      {(() => {
                        const product = line.productId ? productMap[line.productId] : null;
                        const baseUnitId = product?.baseUnitId ?? product?.unitId ?? '';
                        const baseUnit   = product?.baseUnit   ?? product?.unit;
                        const purchaseConvs = (product?.unitConversions ?? []).filter(
                          (c) => c.toUnitId === baseUnitId,
                        );
                        if (!product || purchaseConvs.length === 0) {
                          return (
                            <span className="text-xs text-slate-500 px-1">
                              {baseUnit?.shortCode ?? '—'}
                            </span>
                          );
                        }
                        const selectedUnitId = line.unitId ?? baseUnitId;
                        const selectedConv = purchaseConvs.find((c) => c.fromUnitId === selectedUnitId);
                        const qty = parseFloat(line.qty) || 0;
                        const baseQtyPreview = selectedConv
                          ? qty * Number(selectedConv.conversionQty)
                          : qty;
                        return (
                          <div>
                            <select
                              value={selectedUnitId}
                              onChange={(e) => updateLine(line.key, 'unitId', e.target.value)}
                              className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-brand-500"
                            >
                              <option value={baseUnitId}>{baseUnit?.shortCode} (base)</option>
                              {purchaseConvs.map((c) => (
                                <option key={c.fromUnitId} value={c.fromUnitId}>
                                  {c.fromUnit.shortCode}
                                </option>
                              ))}
                            </select>
                            {selectedConv && qty > 0 && (
                              <p className="text-[10px] text-indigo-500 mt-0.5 px-1">
                                → {baseQtyPreview} {baseUnit?.shortCode} added to stock
                              </p>
                            )}
                          </div>
                        );
                      })()}
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0.01"
                        step="0.01"
                        value={line.qty}
                        onChange={(e) => updateLine(line.key, 'qty', e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unitCost}
                        onChange={(e) => updateLine(line.key, 'unitCost', e.target.value)}
                        placeholder="0.00"
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm text-right focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </td>
                    {/* Tax % input hidden per business decision */}
                    <td className="px-3 py-2">
                      <input
                        type="date"
                        value={line.expiryDate}
                        onChange={(e) => updateLine(line.key, 'expiryDate', e.target.value)}
                        className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-brand-500"
                      />
                    </td>
                    <td className="px-3 py-2 text-right font-medium text-slate-700">
                      {formatCents(lineTotal)}
                    </td>
                    <td className="px-2 py-2 text-center">
                      <button
                        onClick={() => removeLine(line.key)}
                        disabled={false}
                        className="p-1 rounded hover:bg-red-50 text-slate-400 hover:text-red-500 disabled:opacity-30"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Order totals */}
        <div className="flex justify-end px-5 py-4 border-t border-slate-100">
          <div className="w-52 space-y-1 text-sm">
            <div className="flex justify-between text-slate-600">
              <span>Subtotal</span>
              <span>{formatCents(computed.subtotal)}</span>
            </div>
            {/* Tax hidden per business decision */}
            <div className="flex justify-between font-bold text-slate-800 border-t border-slate-200 pt-1 mt-1">
              <span>Total</span>
              <span>{formatCents(computed.total)}</span>
            </div>
          </div>
        </div>
      </div>

      {/* Submit */}
      <div className="flex justify-end">
        <button
          onClick={handleSubmit}
          disabled={isPending}
          className="px-6 py-2.5 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700 disabled:opacity-60"
        >
          {isPending ? 'Saving…' : isEdit ? 'Update Draft' : 'Save as Draft'}
        </button>
      </div>

      {isSuccess && (
        <div className="mt-3 p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm text-center">
          {isEdit ? 'Purchase order updated!' : 'Purchase order created!'}{' '}
          Go to <strong>Orders</strong> tab to confirm and receive stock.
        </div>
      )}
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'orders' | 'new';

export default function PurchasesPage() {
  const [tab, setTab] = useState<Tab>('orders');
  const [editPO, setEditPO] = useState<Purchase | undefined>(undefined);

  const openEdit = (po: Purchase) => {
    setEditPO(po);
    setTab('new');
  };

  const openNew = () => {
    setEditPO(undefined);
    setTab('new');
  };

  return (
    <div className="p-6">
      {/* Page header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Purchases</h1>
        <p className="text-sm text-slate-500 mt-0.5">
          Create purchase orders and receive stock into your warehouse
        </p>
      </div>

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {([
          { key: 'orders', label: 'Purchase Orders' },
          { key: 'new',    label: editPO ? `Editing ${editPO.number}` : '+ New Order' },
        ] as { key: Tab; label: string }[]).map((t) => (
          <button
            key={t.key}
            onClick={() => { if (t.key === 'new') openNew(); else setTab('orders'); }}
            className={`px-4 py-2 text-sm font-medium border-b-2 transition ${
              tab === t.key
                ? 'border-brand-600 text-brand-700'
                : 'border-transparent text-slate-500 hover:text-slate-700'
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {tab === 'orders' && (
        <OrdersTab onNewOrder={openNew} onEdit={openEdit} />
      )}
      {tab === 'new' && (
        <NewOrderTab onSuccess={() => { setEditPO(undefined); setTab('orders'); }} editPO={editPO} />
      )}
    </div>
  );
}
