import { useState, useMemo, useRef, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Trash2, X, CheckCircle, XCircle, Eye, Search, ChevronLeft, ChevronRight, Download,
  Truck, PackageCheck, Paperclip, Printer, Loader2,
} from 'lucide-react';
import AttachmentPanel from '../../components/common/AttachmentPanel';
import SearchableSelect from '../../components/common/SearchableSelect';
import { api } from '../../services/api';
import {
  purchasesApi,
  formatCents,
  STATUS_LABELS,
  STATUS_COLORS,
  DELIVERY_LABELS,
  DELIVERY_COLORS,
  type PurchaseStatus,
  type PurchasePaymentStatus,
  type DeliveryStatus,
  type PurchaseProduct,
  type PurchaseLine,
  type PurchaseReceipt,
  type Purchase,
  type SupplierPayment,
  type CreateReceiptLineInput,
} from '../../services/purchases';
import {
  supplierPaymentsApi,
  generateVoucherHtml,
  printVoucher,
  SPAY_METHOD_LABELS,
  type SupplierPaymentMethod,
} from '../../services/supplierPayments';
import { inventoryApi } from '../../services/inventory';
import { exportPurchaseOrder } from '../../services/pdfExport';
import { productsApi } from '../../services/products';
import BarcodeInput from '../../components/common/BarcodeInput';
import axios from 'axios';
import {
  purchaseReturnsApi, printDebitNote,
  RETURN_STATUS_LABELS, RETURN_STATUS_COLORS,
  formatCents as fmtReturnCents,
  type PurchaseReturn, type ReturnStatus,
} from '../../services/purchaseReturns';
import { CornerUpLeft } from 'lucide-react';

// ─── Types ────────────────────────────────────────────────────────────────────

interface LineForm {
  key: number;
  productId: string;
  qty: string;
  unitCost: string; // displayed as dollars
  taxPercent: string;
  unitId?: string;  // selected purchase unit (undefined = base unit)
  expiryDate: string; // YYYY-MM-DD or ''
  noConversionWarning?: boolean; // true when selected unit has no conversion rule
}

// ─── Payment Status badge ─────────────────────────────────────────────────────

const PAY_STATUS_COLORS: Record<PurchasePaymentStatus, string> = {
  UNPAID:  'bg-red-100 text-red-700',
  PARTIAL: 'bg-amber-100 text-amber-700',
  PAID:    'bg-green-100 text-green-700',
};

// ─── Supplier Payment Section ─────────────────────────────────────────────────

function SupplierPaymentSection({
  poId,
  supplierId,
  totalCents,
  paidCents,
  returnedCents = 0,
  businessName = 'My Business',
}: {
  poId: string;
  supplierId: string;
  totalCents: number;
  paidCents: number;
  returnedCents?: number;
  businessName?: string;
}) {
  const queryClient = useQueryClient();
  // Option B — subtract confirmed return credit so the displayed outstanding
  // matches the backend's effectiveOutstanding (never mutates totalCents).
  // Clamp at 0: overpaid-after-return shows Rs.0.00, never a negative figure.
  const effectiveTotalCents = Math.max(0, totalCents - returnedCents);
  const outstanding = Math.max(0, totalCents - paidCents - returnedCents);
  // Credit the supplier owes us when returns left the PO overpaid.
  const creditOwed = Math.max(0, paidCents - effectiveTotalCents);

  // ── form state ──
  const [show,       setShow]       = useState(false);
  const [amount,     setAmount]     = useState((outstanding / 100).toFixed(2));
  const [method,     setMethod]     = useState<SupplierPaymentMethod>('CASH');
  const [refNo,      setRefNo]      = useState('');
  const [bankName,   setBankName]   = useState('');
  const [payDate,    setPayDate]    = useState(new Date().toISOString().slice(0, 10));
  const [notes,      setNotes]      = useState('');
  const [err,           setErr]          = useState('');
  const [expandedPayId, setExpandedPayId] = useState<string | null>(null);

  // ── receive-credit modal state ──
  const [showCredit,     setShowCredit]     = useState(false);
  const [creditAmount,   setCreditAmount]   = useState('');
  const [creditMethod,   setCreditMethod]   = useState<SupplierPaymentMethod>('CASH');
  const [creditRef,      setCreditRef]      = useState('');
  const [creditDate,     setCreditDate]     = useState(new Date().toISOString().slice(0, 10));
  const [creditNotes,    setCreditNotes]    = useState('');
  const [creditError,    setCreditError]    = useState('');

  const showRef = method === 'CHEQUE' || method === 'BANK_TRANSFER';

  // ── query ──
  const { data: history = [] } = useQuery<SupplierPayment[]>({
    queryKey: ['spay', poId],
    queryFn:  () => supplierPaymentsApi.listByPurchase(poId),
    staleTime: 0,
  });

  // ── create mutation ──
  const createMut = useMutation({
    mutationFn: () => supplierPaymentsApi.create({
      purchaseId:    poId,
      amountCents:   Math.round(parseFloat(amount) * 100),
      paymentMethod: method,
      referenceNo:   refNo   || undefined,
      bankName:      bankName || undefined,
      paymentDate:   payDate,
      notes:         notes   || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      queryClient.invalidateQueries({ queryKey: ['purchase', poId] });
      queryClient.invalidateQueries({ queryKey: ['spay', poId] });
      setShow(false); setErr('');
      setAmount((outstanding / 100).toFixed(2));
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setErr(msg ?? 'Failed to record payment');
    },
  });

  // ── void mutation ──
  const voidMut = useMutation({
    mutationFn: (id: string) => supplierPaymentsApi.void(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      queryClient.invalidateQueries({ queryKey: ['purchase', poId] });
      queryClient.invalidateQueries({ queryKey: ['spay', poId] });
    },
  });

  // ── receive-credit mutation ──
  const creditMut = useMutation({
    mutationFn: () => supplierPaymentsApi.receiveCredit({
      purchaseId:  poId,
      supplierId,
      amountCents: Math.round(parseFloat(creditAmount) * 100),
      method:      creditMethod,
      reference:   creditRef || undefined,
      date:        creditDate,
      notes:       creditNotes || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      queryClient.invalidateQueries({ queryKey: ['purchase', poId] });
      queryClient.invalidateQueries({ queryKey: ['spay', poId] });
      setShowCredit(false); setCreditError(''); setCreditAmount('');
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setCreditError(msg ?? 'Failed to record credit');
    },
  });

  const handleReceiveCredit = () => {
    const amountCents = Math.round(parseFloat(creditAmount) * 100);
    if (!amountCents || amountCents <= 0) { setCreditError('Enter a valid amount'); return; }
    if (amountCents > creditOwed)         { setCreditError(`Amount exceeds available credit of ${formatCents(creditOwed)}`); return; }
    setCreditError('');
    creditMut.mutate();
  };

  const openCreditModal = () => {
    setCreditAmount((creditOwed / 100).toFixed(2));
    setCreditMethod('CASH');
    setCreditRef('');
    setCreditDate(new Date().toISOString().slice(0, 10));
    setCreditNotes('');
    setCreditError('');
    setShowCredit(true);
  };

  // ── print voucher ──
  const handlePrintVoucher = async (paymentId: string) => {
    const voucher = await supplierPaymentsApi.getVoucherData(paymentId);
    printVoucher(generateVoucherHtml(voucher, businessName));
  };

  return (
    <div className="px-6 py-4 border-t border-slate-100">
      {/* Header row */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Supplier Payments</p>
        {outstanding > 0 && (
          <button
            onClick={() => { setShow(s => !s); setErr(''); }}
            className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold"
          >
            {show ? 'Cancel' : '+ Record Payment'}
          </button>
        )}
      </div>

      {/* Payment history table */}
      {history.length > 0 && (
        <div className="mb-3 overflow-x-auto">
          <table className="w-full text-xs">
            <thead>
              <tr className="text-slate-400 border-b border-slate-100">
                <th className="pb-1 text-left font-medium">Voucher #</th>
                <th className="pb-1 text-left font-medium">Date</th>
                <th className="pb-1 text-left font-medium">Method</th>
                <th className="pb-1 text-left font-medium">Ref</th>
                <th className="pb-1 text-right font-medium">Amount</th>
                <th className="pb-1 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {history.map((p) => (
                <>
                  <tr key={p.id} className="border-b border-slate-50">
                    <td className="py-1.5 font-mono text-indigo-700">{p.paymentNumber}</td>
                    <td className="py-1.5 text-slate-500">{new Date(p.paymentDate).toLocaleDateString()}</td>
                    <td className="py-1.5">{SPAY_METHOD_LABELS[p.paymentMethod] ?? p.paymentMethod}</td>
                    <td className="py-1.5 text-slate-400">{p.referenceNo ?? '—'}</td>
                    <td className="py-1.5 text-right font-semibold">{formatCents(p.amountCents)}</td>
                    <td className="py-1.5 text-right">
                      <div className="flex items-center justify-end gap-2">
                        <button
                          onClick={() => setExpandedPayId(expandedPayId === p.id ? null : p.id)}
                          className={`p-1 rounded hover:bg-slate-100 transition ${expandedPayId === p.id ? 'text-indigo-600' : 'text-slate-400 hover:text-slate-600'}`}
                          title="Attachments"
                        >
                          <Paperclip size={11} />
                        </button>
                        <button
                          onClick={() => handlePrintVoucher(p.id)}
                          className="text-indigo-600 hover:text-indigo-800 text-[10px] font-medium"
                          title="Print voucher"
                        >
                          Voucher
                        </button>
                        <button
                          onClick={() => {
                            if (confirm(`Void payment ${p.paymentNumber}? This cannot be undone.`)) {
                              voidMut.mutate(p.id);
                            }
                          }}
                          className="text-red-500 hover:text-red-700 text-[10px] font-medium"
                          title="Void this payment"
                        >
                          Void
                        </button>
                      </div>
                    </td>
                  </tr>
                  {expandedPayId === p.id && (
                    <tr key={`${p.id}-att`}>
                      <td colSpan={6} className="px-2 pb-3">
                        <AttachmentPanel refType="SupplierPayment" refId={p.id} />
                      </td>
                    </tr>
                  )}
                </>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Summary bar */}
      <div className="text-xs text-slate-600 flex gap-4 mb-2">
        <span>Total: <strong>{formatCents(totalCents)}</strong></span>
        <span>Paid: <strong className="text-green-600">{formatCents(paidCents)}</strong></span>
        <span>Outstanding: <strong className={outstanding > 0 ? 'text-red-600' : 'text-green-600'}>{formatCents(outstanding)}</strong></span>
      </div>

      {/* Supplier credit available (PO overpaid after returns) */}
      {creditOwed > 0 && (
        <div className="flex items-center justify-between text-sm mt-1 mb-2">
          <span className="text-green-600 font-medium">Supplier Credit Available:</span>
          <div className="flex items-center gap-2">
            <span className="text-green-600 font-medium">{formatCents(creditOwed)}</span>
            <button
              onClick={openCreditModal}
              className="text-xs text-indigo-600 hover:text-indigo-700 font-semibold border border-indigo-200 rounded-lg px-2 py-1"
            >
              Receive Credit
            </button>
          </div>
        </div>
      )}

      {/* Receive credit modal */}
      {showCredit && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onClick={() => setShowCredit(false)}>
          <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
              <h3 className="text-base font-semibold text-slate-800">Receive Supplier Credit</h3>
              <button onClick={() => setShowCredit(false)} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
            </div>
            <div className="p-5 space-y-3">
              <div className="text-sm text-green-700 bg-green-50 border border-green-100 rounded-lg px-3 py-2">
                The supplier owes you <strong>{formatCents(creditOwed)}</strong> from returned goods.
              </div>
              {creditError && <p className="text-xs text-red-600">{creditError}</p>}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Amount to Receive (Rs.)</label>
                  <input
                    type="number" min="0.01" step="0.01" max={(creditOwed / 100).toFixed(2)} value={creditAmount}
                    onChange={e => setCreditAmount(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Date</label>
                  <input
                    type="date" value={creditDate}
                    onChange={e => setCreditDate(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Method</label>
                  <select
                    value={creditMethod}
                    onChange={e => setCreditMethod(e.target.value as SupplierPaymentMethod)}
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  >
                    <option value="CASH">Cash</option>
                    <option value="BANK_TRANSFER">Bank Transfer</option>
                    <option value="CHEQUE">Cheque</option>
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Reference No (optional)</label>
                  <input
                    type="text" value={creditRef}
                    onChange={e => setCreditRef(e.target.value)}
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </div>
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Notes (optional)</label>
                <input
                  type="text" value={creditNotes}
                  onChange={e => setCreditNotes(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
                />
              </div>
            </div>
            <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-100">
              <button onClick={() => setShowCredit(false)} className="text-sm px-3 py-1.5 rounded-lg border border-slate-200 text-slate-600 hover:bg-slate-50">Cancel</button>
              <button
                onClick={handleReceiveCredit}
                disabled={creditMut.isPending}
                className="text-sm px-3 py-1.5 rounded-lg bg-indigo-600 text-white font-semibold hover:bg-indigo-700 disabled:opacity-50"
              >
                {creditMut.isPending ? 'Saving…' : 'Confirm'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Record payment form */}
      {show && (
        <div className="mt-3 p-4 bg-indigo-50 rounded-xl space-y-3 border border-indigo-100">
          {err && <p className="text-xs text-red-600">{err}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Amount (Rs.)</label>
              <input
                type="number" min="0.01" step="0.01" value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Payment Date</label>
              <input
                type="date" value={payDate}
                onChange={e => setPayDate(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Method</label>
              <select
                value={method}
                onChange={e => setMethod(e.target.value as SupplierPaymentMethod)}
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
              >
                <option value="CASH">Cash</option>
                <option value="CHEQUE">Cheque</option>
                <option value="BANK_TRANSFER">Bank Transfer</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
              <input
                type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="Optional"
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
            {showRef && (
              <>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    {method === 'CHEQUE' ? 'Cheque No.' : 'Reference No.'}
                  </label>
                  <input
                    type="text" value={refNo} onChange={e => setRefNo(e.target.value)} placeholder="Optional"
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Bank Name</label>
                  <input
                    type="text" value={bankName} onChange={e => setBankName(e.target.value)} placeholder="Optional"
                    className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-indigo-400"
                  />
                </div>
              </>
            )}
          </div>
          <button
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending}
            className="w-full py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 transition"
          >
            {createMut.isPending ? 'Saving…' : 'Record Payment'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Receive Stock Section ────────────────────────────────────────────────────

function ReceiveStockSection({ po }: { po: Purchase }) {
  const queryClient  = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [notes, setNotes]       = useState('');
  const [err,   setErr]         = useState('');

  // Per-line receive state: { purchaseLineId → { qty, batchNumber, expiryDate } }
  const [lineInputs, setLineInputs] = useState<
    Record<string, { qty: string; batchNumber: string; expiryDate: string }>
  >({});

  const lines    = po.lines ?? [];
  const receipts = po.receipts ?? [];

  // Initialise lineInputs from remaining qty
  const initForm = () => {
    const init: typeof lineInputs = {};
    for (const l of lines) {
      const remaining = Math.max(0, Number(l.qty) - Number(l.receivedQty ?? 0));
      init[l.id] = { qty: remaining > 0 ? String(remaining) : '0', batchNumber: '', expiryDate: '' };
    }
    setLineInputs(init);
    setNotes('');
    setErr('');
    setShowForm(true);
  };

  const updateInput = (lineId: string, field: 'qty' | 'batchNumber' | 'expiryDate', val: string) => {
    setLineInputs((prev) => ({ ...prev, [lineId]: { ...prev[lineId], [field]: val } }));
  };

  const createMut = useMutation({
    mutationFn: () => {
      const receiptLines: CreateReceiptLineInput[] = [];
      for (const l of lines) {
        const input = lineInputs[l.id];
        const qty   = parseFloat(input?.qty ?? '0');
        if (qty > 0) {
          receiptLines.push({
            purchaseLineId: l.id,
            qty,
            batchNumber:  input.batchNumber || undefined,
            expiryDate:   input.expiryDate  || undefined,
          });
        }
      }
      if (receiptLines.length === 0) throw new Error('Enter a qty > 0 for at least one line');
      return purchasesApi.createReceipt(po.id, { lines: receiptLines, notes: notes || undefined });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['purchases'] });
      queryClient.invalidateQueries({ queryKey: ['purchase', po.id] });
      setShowForm(false);
      setErr('');
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } }; message?: string })
        ?.response?.data?.message ?? (e as { message?: string })?.message ?? 'Failed to record delivery';
      setErr(msg);
    },
  });

  const isDelivered = po.deliveryStatus === 'DELIVERED';

  return (
    <div className="px-6 py-4 border-t border-slate-100">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
          <Truck className="w-3.5 h-3.5" />
          Delivery / GRN Receipts
          {po.deliveryStatus === 'PARTIAL' ? (
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ml-1 ${DELIVERY_COLORS['PARTIAL']}`}>
              {lines.filter(l => Number(l.receivedQty ?? 0) >= Number(l.qty)).length}/{lines.length} Lines Received
            </span>
          ) : (
            <span className={`px-2 py-0.5 rounded-full text-[10px] font-medium ml-1 ${DELIVERY_COLORS[po.deliveryStatus ?? 'PENDING']}`}>
              {DELIVERY_LABELS[po.deliveryStatus ?? 'PENDING']}
            </span>
          )}
        </p>
        {!isDelivered && !showForm && po.deliveryStatus !== 'PARTIAL' && (
          <button
            onClick={initForm}
            className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-semibold"
          >
            <PackageCheck className="w-3.5 h-3.5" /> Record Delivery
          </button>
        )}
        {!isDelivered && !showForm && po.deliveryStatus === 'PARTIAL' && (
          <button
            onClick={initForm}
            className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-700 font-semibold"
          >
            <Truck className="w-3.5 h-3.5" /> Receive Remaining
          </button>
        )}
        {showForm && (
          <button onClick={() => setShowForm(false)} className="text-xs text-slate-400 hover:text-slate-600">Cancel</button>
        )}
      </div>

      {/* GRN history */}
      {receipts.length > 0 && (
        <div className="mb-3 space-y-2">
          {receipts.map((r: PurchaseReceipt) => (
            <div key={r.id} className="border border-slate-100 rounded-lg overflow-hidden">
              <div className="flex items-center justify-between px-3 py-1.5 bg-slate-50">
                <span className="text-xs font-mono font-semibold text-slate-600">{r.receiptNumber}</span>
                <span className="text-xs text-slate-400">
                  {new Date(r.createdAt).toLocaleDateString()} · {r.receivedBy.fullName}
                </span>
              </div>
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-400 border-b border-slate-100">
                    <th className="px-3 py-1 text-left font-medium">Product</th>
                    <th className="px-3 py-1 text-right font-medium">Received</th>
                    {r.lines.some((l) => l.batchNumber || l.expiryDate) && (
                      <th className="px-3 py-1 text-left font-medium">Batch / Expiry</th>
                    )}
                  </tr>
                </thead>
                <tbody>
                  {r.lines.map((rl) => (
                    <tr key={rl.id} className="border-b border-slate-50">
                      <td className="px-3 py-1.5 text-slate-700">{rl.product.name}</td>
                      <td className="px-3 py-1.5 text-right font-semibold text-slate-700">{Number(rl.qty)}</td>
                      {r.lines.some((l) => l.batchNumber || l.expiryDate) && (
                        <td className="px-3 py-1.5 text-slate-400">
                          {rl.batchNumber && <span className="mr-2 font-mono">{rl.batchNumber}</span>}
                          {rl.expiryDate && <span>{new Date(rl.expiryDate).toLocaleDateString()}</span>}
                        </td>
                      )}
                    </tr>
                  ))}
                </tbody>
              </table>
              {r.notes && <p className="px-3 py-1.5 text-xs text-slate-400 italic">{r.notes}</p>}
            </div>
          ))}
        </div>
      )}

      {receipts.length === 0 && !showForm && (
        <p className="text-xs text-slate-400 mb-3">No deliveries recorded yet.</p>
      )}

      {/* Record delivery form */}
      {showForm && (
        <div className="border border-indigo-100 rounded-xl bg-indigo-50/40 p-4 space-y-3">
          {err && <p className="text-xs text-red-600 font-medium">{err}</p>}

          {/* Per-line qty inputs */}
          {(() => {
            // At least one active line has isBatchTracked — show batch/expiry columns
            const needsBatchCol = lines.some((l) => l.product.isBatchTracked);
            return (
              <div className="overflow-x-auto">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="text-slate-500 border-b border-slate-200">
                      <th className="pb-1.5 text-left font-medium">Product</th>
                      <th className="pb-1.5 text-right font-medium">Ordered</th>
                      <th className="pb-1.5 text-right font-medium">Received</th>
                      <th className="pb-1.5 text-right font-medium">Remaining</th>
                      <th className="pb-1.5 text-right font-medium w-20">Qty Now</th>
                      {needsBatchCol && <th className="pb-1.5 text-left font-medium pl-2">Batch #</th>}
                      {needsBatchCol && <th className="pb-1.5 text-left font-medium pl-2">Expiry Date</th>}
                    </tr>
                  </thead>
                  <tbody>
                    {lines.map((l) => {
                      const received      = Number(l.receivedQty ?? 0);
                      const remaining     = Math.max(0, Number(l.qty) - received);
                      const input         = lineInputs[l.id] ?? { qty: '0', batchNumber: '', expiryDate: '' };
                      const isBatch       = l.product.isBatchTracked;
                      const qtyNow        = parseFloat(input.qty) || 0;
                      const missingBatch  = isBatch && qtyNow > 0 && !input.batchNumber;
                      return (
                        <tr key={l.id} className={`border-b border-slate-100 ${remaining === 0 ? 'opacity-40' : ''}`}>
                          <td className="py-1.5 text-slate-700 font-medium">
                            <div>
                              {l.product.name}
                              <span className="ml-1 text-slate-400 font-normal">({l.product.sku})</span>
                              {isBatch && (
                                <span className="ml-1.5 px-1.5 py-0.5 rounded text-[9px] bg-indigo-50 text-indigo-600 font-semibold">
                                  BATCH
                                </span>
                              )}
                            </div>
                            {missingBatch && (
                              <p className="text-[10px] text-amber-600 mt-0.5 flex items-center gap-1">
                                ⚠ No batch number entered
                              </p>
                            )}
                          </td>
                          <td className="py-1.5 text-right text-slate-500">{Number(l.qty)}</td>
                          <td className="py-1.5 text-right text-slate-500">{received}</td>
                          <td className={`py-1.5 text-right font-semibold ${remaining > 0 ? 'text-amber-700' : 'text-green-600'}`}>
                            {remaining}
                          </td>
                          <td className="py-1.5 pl-2">
                            <input
                              type="number"
                              min="0"
                              max={remaining}
                              step="0.001"
                              value={input.qty}
                              disabled={remaining === 0}
                              onChange={(e) => updateInput(l.id, 'qty', e.target.value)}
                              className="w-20 border border-slate-200 rounded px-2 py-1 text-right text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:bg-slate-100"
                            />
                          </td>
                          {needsBatchCol && (
                            <td className="py-1.5 pl-2">
                              {isBatch ? (
                                <input
                                  type="text"
                                  value={input.batchNumber}
                                  onChange={(e) => updateInput(l.id, 'batchNumber', e.target.value)}
                                  placeholder="e.g. BT-001"
                                  disabled={remaining === 0}
                                  className={`w-28 border rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 disabled:bg-slate-100 ${
                                    missingBatch
                                      ? 'border-amber-400 bg-amber-50 focus:ring-amber-400'
                                      : 'border-slate-200 focus:ring-indigo-400'
                                  }`}
                                />
                              ) : (
                                <span className="text-slate-300 text-xs pl-1">—</span>
                              )}
                            </td>
                          )}
                          {needsBatchCol && (
                            <td className="py-1.5 pl-2">
                              {isBatch ? (
                                <input
                                  type="date"
                                  value={input.expiryDate}
                                  onChange={(e) => updateInput(l.id, 'expiryDate', e.target.value)}
                                  disabled={remaining === 0}
                                  className="w-32 border border-slate-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400 disabled:bg-slate-100"
                                />
                              ) : (
                                <span className="text-slate-300 text-xs pl-1">—</span>
                              )}
                            </td>
                          )}
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            );
          })()}

          {/* Notes */}
          <div className="flex flex-wrap items-center gap-4">
            <div className="flex-1 min-w-48">
              <input
                type="text"
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                placeholder="Delivery notes (optional)"
                className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-1 focus:ring-indigo-400"
              />
            </div>
          </div>

          <button
            onClick={() => createMut.mutate()}
            disabled={createMut.isPending}
            className="w-full py-2 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-60 transition"
          >
            {createMut.isPending ? 'Saving GRN…' : 'Save GRN Receipt'}
          </button>
        </div>
      )}
    </div>
  );
}

// ─── Purchase Return Section (inside PO detail modal) ─────────────────────────

function PurchaseReturnSection({ poId }: { poId: string }) {
  const qc = useQueryClient();
  const [showNew, setShowNew] = useState(false);
  const [newLineQtys, setNewLineQtys] = useState<Record<string, string>>({});
  const [newReason, setNewReason] = useState('');
  const [formErr, setFormErr] = useState('');
  const [printingReturnId, setPrintingReturnId] = useState<string | null>(null);

  const { data: returns = [], isLoading } = useQuery<PurchaseReturn[]>({
    queryKey: ['purchase-returns', poId],
    queryFn:  () => purchaseReturnsApi.list(poId),
  });

  const { data: po } = useQuery({
    queryKey: ['purchase', poId],
    queryFn:  () => purchasesApi.getPurchase(poId),
    enabled:  showNew,
  });

  const createMut = useMutation({
    mutationFn: () => {
      const lines = (po?.lines ?? [])
        .filter((l: any) => parseFloat(newLineQtys[l.id] ?? '0') > 0)
        .map((l: any) => ({ purchaseLineId: l.id, qty: parseFloat(newLineQtys[l.id]) }));
      if (!lines.length) throw new Error('Enter qty for at least one line');
      return purchaseReturnsApi.create({ purchaseId: poId, reason: newReason || undefined, lines });
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['purchase-returns', poId] });
      qc.invalidateQueries({ queryKey: ['purchase-returns'] });
      setShowNew(false); setNewLineQtys({}); setNewReason(''); setFormErr('');
    },
    onError: (err: any) => setFormErr(err?.response?.data?.message ?? err.message ?? 'Failed'),
  });

  const confirmMut = useMutation({
    mutationFn: (id: string) => purchaseReturnsApi.confirm(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['purchase-returns', poId] }); qc.invalidateQueries({ queryKey: ['purchase-returns'] }); },
  });

  return (
    <div className="px-6 border-t border-slate-100 pt-4 pb-2 mt-2">
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <CornerUpLeft size={13} className="text-orange-500" />
          <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Returns to Supplier</h4>
          {returns.length > 0 && (
            <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">{returns.length}</span>
          )}
        </div>
        {!showNew && (
          <button onClick={() => setShowNew(true)}
            className="flex items-center gap-1 text-xs font-medium text-orange-600 hover:text-orange-800 px-2.5 py-1 bg-orange-50 hover:bg-orange-100 rounded-lg transition">
            <Plus size={12} /> New Return
          </button>
        )}
      </div>

      {showNew && (
        <div className="bg-slate-50 rounded-xl p-4 mb-3 space-y-3 border border-slate-200">
          <p className="text-xs font-semibold text-slate-600">New Return Draft</p>
          {formErr && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formErr}</p>}
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Reason (optional)</label>
            <input type="text" value={newReason} onChange={(e) => setNewReason(e.target.value)}
              placeholder="e.g. Damaged, wrong items"
              className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
          </div>
          {(po?.lines ?? []).length > 0 && (
            <table className="w-full text-xs">
              <thead><tr className="text-slate-400">
                <th className="pb-1 text-left font-medium">Product</th>
                <th className="pb-1 text-right font-medium">Received</th>
                <th className="pb-1 text-right font-medium">Returned</th>
                <th className="pb-1 text-right font-medium">Return Qty</th>
              </tr></thead>
              <tbody className="divide-y divide-slate-100">
                {(po?.lines ?? []).map((l: any) => {
                  const max = Number(l.receivedQty ?? 0) - Number(l.returnedQty ?? 0);
                  return (
                    <tr key={l.id} className={max <= 0 ? 'opacity-40' : ''}>
                      <td className="py-1.5 font-medium text-slate-700">{l.product?.name}</td>
                      <td className="py-1.5 text-right text-slate-500">{Number(l.receivedQty ?? 0)}</td>
                      <td className="py-1.5 text-right text-slate-500">{Number(l.returnedQty ?? 0)}</td>
                      <td className="py-1.5 text-right">
                        <input type="number" min="0" max={max} step="1"
                          disabled={max <= 0}
                          value={newLineQtys[l.id] ?? ''}
                          onChange={(e) => setNewLineQtys((p) => ({ ...p, [l.id]: e.target.value }))}
                          placeholder="0"
                          className="w-16 text-right border border-slate-300 rounded px-2 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-orange-400 disabled:bg-slate-100" />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
          <div className="flex gap-2">
            <button onClick={() => { setShowNew(false); setFormErr(''); }}
              className="flex-1 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 hover:bg-slate-100">Cancel</button>
            <button onClick={() => createMut.mutate()} disabled={createMut.isPending}
              className="flex-1 py-1.5 bg-orange-600 text-white rounded-lg text-xs font-semibold hover:bg-orange-700 disabled:opacity-60">
              {createMut.isPending ? 'Creating…' : 'Create Draft'}
            </button>
          </div>
        </div>
      )}

      {isLoading ? (
        <p className="text-xs text-slate-400 py-2">Loading returns…</p>
      ) : returns.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-3">No returns for this PO</p>
      ) : (
        <div className="space-y-2 mb-2">
          {returns.map((r) => (
            <div key={r.id} className="flex items-center gap-2.5 p-2.5 bg-slate-50 rounded-xl hover:bg-slate-100 transition">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2">
                  <span className="text-xs font-semibold text-orange-700 font-mono">{r.number}</span>
                  <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${RETURN_STATUS_COLORS[r.status as ReturnStatus]}`}>
                    {RETURN_STATUS_LABELS[r.status as ReturnStatus]}
                  </span>
                </div>
                <p className="text-[10px] text-slate-400 mt-0.5">
                  {new Date(r.createdAt).toLocaleDateString()} · {r.createdBy.fullName}
                  {r.reason ? ` · ${r.reason}` : ''}
                </p>
              </div>
              <span className="text-sm font-bold text-orange-700 shrink-0">{fmtReturnCents(r.totalCents)}</span>
              {r.status === 'CONFIRMED' && (
                <button
                  onClick={async () => {
                    try {
                      setPrintingReturnId(r.id);
                      // List rows omit line items; fetch the full return (with lines) before printing.
                      const fullReturn = await purchaseReturnsApi.get(r.id);
                      printDebitNote(fullReturn);
                    } catch {
                      window.alert('Failed to load return details for printing');
                    } finally {
                      setPrintingReturnId(null);
                    }
                  }}
                  disabled={printingReturnId === r.id}
                  className="p-1.5 text-slate-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg transition shrink-0 disabled:opacity-60">
                  {printingReturnId === r.id
                    ? <Loader2 size={12} className="animate-spin" />
                    : <Printer size={12} />}
                </button>
              )}
              {r.status === 'DRAFT' && (
                <button onClick={() => { if (window.confirm('Confirm this return? Stock will be deducted.')) confirmMut.mutate(r.id); }}
                  disabled={confirmMut.isPending}
                  className="px-2 py-1 text-[10px] font-medium bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-60 shrink-0">
                  Confirm
                </button>
              )}
            </div>
          ))}
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
        <div className="bg-white rounded-xl p-8 w-full max-w-3xl max-h-[90vh] overflow-y-auto">
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
          <div className="flex items-center gap-2">
            <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[po.status]}`}>
              {STATUS_LABELS[po.status]}
            </span>
            {po.status === 'CONFIRMED' && po.paymentStatus && (
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${PAY_STATUS_COLORS[po.paymentStatus]}`}>
                {po.paymentStatus}
              </span>
            )}
            {po.status === 'CONFIRMED' && po.deliveryStatus && (
              <span className={`px-2.5 py-0.5 rounded-full text-xs font-medium ${DELIVERY_COLORS[po.deliveryStatus as DeliveryStatus]}`}>
                {DELIVERY_LABELS[po.deliveryStatus as DeliveryStatus]}
              </span>
            )}
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
                    {Number(line.qty)} {line.unit?.shortCode ?? line.product.unit?.shortCode}
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

        {/* Delivery / GRN section — shown on CONFIRMED POs */}
        {po.status === 'CONFIRMED' && (
          <ReceiveStockSection po={po} />
        )}

        {/* Supplier Payments section — shown on CONFIRMED POs */}
        {po.status === 'CONFIRMED' && (
          <SupplierPaymentSection poId={id} supplierId={po.supplier.id} totalCents={po.totalCents} paidCents={(po as any).paidCents ?? 0} returnedCents={(po.purchaseReturns ?? []).reduce((s, r) => s + r.totalCents, 0)} />
        )}

        {/* Purchase Returns section — shown on CONFIRMED POs */}
        {po.status === 'CONFIRMED' && (
          <PurchaseReturnSection poId={id} />
        )}

        {/* Purchase attachments */}
        <div className="px-6">
          <AttachmentPanel refType="Purchase" refId={po.id} />
        </div>

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
            ref={searchRef}
            autoFocus
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
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm min-w-[900px]">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-32">PO #</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide min-w-[120px]">Supplier</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-28">Date</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-28">Total</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-28">Paid</th>
              <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-32">Outstanding</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-28">Status</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-28">Payment</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-28">Delivery</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide w-20 sticky right-0 bg-slate-50 border-l border-slate-200 shadow-[-2px_0_4px_rgba(0,0,0,0.05)]">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={9} className="text-center py-12 text-slate-400">Loading…</td>
              </tr>
            )}
            {!isLoading && data?.data.length === 0 && (
              <tr>
                <td colSpan={9} className="text-center py-12 text-slate-400">No purchase orders found</td>
              </tr>
            )}
            {data?.data.map((po) => (
              <tr key={po.id} className="border-b border-slate-100 hover:bg-slate-50">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <span className="font-mono font-medium text-brand-700">{po.number}</span>
                    {po.sourceType === 'AUTO_PO' && (
                      <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-purple-100 text-purple-700">
                        Auto PO
                      </span>
                    )}
                  </div>
                </td>
                <td className="px-4 py-3 text-slate-700">{po.supplier.name}</td>
                <td className="px-4 py-3 text-slate-500">
                  {new Date(po.date).toLocaleDateString()}
                </td>
                <td className="px-4 py-3 text-right font-medium text-slate-800">
                  {formatCents(po.totalCents)}
                </td>
                <td className="px-4 py-3 text-right text-green-700">
                  {po.status === 'CONFIRMED' ? formatCents(po.paidCents ?? 0) : '—'}
                </td>
                <td className="px-4 py-3 text-right text-red-600">
                  {po.status === 'CONFIRMED'
                    ? (() => {
                        const ret = (po.purchaseReturns ?? []).reduce((s, r) => s + r.totalCents, 0);
                        const paid = po.paidCents ?? 0;
                        const effTotal = Math.max(0, po.totalCents - ret);
                        const out = Math.max(0, po.totalCents - paid - ret);
                        const credit = Math.max(0, paid - effTotal);
                        return (
                          <span className="inline-flex items-center justify-end gap-1.5">
                            <span>{formatCents(out)}</span>
                            {out === 0 && credit > 0 && (
                              <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700">
                                Credit
                              </span>
                            )}
                          </span>
                        );
                      })()
                    : '—'}
                </td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[po.status]}`}>
                    {STATUS_LABELS[po.status]}
                  </span>
                </td>
                <td className="px-4 py-3 text-center">
                  {po.status === 'CONFIRMED' && po.paymentStatus && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${PAY_STATUS_COLORS[po.paymentStatus]}`}>
                      {po.paymentStatus}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 text-center">
                  {po.status === 'CONFIRMED' && po.deliveryStatus && (
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${DELIVERY_COLORS[po.deliveryStatus as DeliveryStatus]}`}>
                      {DELIVERY_LABELS[po.deliveryStatus as DeliveryStatus]}
                    </span>
                  )}
                </td>
                <td className="px-4 py-3 sticky right-0 bg-white border-l border-slate-200 shadow-[-2px_0_4px_rgba(0,0,0,0.05)]">
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

  // ── Quick-add supplier modal state ──────────────────────────────────────────
  const [showAddSupplierModal, setShowAddSupplierModal] = useState(false);
  const [newSupplierName,  setNewSupplierName]  = useState('');
  const [newSupplierPhone, setNewSupplierPhone] = useState('');
  const [addSupplierError, setAddSupplierError] = useState('');
  const [addingSupplier,   setAddingSupplier]   = useState(false);

  // ── Quick-add product modal state ───────────────────────────────────────────
  const [showAddProductModal, setShowAddProductModal] = useState(false);
  const [newProduct, setNewProduct] = useState({
    name: '', sku: '', unitId: '', costCents: '', priceCents: '',
    categoryId: '', brandId: '',
  });
  const [addProductError, setAddProductError] = useState('');
  const [addingProduct,   setAddingProduct]   = useState(false);

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

  // Auto-select the default (Main) warehouse once the list loads, unless one is
  // already chosen (e.g. when editing an existing PO). Runs only on warehouses
  // change so user selections are never overridden.
  useEffect(() => {
    if (!warehouses?.length) return;
    if (warehouseId) return;

    const defaultWh =
      warehouses.find((w) => w.isDefault) ??
      warehouses.find(
        (w) => w.code === 'MAIN' || w.name?.toLowerCase().includes('main'),
      ) ??
      warehouses[0];

    if (defaultWh?.id) {
      setWarehouseId(defaultWh.id);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [warehouses]);

  const { data: products = [] } = useQuery({
    queryKey: ['purchase-products'],
    queryFn: purchasesApi.listProducts,
  });

  const productMap = useMemo<Record<string, PurchaseProduct>>(
    () => Object.fromEntries(products.map((p) => [p.id, p])),
    [products],
  );

  // Units list — only fetched while the quick-add product modal is open
  const { data: unitsList } = useQuery<Array<{ id: string; name: string; shortCode: string }>>({
    queryKey: ['units-for-quick-add'],
    queryFn: () => api.get('/units').then((r) => r.data.data ?? r.data),
    enabled: showAddProductModal,
    staleTime: 5 * 60 * 1000,
  });

  // Categories + brands for the quick-add product modal (both optional fields)
  const { data: productMeta } = useQuery<{
    categories: Array<{ id: string; name: string }>;
    brands:     Array<{ id: string; name: string }>;
  }>({
    queryKey: ['product-meta-for-quick-add'],
    queryFn: () => api.get('/products/meta').then((r) => r.data),
    enabled: showAddProductModal,
    staleTime: 5 * 60 * 1000,
  });

  // ── Quick-add: create a supplier inline and auto-select it ──────────────────
  const handleAddSupplier = async () => {
    if (!newSupplierName.trim()) {
      setAddSupplierError('Name is required');
      return;
    }
    try {
      setAddingSupplier(true);
      setAddSupplierError('');
      const response = await api.post('/suppliers', {
        name:  newSupplierName.trim(),
        phone: newSupplierPhone.trim() || undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ['purchase-suppliers'] });
      // POST /suppliers returns the created supplier row directly → auto-select it
      if (response.data?.id) setSupplierId(response.data.id);
      setShowAddSupplierModal(false);
      setNewSupplierName('');
      setNewSupplierPhone('');
    } catch (err: any) {
      setAddSupplierError(err?.response?.data?.message || 'Failed to add supplier');
    } finally {
      setAddingSupplier(false);
    }
  };

  // ── Quick-add: create a product inline ──────────────────────────────────────
  const handleAddProduct = async () => {
    if (!newProduct.name.trim()) {
      setAddProductError('Name is required');
      return;
    }
    if (!newProduct.unitId) {
      setAddProductError('Unit is required');
      return;
    }
    try {
      setAddingProduct(true);
      setAddProductError('');
      await api.post('/products', {
        name:   newProduct.name.trim(),
        sku:    newProduct.sku.trim() || undefined,
        unitId: newProduct.unitId,
        categoryId: newProduct.categoryId || undefined,
        brandId:    newProduct.brandId    || undefined,
        costCents:  newProduct.costCents  ? Math.round(parseFloat(newProduct.costCents)  * 100) : 0,
        priceCents: newProduct.priceCents ? Math.round(parseFloat(newProduct.priceCents) * 100) : 0,
      });
      await queryClient.invalidateQueries({ queryKey: ['purchase-products'] });
      setShowAddProductModal(false);
      setNewProduct({ name: '', sku: '', unitId: '', costCents: '', priceCents: '', categoryId: '', brandId: '' });
    } catch (err: any) {
      setAddProductError(err?.response?.data?.message || 'Failed to add product');
    } finally {
      setAddingProduct(false);
    }
  };

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
              // Reset unit to the product's base unit so no stale unit from a
              // previously-selected product remains, and price to its base cost.
              unitId: product ? (product.baseUnitId ?? product.unitId ?? undefined) : undefined,
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
            <SearchableSelect
              value={supplierId}
              onChange={setSupplierId}
              options={suppliers.map((s) => ({ value: s.id, label: s.name }))}
              placeholder="Select supplier…"
              onAddNew={() => { setAddSupplierError(''); setShowAddSupplierModal(true); }}
              addNewLabel="Add New Supplier"
            />
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
                      <SearchableSelect
                        value={line.productId}
                        onChange={(val) => handleProductChange(line.key, val)}
                        options={products.map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` }))}
                        placeholder="Select product…"
                        onAddNew={() => { setAddProductError(''); setShowAddProductModal(true); }}
                        addNewLabel="Add New Product"
                      />
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
                              onChange={(e) => {
                                const newUnitId = e.target.value;
                                setLines((prev) => prev.map((l) => {
                                  if (l.key !== line.key) return l;
                                  const prod = productMap[l.productId];
                                  if (!prod) return { ...l, unitId: newUnitId };
                                  const baseId = prod.baseUnitId ?? prod.unitId;
                                  let newCost: number;
                                  if (!newUnitId || newUnitId === baseId) {
                                    // Base unit → base cost
                                    newCost = prod.costCents / 100;
                                  } else {
                                    const conv = prod.unitConversions?.find(
                                      (c) => c.fromUnitId === newUnitId,
                                    );
                                    if (conv?.priceCents != null && conv.priceCents > 0) {
                                      newCost = conv.priceCents / 100;
                                    } else if (conv?.conversionQty) {
                                      newCost = (prod.costCents * Number(conv.conversionQty)) / 100;
                                    } else {
                                      // Safe fallback to base cost when no conversion exists
                                      newCost = prod.costCents / 100;
                                    }
                                  }
                                  // Warn (do NOT block) if the chosen unit has no
                                  // conversion rule — stock qty would not convert.
                                  let noConversionWarning = false;
                                  if (newUnitId && baseId && newUnitId !== baseId) {
                                    const hasConversion = prod.unitConversions?.some(
                                      (c) => c.fromUnitId === newUnitId && (c as any).isActive !== false,
                                    );
                                    if (!hasConversion) noConversionWarning = true;
                                  }
                                  return { ...l, unitId: newUnitId, unitCost: newCost.toFixed(2), noConversionWarning };
                                }));
                              }}
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
                            {line.noConversionWarning && (
                              <p className="text-xs text-amber-600 mt-1 px-1">
                                ⚠ No conversion set for this unit. Stock qty will not convert correctly. Edit the product to add a conversion.
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

      {/* ── Quick-add Supplier modal ─────────────────────────────────────────── */}
      {showAddSupplierModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-slate-800">Add New Supplier</h3>
              <button onClick={() => setShowAddSupplierModal(false)} className="p-1 hover:bg-slate-100 rounded-lg">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
                <input
                  value={newSupplierName}
                  onChange={(e) => setNewSupplierName(e.target.value)}
                  placeholder="Supplier name"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Phone (optional)</label>
                <input
                  value={newSupplierPhone}
                  onChange={(e) => setNewSupplierPhone(e.target.value)}
                  placeholder="Phone number"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              {addSupplierError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{addSupplierError}</p>
              )}
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setShowAddSupplierModal(false)}
                className="flex-1 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleAddSupplier}
                disabled={addingSupplier}
                className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-700 disabled:opacity-60"
              >
                {addingSupplier ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Quick-add Product modal ──────────────────────────────────────────── */}
      {showAddProductModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-sm p-5">
            <div className="flex items-center justify-between mb-4">
              <h3 className="text-base font-semibold text-slate-800">Add New Product</h3>
              <button onClick={() => setShowAddProductModal(false)} className="p-1 hover:bg-slate-100 rounded-lg">
                <X className="w-4 h-4 text-slate-500" />
              </button>
            </div>
            <div className="space-y-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
                <input
                  value={newProduct.name}
                  onChange={(e) => setNewProduct((p) => ({ ...p, name: e.target.value }))}
                  placeholder="Product name"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">SKU (optional)</label>
                <input
                  value={newProduct.sku}
                  onChange={(e) => setNewProduct((p) => ({ ...p, sku: e.target.value }))}
                  placeholder="Auto-generated if blank"
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Unit *</label>
                <select
                  value={newProduct.unitId}
                  onChange={(e) => setNewProduct((p) => ({ ...p, unitId: e.target.value }))}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                >
                  <option value="">Select unit…</option>
                  {(unitsList ?? []).map((u) => (
                    <option key={u.id} value={u.id}>{u.name} ({u.shortCode})</option>
                  ))}
                </select>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Category</label>
                  <select
                    value={newProduct.categoryId}
                    onChange={(e) => setNewProduct((p) => ({ ...p, categoryId: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="">— None —</option>
                    {(productMeta?.categories ?? []).map((c) => (
                      <option key={c.id} value={c.id}>{c.name}</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Brand</label>
                  <select
                    value={newProduct.brandId}
                    onChange={(e) => setNewProduct((p) => ({ ...p, brandId: e.target.value }))}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  >
                    <option value="">— None —</option>
                    {(productMeta?.brands ?? []).map((b) => (
                      <option key={b.id} value={b.id}>{b.name}</option>
                    ))}
                  </select>
                </div>
              </div>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Cost Price Rs.</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={newProduct.costCents}
                    onChange={(e) => setNewProduct((p) => ({ ...p, costCents: e.target.value }))}
                    placeholder="0.00"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">Sale Price Rs.</label>
                  <input
                    type="number" min="0" step="0.01"
                    value={newProduct.priceCents}
                    onChange={(e) => setNewProduct((p) => ({ ...p, priceCents: e.target.value }))}
                    placeholder="0.00"
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm text-right focus:outline-none focus:ring-2 focus:ring-brand-500"
                  />
                  {!newProduct.priceCents && (
                    <p className="text-amber-500 text-xs mt-1">
                      ⚠️ No selling price set — product will not appear in POS until price is added in Products page
                    </p>
                  )}
                </div>
              </div>
              {addProductError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{addProductError}</p>
              )}
            </div>
            <div className="flex gap-2 mt-5">
              <button
                onClick={() => setShowAddProductModal(false)}
                className="flex-1 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-100"
              >
                Cancel
              </button>
              <button
                onClick={handleAddProduct}
                disabled={addingProduct}
                className="flex-1 py-2 bg-brand-600 text-white rounded-lg text-sm font-semibold hover:bg-brand-700 disabled:opacity-60"
              >
                {addingProduct ? 'Saving…' : 'Save'}
              </button>
            </div>
          </div>
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
