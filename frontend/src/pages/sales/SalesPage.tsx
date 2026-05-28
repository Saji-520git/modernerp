import { useState } from 'react';
import React from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, X, CheckCircle, XCircle, Eye, Search, ChevronLeft, ChevronRight,
  Trash2, CreditCard, AlertCircle, RotateCcw, Download, Filter,
  FileText, Printer, ShoppingCart, Receipt, RefreshCw,
  DollarSign, TrendingUp, Package, Paperclip,
} from 'lucide-react';
import { PortalDropdown } from '../../components/ui/PortalDropdown';
import {
  salesApi, formatCents, STATUS_LABELS, STATUS_COLORS, PAYMENT_LABELS,
  type SaleStatus, type PaymentMethod, type SaleProduct, type SaleLine, type SaleForReturn,
} from '../../services/sales';
import { customerPaymentsApi, type CustomerPayment, type CreateCustomerPaymentInput } from '../../services/customerPayments';
import { inventoryApi } from '../../services/inventory';
import { exportSaleInvoice, exportSaleReturn } from '../../services/pdfExport';
import { useAuthStore } from '../../store/authStore';
import AttachmentPanel from '../../components/common/AttachmentPanel';

// ─── Helpers ───────────────────────────────────────────────────────────────────

function paymentStatusLabel(sale: { status: string; paidCents: number; totalCents: number }) {
  if (sale.status === 'CANCELLED') return { label: 'Cancelled', cls: 'bg-slate-100 text-slate-500' };
  if (sale.status === 'DRAFT')     return { label: 'Draft',     cls: 'bg-amber-100 text-amber-700' };
  const balance = sale.totalCents - sale.paidCents;
  if (balance <= 0)     return { label: 'Paid',     cls: 'bg-green-100 text-green-700' };
  if (sale.paidCents > 0) return { label: 'Partial', cls: 'bg-blue-100 text-blue-700' };
  return { label: 'Due', cls: 'bg-red-100 text-red-700' };
}

function exportToCSV(rows: any[], filename: string) {
  const headers = ['Invoice #', 'Date', 'Customer', 'Contact', 'Warehouse', 'Type', 'Payment Status', 'Payment Method', 'Total', 'Paid', 'Balance'];
  const lines = rows.map(s => [
    s.number,
    new Date(s.date).toLocaleDateString(),
    s.customer?.name ?? 'Walk-in',
    s.customer?.phone ?? '',
    s.warehouse?.name ?? '',
    s.isPos ? 'POS' : 'Invoice',
    paymentStatusLabel(s).label,
    PAYMENT_LABELS[s.paymentMethod as PaymentMethod] ?? s.paymentMethod,
    (s.totalCents / 100).toFixed(2),
    (s.paidCents / 100).toFixed(2),
    ((s.totalCents - s.paidCents) / 100).toFixed(2),
  ]);
  const csv = [headers, ...lines].map(r => r.map(c => `"${c}"`).join(',')).join('\n');
  const a = document.createElement('a');
  a.href = URL.createObjectURL(new Blob([csv], { type: 'text/csv' }));
  a.download = filename;
  a.click();
}

// ─── Line form type ────────────────────────────────────────────────────────────

interface LineForm {
  key: number;
  productId: string;
  qty: string;
  unitPrice: string;
  taxPercent: string;
  discountCents: string;
}

// ─── Payment Modal ─────────────────────────────────────────────────────────────

function PaymentModal({ saleId, totalCents, currentPaid, onClose }: {
  saleId: string; totalCents: number; currentPaid: number; onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [paidAmount, setPaidAmount] = useState((currentPaid / 100).toFixed(2));
  const [method, setMethod] = useState<PaymentMethod>('CASH');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => salesApi.recordPayment(saleId, {
      paidCents: Math.round(parseFloat(paidAmount) * 100),
      paymentMethod: method,
    }),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['sales'] }); onClose(); },
    onError: (err: any) => setError(err?.response?.data?.message ?? 'Failed to record payment'),
  });

  const balance = totalCents - currentPaid;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-sm shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-base font-semibold text-slate-800 flex items-center gap-2">
            <CreditCard className="w-4 h-4 text-indigo-600" /> Record Payment
          </h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-500" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex items-center gap-2"><AlertCircle className="w-4 h-4 shrink-0" />{error}</div>}
          <div className="bg-slate-50 rounded-lg p-3 grid grid-cols-3 gap-3 text-sm">
            <div><p className="text-slate-400 text-xs">Total</p><p className="font-semibold">{formatCents(totalCents)}</p></div>
            <div><p className="text-slate-400 text-xs">Paid</p><p className="font-semibold text-green-600">{formatCents(currentPaid)}</p></div>
            <div><p className="text-slate-400 text-xs">Balance</p><p className="font-semibold text-red-600">{formatCents(balance)}</p></div>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Amount to Record</label>
            <input type="number" min="0" step="0.01" value={paidAmount}
              onChange={e => setPaidAmount(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Payment Method</label>
            <div className="grid grid-cols-3 gap-1.5">
              {(['CASH','CARD','BANK_TRANSFER','QR_PAY','CREDIT'] as PaymentMethod[]).map(m => (
                <button key={m} onClick={() => setMethod(m)}
                  className={`py-1.5 rounded-lg border text-xs font-medium transition ${method === m ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                  {PAYMENT_LABELS[m]}
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="px-6 pb-5 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending}
            className="flex-1 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60">
            {mutation.isPending ? 'Saving…' : 'Record Payment'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Customer Payment Section ─────────────────────────────────────────────────

function CustomerPaymentSection({ saleId, totalCents, paidCents }: {
  saleId: string; totalCents: number; paidCents: number;
}) {
  const qc = useQueryClient();
  const [showForm, setShowForm] = useState(false);
  const [expandedId, setExpandedId] = useState<string | null>(null);

  // form state
  const [amount, setAmount]     = useState('');
  const [method, setMethod]     = useState<PaymentMethod>('CASH');
  const [refNo, setRefNo]       = useState('');
  const [bank, setBank]         = useState('');
  const [date, setDate]         = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes]       = useState('');
  const [formErr, setFormErr]   = useState('');

  const { data: payments = [], isLoading } = useQuery<CustomerPayment[]>({
    queryKey: ['customer-payments', saleId],
    queryFn:  () => customerPaymentsApi.listBySale(saleId),
  });

  const createMut = useMutation({
    mutationFn: (data: CreateCustomerPaymentInput) => customerPaymentsApi.create(data),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer-payments', saleId] });
      qc.invalidateQueries({ queryKey: ['sale', saleId] });
      qc.invalidateQueries({ queryKey: ['sales'] });
      setShowForm(false);
      setAmount(''); setRefNo(''); setBank(''); setNotes('');
      setFormErr('');
    },
    onError: (err: any) => setFormErr(err?.response?.data?.message ?? 'Failed to record payment'),
  });

  const voidMut = useMutation({
    mutationFn: (id: string) => customerPaymentsApi.void(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['customer-payments', saleId] });
      qc.invalidateQueries({ queryKey: ['sale', saleId] });
      qc.invalidateQueries({ queryKey: ['sales'] });
    },
  });

  const handleSubmit = () => {
    const amountCents = Math.round(parseFloat(amount) * 100);
    if (!amount || isNaN(amountCents) || amountCents <= 0) { setFormErr('Enter a valid amount'); return; }
    if (!date) { setFormErr('Select a payment date'); return; }
    createMut.mutate({ saleId, amountCents, paymentMethod: method, referenceNo: refNo || undefined, bankName: bank || undefined, paymentDate: date, notes: notes || undefined });
  };

  const balance = totalCents - paidCents;
  const methodLabels: Record<string, string> = {
    CASH: 'Cash', CARD: 'Card', BANK_TRANSFER: 'Bank', QR_PAY: 'QR', CREDIT: 'Credit', CHEQUE: 'Cheque',
  };
  const methodColors: Record<string, string> = {
    CASH: 'bg-green-100 text-green-700', CARD: 'bg-blue-100 text-blue-700',
    BANK_TRANSFER: 'bg-purple-100 text-purple-700', QR_PAY: 'bg-orange-100 text-orange-700',
    CREDIT: 'bg-red-100 text-red-700', CHEQUE: 'bg-amber-100 text-amber-700',
  };

  return (
    <div className="border-t border-slate-100 pt-4">
      {/* Header */}
      <div className="flex items-center justify-between mb-3">
        <div className="flex items-center gap-2">
          <DollarSign size={13} className="text-slate-400" />
          <h4 className="text-xs font-semibold text-slate-600 uppercase tracking-wide">Payment History</h4>
          {payments.length > 0 && (
            <span className="text-[10px] font-bold bg-slate-100 text-slate-500 px-1.5 py-0.5 rounded-full">{payments.length}</span>
          )}
        </div>
        {balance > 0 && !showForm && (
          <button onClick={() => setShowForm(true)}
            className="flex items-center gap-1 text-xs font-medium text-indigo-600 hover:text-indigo-800 px-2.5 py-1 bg-indigo-50 hover:bg-indigo-100 rounded-lg transition">
            <Plus size={12} /> Record Payment
          </button>
        )}
      </div>

      {/* Add payment form */}
      {showForm && (
        <div className="bg-slate-50 rounded-xl p-4 mb-3 space-y-3 border border-slate-200">
          <p className="text-xs font-semibold text-slate-600">New Payment
            <span className="ml-2 text-slate-400 font-normal">Balance due: {formatCents(balance)}</span>
          </p>
          {formErr && <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">{formErr}</p>}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Amount (Rs.)</label>
              <input type="number" min="0" step="0.01" value={amount}
                onChange={e => setAmount(e.target.value)}
                placeholder={(balance / 100).toFixed(2)}
                className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-[11px] font-medium text-slate-500 mb-1">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
          </div>
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Method</label>
            <div className="flex flex-wrap gap-1.5">
              {(['CASH','CARD','BANK_TRANSFER','QR_PAY','CHEQUE','CREDIT'] as PaymentMethod[]).map(m => (
                <button key={m} onClick={() => setMethod(m)}
                  className={`px-3 py-1 rounded-lg text-xs font-medium border transition ${method === m ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-100'}`}>
                  {methodLabels[m] ?? m}
                </button>
              ))}
            </div>
          </div>
          {(method === 'BANK_TRANSFER' || method === 'CHEQUE' || method === 'CARD') && (
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Reference No.</label>
                <input type="text" value={refNo} onChange={e => setRefNo(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
              <div>
                <label className="block text-[11px] font-medium text-slate-500 mb-1">Bank Name</label>
                <input type="text" value={bank} onChange={e => setBank(e.target.value)}
                  className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              </div>
            </div>
          )}
          <div>
            <label className="block text-[11px] font-medium text-slate-500 mb-1">Notes (optional)</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>
          <div className="flex gap-2">
            <button onClick={() => { setShowForm(false); setFormErr(''); }}
              className="flex-1 py-1.5 border border-slate-200 rounded-lg text-xs text-slate-600 hover:bg-slate-100 transition">Cancel</button>
            <button onClick={handleSubmit} disabled={createMut.isPending}
              className="flex-1 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-semibold hover:bg-indigo-700 disabled:opacity-60 transition">
              {createMut.isPending ? 'Saving…' : 'Save Payment'}
            </button>
          </div>
        </div>
      )}

      {/* Payment history list */}
      {isLoading ? (
        <div className="flex items-center gap-1.5 text-xs text-slate-400 py-2">
          <RefreshCw size={11} className="animate-spin" /> Loading…
        </div>
      ) : payments.length === 0 ? (
        <p className="text-xs text-slate-400 text-center py-3">No payments recorded yet</p>
      ) : (
        <div className="space-y-2">
          {payments.map((p) => (
            <React.Fragment key={p.id}>
              <div className="flex items-center gap-2.5 p-2.5 bg-slate-50 rounded-xl hover:bg-slate-100 transition group">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <span className="text-xs font-semibold text-slate-700">{p.paymentNumber}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${methodColors[p.paymentMethod] ?? 'bg-slate-100 text-slate-500'}`}>
                      {methodLabels[p.paymentMethod] ?? p.paymentMethod}
                    </span>
                  </div>
                  <p className="text-[10px] text-slate-400 mt-0.5">
                    {new Date(p.paymentDate).toLocaleDateString()} · {p.createdByUser.fullName}
                    {p.referenceNo && ` · Ref: ${p.referenceNo}`}
                  </p>
                </div>
                <span className="text-sm font-bold text-green-700 shrink-0">{formatCents(p.amountCents)}</span>
                <button onClick={() => setExpandedId(expandedId === p.id ? null : p.id)}
                  className="p-1.5 rounded-lg hover:bg-slate-200 text-slate-400 hover:text-slate-600 transition shrink-0"
                  title="Attachments">
                  <Paperclip size={12} />
                </button>
                <button onClick={() => {
                    if (!window.confirm(`Void payment ${p.paymentNumber}? This will reverse the amount.`)) return;
                    voidMut.mutate(p.id);
                  }}
                  disabled={voidMut.isPending}
                  className="p-1.5 rounded-lg hover:bg-red-50 text-slate-400 hover:text-red-500 transition disabled:opacity-50 shrink-0"
                  title="Void payment">
                  <Trash2 size={12} />
                </button>
              </div>
              {expandedId === p.id && (
                <div className="pl-3 pr-1">
                  <AttachmentPanel refType="CustomerPayment" refId={p.id} />
                </div>
              )}
            </React.Fragment>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Sale Detail Modal ─────────────────────────────────────────────────────────

function SaleDetailModal({ saleId, onClose, onEdit }: { saleId: string; onClose: () => void; onEdit?: (sale: any) => void }) {
  const { data: sale, isLoading } = useQuery({
    queryKey: ['sale', saleId],
    queryFn: () => salesApi.getSale(saleId),
  });
  const [showPayment, setShowPayment] = useState(false);
  const [modalErr, setModalErr]       = useState<string | null>(null);

  const queryClient = useQueryClient();
  const confirmMutation = useMutation({
    mutationFn: () => salesApi.confirmSale(saleId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['sale', saleId] });
      onClose();
    },
    onError: (err: any) => {
      setModalErr(err?.response?.data?.message ?? 'Failed to confirm invoice');
      setTimeout(() => setModalErr(null), 4000);
    },
  });
  const cancelMutation = useMutation({
    mutationFn: () => salesApi.cancelSale(saleId),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['sales'] }); queryClient.invalidateQueries({ queryKey: ['sale', saleId] }); },
    onError: (err: any) => {
      setModalErr(err?.response?.data?.message ?? 'Failed to cancel invoice');
      setTimeout(() => setModalErr(null), 4000);
    },
  });

  if (isLoading) return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
      <div className="bg-white rounded-xl p-8"><div className="w-6 h-6 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto" /></div>
    </div>
  );
  if (!sale) return null;

  const ps = paymentStatusLabel(sale);
  const balance = sale.totalCents - sale.paidCents;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className={`p-2 rounded-lg ${sale.isPos ? 'bg-purple-50' : 'bg-indigo-50'}`}>
              {sale.isPos ? <ShoppingCart className="w-4 h-4 text-purple-600" /> : <Receipt className="w-4 h-4 text-indigo-600" />}
            </div>
            <div>
              <h2 className="font-bold text-slate-800">{sale.number}</h2>
              <p className="text-xs text-slate-400">{sale.isPos ? 'POS Sale' : 'Sales Invoice'} · {new Date(sale.date).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' })}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${ps.cls}`}>{ps.label}</span>
            <button onClick={() => exportSaleInvoice(sale as any)} title="Download PDF"
              className="p-2 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded-lg transition">
              <Download className="w-4 h-4" />
            </button>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-500" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {/* Info grid */}
          <div className="grid grid-cols-3 gap-4 text-sm">
            <div><p className="text-xs text-slate-400 mb-0.5">Customer</p><p className="font-medium text-slate-800">{sale.customer?.name ?? 'Walk-in Customer'}</p></div>
            <div><p className="text-xs text-slate-400 mb-0.5">Warehouse</p><p className="font-medium text-slate-800">{sale.warehouse.name}</p></div>
            <div><p className="text-xs text-slate-400 mb-0.5">Payment Method</p><p className="font-medium text-slate-800">{PAYMENT_LABELS[sale.paymentMethod] ?? sale.paymentMethod}</p></div>
            <div><p className="text-xs text-slate-400 mb-0.5">Prepared by</p><p className="font-medium text-slate-800">{sale.createdBy.fullName}</p></div>
            <div><p className="text-xs text-slate-400 mb-0.5">Status</p><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[sale.status as SaleStatus]}`}>{STATUS_LABELS[sale.status as SaleStatus]}</span></div>
            {sale.note && <div className="col-span-1"><p className="text-xs text-slate-400 mb-0.5">Note</p><p className="font-medium text-slate-800">{sale.note}</p></div>}
          </div>

          {/* Lines table */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Items</p>
            <div className="rounded-xl overflow-hidden border border-slate-200">
              <table className="w-full text-sm">
                <thead className="bg-slate-50">
                  <tr>
                    <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Product</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Qty</th>
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Unit Price</th>
                    {/* Tax column hidden */}
                    <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {sale.lines?.map(l => (
                    <tr key={l.id} className="hover:bg-slate-50">
                      <td className="px-4 py-2.5"><p className="font-medium text-slate-800">{l.product.name}</p><p className="text-xs text-slate-400">{l.product.sku}</p></td>
                      <td className="px-4 py-2.5 text-right text-slate-700">{Number(l.qty)} {l.product.unit?.shortCode}</td>
                      <td className="px-4 py-2.5 text-right text-slate-700">{formatCents(l.unitPriceCents)}</td>
                      {/* Tax% cell hidden */}
                      <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{formatCents(l.lineTotalCents)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {/* Totals */}
          <div className="bg-slate-50 rounded-xl p-4 space-y-1.5 text-sm">
            <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{formatCents(sale.subtotalCents)}</span></div>
            {/* Tax row hidden */}
            {sale.discountCents > 0 && <div className="flex justify-between text-slate-500"><span>Discount</span><span>− {formatCents(sale.discountCents)}</span></div>}
            <div className="flex justify-between font-bold text-base pt-2 border-t border-slate-200 text-slate-800"><span>Total</span><span>{formatCents(sale.totalCents)}</span></div>
            <div className="flex justify-between text-green-600 font-medium"><span>Paid</span><span>{formatCents(sale.paidCents)}</span></div>
            {balance > 0 && <div className="flex justify-between text-red-600 font-bold"><span>Balance Due</span><span>{formatCents(balance)}</span></div>}
          </div>

          {/* Customer payment history — confirmed invoices only */}
          {sale.status === 'CONFIRMED' && (
            <CustomerPaymentSection
              saleId={sale.id}
              totalCents={sale.totalCents}
              paidCents={sale.paidCents}
            />
          )}
        </div>

        {/* Footer actions */}
        {modalErr && (
          <div className="mx-6 mb-2 px-4 py-2.5 bg-red-50 border border-red-200 rounded-lg text-sm text-red-700">
            {modalErr}
          </div>
        )}
        {!sale.isPos && (
          <div className="px-6 py-4 border-t border-slate-200 flex gap-2 flex-wrap">
            {sale.status === 'DRAFT' && (
              <>
                {onEdit && (
                  <button onClick={() => { onEdit(sale); onClose(); }}
                    className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50 transition">
                    Edit Draft
                  </button>
                )}
                <button onClick={() => confirmMutation.mutate()} disabled={confirmMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 bg-green-600 text-white rounded-lg text-sm font-semibold hover:bg-green-700 disabled:opacity-60 transition">
                  <CheckCircle className="w-4 h-4" /> Confirm
                </button>
                <button onClick={() => cancelMutation.mutate()} disabled={cancelMutation.isPending}
                  className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50 transition">
                  <XCircle className="w-4 h-4" /> Cancel
                </button>
              </>
            )}
            {sale.status === 'CONFIRMED' && balance > 0 && (
              <button onClick={() => setShowPayment(true)}
                className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition">
                <CreditCard className="w-4 h-4" /> Record Payment
              </button>
            )}
            <button onClick={() => exportSaleInvoice(sale as any)}
              className="ml-auto flex items-center gap-1.5 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50 transition">
              <Download className="w-4 h-4" /> PDF
            </button>
          </div>
        )}

        {showPayment && (
          <PaymentModal saleId={sale.id} totalCents={sale.totalCents} currentPaid={sale.paidCents}
            onClose={() => setShowPayment(false)} />
        )}
      </div>
    </div>
  );
}

// ─── New Invoice Form ──────────────────────────────────────────────────────────

function NewInvoiceModal({ onClose, editSale }: { onClose: () => void; editSale?: any }) {
  const queryClient = useQueryClient();
  const isEdit = !!editSale;
  const [warehouseId, setWarehouseId] = useState(editSale?.warehouse?.id ?? '');
  const [customerId, setCustomerId]   = useState(editSale?.customer?.id ?? '');
  const [date, setDate]               = useState(
    editSale ? new Date(editSale.date).toISOString().slice(0, 10) : new Date().toISOString().slice(0, 10),
  );
  const [note, setNote]               = useState(editSale?.note ?? '');
  const [lines, setLines]             = useState<LineForm[]>(
    editSale?.lines?.length
      ? editSale.lines.map((l: any, i: number) => ({
          key: i, productId: l.productId,
          qty: String(Number(l.qty)), unitPrice: (l.unitPriceCents / 100).toFixed(2),
          taxPercent: String(l.taxPercent), discountCents: String(l.discountCents ?? 0),
        }))
      : [{ key: 0, productId: '', qty: '1', unitPrice: '', taxPercent: '0', discountCents: '0' }],
  );
  const [error, setError]             = useState('');

  const { data: warehouses = [] } = useQuery({ queryKey: ['warehouses-for-sale'], queryFn: () => inventoryApi.getWarehouses() });
  const { data: customers  = [] } = useQuery({ queryKey: ['customers-for-sale'], queryFn: () => salesApi.listCustomers() });
  const { data: products   = [] } = useQuery({ queryKey: ['products-for-sale', warehouseId], queryFn: () => salesApi.listProducts(warehouseId || undefined), enabled: true });

  const addLine = () => setLines(p => [...p, { key: Date.now(), productId: '', qty: '1', unitPrice: '', taxPercent: '0', discountCents: '0' }]);
  const removeLine = (key: number) => setLines(p => p.filter(l => l.key !== key));
  const updateLine = (key: number, field: keyof LineForm, value: string) =>
    setLines(p => p.map(l => l.key === key ? { ...l, [field]: value, ...(field === 'productId' ? (() => { const pr = products.find(x => x.id === value); return pr ? { unitPrice: (pr.priceCents / 100).toFixed(2), taxPercent: String(pr.taxPercent) } : {}; })() : {}) } : l));

  const buildPayload = () => ({
    customerId: customerId || undefined,
    warehouseId,
    date: date ? new Date(date).toISOString() : undefined,
    note: note || undefined,
    lines: lines.filter(l => l.productId).map(l => ({
      productId: l.productId,
      qty: parseFloat(l.qty) || 1,
      unitPriceCents: Math.round((parseFloat(l.unitPrice) || 0) * 100),
      taxPercent: parseFloat(l.taxPercent) || 0,
      discountCents: parseInt(l.discountCents) || 0,
    })),
  });

  const createMutation = useMutation({
    mutationFn: () => salesApi.createSale(buildPayload()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['sales'] }); onClose(); },
    onError: (err: any) => setError(err?.response?.data?.message ?? 'Failed to create invoice'),
  });

  const updateMutation = useMutation({
    mutationFn: () => salesApi.updateSale(editSale!.id, buildPayload()),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['sales'] }); queryClient.invalidateQueries({ queryKey: ['sale', editSale!.id] }); onClose(); },
    onError: (err: any) => setError(err?.response?.data?.message ?? 'Failed to update invoice'),
  });

  const mutation = isEdit ? updateMutation : createMutation;

  const lineTotal = (l: LineForm) => {
    const qty = parseFloat(l.qty) || 0;
    const price = parseFloat(l.unitPrice) || 0;
    const discount = parseInt(l.discountCents) || 0;
    return Math.max(0, Math.round(qty * price * 100) - discount); // No tax per business decision
  };
  const grandTotal = lines.reduce((s, l) => s + lineTotal(l), 0);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-3xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-bold text-slate-800 text-lg flex items-center gap-2"><Plus className="w-5 h-5 text-indigo-600" /> {isEdit ? `Edit — ${editSale.number}` : 'New Invoice'}</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-500" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex gap-2"><AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Warehouse *</label>
              <select value={warehouseId} onChange={e => setWarehouseId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                <option value="">— Select —</option>
                {warehouses.map((w: any) => <option key={w.id} value={w.id}>{w.name} ({w.code})</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Customer</label>
              <select value={customerId} onChange={e => setCustomerId(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                <option value="">Walk-in Customer</option>
                {customers.map((c: any) => <option key={c.id} value={c.id}>{c.name}{c.phone ? ` · ${c.phone}` : ''}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Note</label>
              <input type="text" value={note} onChange={e => setNote(e.target.value)} placeholder="Optional note…"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
          </div>

          {/* Line items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Line Items</p>
              <button onClick={addLine} className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-700 font-medium">
                <Plus className="w-3.5 h-3.5" /> Add Line
              </button>
            </div>
            <div className="space-y-2">
              {lines.map(l => (
                <div key={l.key} className="grid grid-cols-12 gap-2 items-center">
                  <div className="col-span-4">
                    <select value={l.productId} onChange={e => updateLine(l.key, 'productId', e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                      <option value="">— Product —</option>
                      {products.map((p: any) => <option key={p.id} value={p.id}>{p.name}</option>)}
                    </select>
                  </div>
                  <div className="col-span-2">
                    <input type="number" min="0.01" step="0.01" placeholder="Qty" value={l.qty} onChange={e => updateLine(l.key, 'qty', e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                  </div>
                  <div className="col-span-2">
                    <input type="number" min="0" step="0.01" placeholder="Price" value={l.unitPrice} onChange={e => updateLine(l.key, 'unitPrice', e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                  </div>
                  {/* Tax% input hidden */}
                  <div className="col-span-3 text-right text-sm font-semibold text-slate-700">
                    {formatCents(lineTotal(l))}
                  </div>
                  <div className="col-span-1 flex justify-end">
                    {lines.length > 1 && (
                      <button onClick={() => removeLine(l.key)} className="p-1 text-slate-300 hover:text-red-400 transition"><Trash2 className="w-3.5 h-3.5" /></button>
                    )}
                  </div>
                </div>
              ))}
            </div>
            <div className="text-right text-base font-bold text-slate-800 mt-3 pt-3 border-t border-slate-200">
              Grand Total: <span className="text-indigo-600">{formatCents(grandTotal)}</span>
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={!warehouseId || lines.every(l => !l.productId) || mutation.isPending}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 transition">
            {mutation.isPending ? 'Saving…' : isEdit ? 'Update Invoice' : 'Create Invoice'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Return Modal ──────────────────────────────────────────────────────────────

function ReturnModal({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: sale, isLoading } = useQuery({ queryKey: ['sale-for-return', saleId], queryFn: () => salesApi.getSaleForReturn(saleId) });
  const [reason, setReason] = useState('');
  const [qtys, setQtys]     = useState<Record<string, string>>({});
  const [error, setError]   = useState('');

  const mutation = useMutation({
    mutationFn: () => salesApi.createReturn({
      saleId,
      reason: reason || undefined,
      lines: (sale?.lines ?? []).filter(l => parseInt(qtys[l.productId] || '0') > 0).map(l => ({
        productId: l.productId,
        qty: parseInt(qtys[l.productId]),
        unitPriceCents: l.unitPriceCents,
        lineTotalCents: Math.round(l.unitPriceCents * parseInt(qtys[l.productId])),
      })),
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['returns'] });
      onClose();
    },
    onError: (err: any) => setError(err?.response?.data?.message ?? 'Return failed'),
  });

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-bold text-slate-800 flex items-center gap-2"><RotateCcw className="w-4 h-4 text-orange-500" /> Create Return</h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-500" /></button>
        </div>
        <div className="px-6 py-5 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
          {isLoading ? <div className="text-center py-6 text-slate-400">Loading…</div> : (
            <div className="space-y-2">
              {sale?.lines.map(l => (
                <div key={l.id} className="flex items-center gap-3 p-3 bg-slate-50 rounded-lg">
                  <div className="flex-1 min-w-0">
                    <p className="text-sm font-medium text-slate-800 truncate">{l.product.name}</p>
                    <p className="text-xs text-slate-400">Available: {l.availableToReturn} {l.product.unit?.shortCode}</p>
                  </div>
                  <input type="number" min="0" max={l.availableToReturn} value={qtys[l.productId] ?? ''}
                    onChange={e => setQtys(p => ({ ...p, [l.productId]: e.target.value }))} placeholder="0"
                    className="w-16 border border-slate-300 rounded-lg px-2 py-1 text-sm text-center focus:outline-none focus:ring-2 focus:ring-orange-400" />
                </div>
              ))}
            </div>
          )}
          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Reason (optional)</label>
            <input value={reason} onChange={e => setReason(e.target.value)} placeholder="Return reason…"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-orange-400" />
          </div>
        </div>
        <div className="px-6 pb-5 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2 border border-slate-200 rounded-lg text-sm text-slate-600">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={mutation.isPending || !sale}
            className="flex-1 py-2 bg-orange-500 text-white rounded-lg text-sm font-semibold hover:bg-orange-600 disabled:opacity-60">
            {mutation.isPending ? 'Processing…' : 'Create Return'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Record Payment Modal ─────────────────────────────────────────────────────

function RecordPaymentModal({
  saleId, totalCents, paidCents, saleNumber, onClose,
}: {
  saleId: string; totalCents: number; paidCents: number;
  saleNumber: string; onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const outstanding = totalCents - paidCents;
  const [amount, setAmount]   = useState((outstanding / 100).toFixed(2));
  const [method, setMethod]   = useState<PaymentMethod>('CASH');
  const [date, setDate]       = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote]       = useState('');
  const [error, setError]     = useState('');

  const { data: history = [] } = useQuery({
    queryKey: ['sale-payments', saleId],
    queryFn:  () => salesApi.listPayments(saleId),
  });

  const mutation = useMutation({
    mutationFn: () => salesApi.recordPaymentNew(saleId, {
      amountCents:   Math.round(parseFloat(amount) * 100),
      paymentMethod: method,
      note:          note || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      queryClient.invalidateQueries({ queryKey: ['sale', saleId] });
      queryClient.invalidateQueries({ queryKey: ['sale-payments', saleId] });
      onClose();
    },
    onError: (err: any) => setError(err?.response?.data?.message ?? 'Payment failed'),
  });

  const amountCents = Math.round(parseFloat(amount || '0') * 100);
  const canSubmit   = amountCents > 0 && amountCents <= outstanding;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-bold text-slate-800 flex items-center gap-2">
            <CreditCard className="w-5 h-5 text-indigo-600" /> Record Payment — {saleNumber}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-500" /></button>
        </div>

        <div className="px-6 py-5 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

          {/* Summary */}
          <div className="grid grid-cols-3 gap-3 bg-slate-50 rounded-xl p-3 text-sm">
            <div className="text-center"><p className="text-xs text-slate-400 mb-0.5">Invoice Total</p><p className="font-semibold text-slate-800">{formatCents(totalCents)}</p></div>
            <div className="text-center"><p className="text-xs text-slate-400 mb-0.5">Already Paid</p><p className="font-semibold text-green-600">{formatCents(paidCents)}</p></div>
            <div className="text-center"><p className="text-xs text-slate-400 mb-0.5">Outstanding</p><p className="font-bold text-indigo-600 text-base">{formatCents(outstanding)}</p></div>
          </div>

          {/* Form */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Amount (Rs.) *</label>
              <input type="number" min="0.01" step="0.01" value={amount}
                onChange={e => setAmount(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Method *</label>
              <select value={method} onChange={e => setMethod(e.target.value as PaymentMethod)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                {(['CASH','CARD','BANK_TRANSFER','QR_PAY'] as PaymentMethod[]).map(m => (
                  <option key={m} value={m}>{PAYMENT_LABELS[m]}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Date</label>
              <input type="date" value={date} onChange={e => setDate(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Note (optional)</label>
              <input type="text" value={note} onChange={e => setNote(e.target.value)}
                placeholder="e.g. Cheque #1234"
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
          </div>

          {/* Payment history */}
          {history.length > 0 && (
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Payment History</p>
              <div className="space-y-1 max-h-32 overflow-y-auto">
                {history.map((p: any) => (
                  <div key={p.id} className="flex items-center justify-between text-xs py-1.5 px-3 bg-slate-50 rounded-lg">
                    <span className="text-slate-500">{new Date(p.date).toLocaleDateString()}</span>
                    <span className="text-slate-600">{PAYMENT_LABELS[p.method as PaymentMethod] ?? p.method}</span>
                    <span className="font-semibold text-slate-800">{formatCents(p.amountCents)}</span>
                    {p.note && <span className="text-slate-400 truncate max-w-20">{p.note}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div className="px-6 pb-5 flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 border border-slate-200 rounded-xl text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={() => mutation.mutate()} disabled={!canSubmit || mutation.isPending}
            className="flex-[2] py-2.5 bg-indigo-600 text-white rounded-xl text-sm font-bold hover:bg-indigo-700 disabled:opacity-50 transition flex items-center justify-center gap-2">
            {mutation.isPending
              ? <><div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> Processing…</>
              : <><CheckCircle className="w-4 h-4" /> Record Payment</>
            }
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Main Sales Page ───────────────────────────────────────────────────────────

export default function SalesPage() {
  const { user } = useAuthStore();
  const isAdminOrManager = user?.role === 'ADMIN' || user?.role === 'MANAGER';
  const isAdmin          = user?.role === 'ADMIN';

  // ── Filters state ──
  const [search, setSearch]         = useState('');
  const [status, setStatus]         = useState('');
  const [payMethod, setPayMethod]   = useState('');
  const [fromDate, setFromDate]     = useState('');
  const [toDate, setToDate]         = useState('');
  const [includePos, setIncludePos] = useState(false); // Invoice module never shows POS sales by default
  const [pageSize, setPageSize]     = useState(25);
  const [page, setPage]             = useState(1);
  const [showFilters, setShowFilters] = useState(false);

  // ── Modal state ──
  const [detailId, setDetailId]           = useState<string | null>(null);
  const [returnId, setReturnId]           = useState<string | null>(null);
  const [showNewInvoice, setShowNewInvoice] = useState(false);
  const [editSale, setEditSale]           = useState<any>(null);
  const [paymentSaleId, setPaymentSaleId] = useState<string | null>(null);
  const [confirmSaleId, setConfirmSaleId] = useState<string | null>(null);
  const [deleteSaleId, setDeleteSaleId]   = useState<string | null>(null);
  const [pageToast, setPageToast]         = useState<{ msg: string; ok: boolean } | null>(null);
  const queryClient = useQueryClient();

  const showToast = (msg: string, ok: boolean) => {
    setPageToast({ msg, ok });
    setTimeout(() => setPageToast(null), 3000);
  };

  const inlineConfirmMutation = useMutation({
    mutationFn: (id: string) => salesApi.confirmSale(id),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['sales'] });
      setConfirmSaleId(null);
      showToast('Invoice confirmed', true);
    },
    onError: (err: any) => {
      showToast(err?.response?.data?.message ?? 'Failed to confirm invoice', false);
    },
  });

  const inlineCancelMutation = useMutation({
    mutationFn: (id: string) => salesApi.cancelSale(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['sales'] }); setConfirmSaleId(null); },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => salesApi.deleteSale(id),
    onSuccess: () => { queryClient.invalidateQueries({ queryKey: ['sales'] }); setDeleteSaleId(null); },
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['sales', search, status, payMethod, fromDate, toDate, includePos, page, pageSize],
    queryFn: () => salesApi.listSales({
      search: search || undefined,
      status: (status as any) || undefined,
      paymentMethod: payMethod || undefined,
      from: fromDate || undefined,
      to: toDate || undefined,
      includePos: includePos ? 'true' : 'false',
      page,
      pageSize,
    }),
    placeholderData: prev => prev,
  });

  const sales  = data?.data ?? [];
  const total  = data?.total ?? 0;
  const pages  = Math.ceil(total / pageSize);

  // ── Summary stats (from visible data) ──
  const stats = {
    totalRevenue: sales.reduce((s, x) => s + x.totalCents, 0),
    totalPaid:    sales.reduce((s, x) => s + x.paidCents, 0),
    totalDue:     sales.reduce((s, x) => s + Math.max(0, x.totalCents - x.paidCents), 0),
    count:        total,
  };

  const resetFilters = () => { setSearch(''); setStatus(''); setPayMethod(''); setFromDate(''); setToDate(''); setIncludePos(true); setPage(1); };
  const hasFilter = search || status || payMethod || fromDate || toDate || !includePos;

  return (
    <div className="min-h-screen bg-slate-50 p-6" id="sales-print-area">
      {/* Print-only header */}
      <div className="print-header mb-4 pb-4 border-b">
        <h1 className="text-xl font-bold">ModernERP — Sales Report</h1>
        <p className="text-sm text-slate-500">Printed: {new Date().toLocaleString()}</p>
      </div>

      {/* ── Page Header ── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Sales</h1>
          <p className="text-sm text-slate-500 mt-0.5">Invoices and POS transactions</p>
        </div>
        <button onClick={() => { setEditSale(null); setShowNewInvoice(true); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors no-print">
          <Plus className="w-4 h-4" /> New Invoice
        </button>
      </div>

      {/* ── KPI Cards ── */}
      <div className="grid grid-cols-4 gap-4 mb-6">
        {[
          { label: 'Total Sales',  value: String(stats.count),             sub: 'transactions',      iconBg: 'bg-blue-50',    icon: <Package    size={22} className="text-blue-600" /> },
          { label: 'Revenue',      value: formatCents(stats.totalRevenue),  sub: 'this view',         iconBg: 'bg-violet-50',  icon: <TrendingUp size={22} className="text-violet-600" /> },
          { label: 'Collected',    value: formatCents(stats.totalPaid),     sub: 'payments received', iconBg: 'bg-emerald-50', icon: <CheckCircle size={22} className="text-emerald-600" /> },
          { label: 'Outstanding',  value: formatCents(stats.totalDue),      sub: 'balance due',       iconBg: 'bg-amber-50',   icon: <DollarSign  size={22} className="text-amber-600" />, valueCls: stats.totalDue > 0 ? 'text-amber-600' : '' },
        ].map(k => (
          <div key={k.label} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 flex items-center gap-4">
            <div className={`w-12 h-12 rounded-xl flex items-center justify-center flex-shrink-0 ${k.iconBg}`}>
              {k.icon}
            </div>
            <div>
              <p className="text-xs text-slate-500 font-medium uppercase tracking-wide">{k.label}</p>
              <p className={`text-2xl font-bold mt-0.5 ${k.valueCls ?? 'text-slate-800'}`}>{k.value}</p>
              <p className="text-xs text-slate-400 mt-0.5">{k.sub}</p>
            </div>
          </div>
        ))}
      </div>

      {/* ── Table Card ── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm">

        {/* Toolbar */}
        <div className="px-5 py-4 border-b border-slate-100 flex items-center gap-3 flex-wrap no-print">
          {/* Search */}
          <div className="relative flex-1 min-w-[180px]">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input type="text" placeholder="Search or scan invoice barcode…" value={search}
              onChange={e => { setSearch(e.target.value); setPage(1); }}
              onKeyDown={e => {
                if (e.key === 'Enter' && search.trim()) {
                  const match = sales.find(s => s.number.toLowerCase() === search.trim().toLowerCase());
                  if (match) { setDetailId(match.id); setSearch(''); setPage(1); }
                }
              }}
              className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white" />
          </div>

          {/* Show N entries */}
          <div className="flex items-center gap-1.5 text-sm text-slate-500">
            <span>Show</span>
            <select value={pageSize} onChange={e => { setPageSize(Number(e.target.value)); setPage(1); }}
              className="border border-slate-200 rounded-lg px-2 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
              {[10, 25, 50, 100].map(n => <option key={n} value={n}>{n}</option>)}
            </select>
            <span>entries</span>
          </div>

          {/* Filter toggle */}
          <button onClick={() => setShowFilters(f => !f)}
            className={`flex items-center gap-2 px-3 py-2 rounded-xl text-sm font-medium border transition ${hasFilter ? 'bg-indigo-50 border-indigo-200 text-indigo-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
            <Filter className="w-4 h-4" /> Filters {hasFilter && <span className="bg-indigo-600 text-white text-[10px] rounded-full w-4 h-4 flex items-center justify-center">!</span>}
          </button>

          {/* Export buttons */}
          <button onClick={() => exportToCSV(sales, 'sales.csv')}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition no-print">
            <FileText className="w-4 h-4" /> CSV
          </button>
          <button onClick={() => window.print()}
            className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition no-print">
            <Printer className="w-4 h-4" /> Print
          </button>
          <button onClick={() => refetch()}
            className="p-2 border border-slate-200 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-50 transition no-print">
            <RefreshCw className="w-4 h-4" />
          </button>
        </div>

        {/* Filter panel */}
        {showFilters && (
          <div className="px-5 py-3 border-b border-slate-100 bg-slate-50/80 flex flex-wrap gap-3 items-end">
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
              <select value={status} onChange={e => { setStatus(e.target.value); setPage(1); }}
                className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                <option value="">All statuses</option>
                <option value="DRAFT">Draft</option>
                <option value="CONFIRMED">Confirmed</option>
                <option value="CANCELLED">Cancelled</option>
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">Payment Method</label>
              <select value={payMethod} onChange={e => { setPayMethod(e.target.value); setPage(1); }}
                className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400">
                <option value="">All methods</option>
                {['CASH','CARD','BANK_TRANSFER','WALLET','CREDIT','OTHER'].map(m => <option key={m} value={m}>{PAYMENT_LABELS[m as PaymentMethod] ?? m}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">From Date</label>
              <input type="date" value={fromDate} onChange={e => { setFromDate(e.target.value); setPage(1); }}
                className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-500 mb-1">To Date</label>
              <input type="date" value={toDate} onChange={e => { setToDate(e.target.value); setPage(1); }}
                className="border border-slate-200 rounded-lg px-2.5 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div className="flex items-center gap-2">
              <input type="checkbox" id="incPos" checked={includePos} onChange={e => { setIncludePos(e.target.checked); setPage(1); }}
                className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-400" />
              <label htmlFor="incPos" className="text-sm text-slate-600 select-none">Include POS sales</label>
            </div>
            {hasFilter && (
              <button onClick={resetFilters} className="flex items-center gap-1.5 px-3 py-1.5 text-sm text-slate-500 hover:text-red-500 hover:bg-red-50 rounded-lg transition">
                <X className="w-3.5 h-3.5" /> Clear
              </button>
            )}
          </div>
        )}

        {/* Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-sm min-w-[800px]">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Date</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Invoice #</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Customer</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Pay Status</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Method</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Total</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Paid</th>
                <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide whitespace-nowrap">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {isLoading ? (
                <tr><td colSpan={8} className="text-center py-16 text-slate-400">
                  <div className="flex items-center justify-center gap-2">
                    <div className="w-5 h-5 border-2 border-slate-200 border-t-blue-500 rounded-full animate-spin" />
                    Loading sales…
                  </div>
                </td></tr>
              ) : sales.length === 0 ? (
                <tr><td colSpan={8} className="px-4 py-16 text-center">
                  <FileText size={40} className="mx-auto text-slate-200 mb-3" />
                  <p className="text-slate-500 font-medium">No sales found</p>
                  <p className="text-slate-400 text-sm mt-1">
                    {hasFilter ? 'Try adjusting your filters' : 'Create your first invoice or make a POS sale'}
                  </p>
                </td></tr>
              ) : sales.map(sale => {
                const ps = paymentStatusLabel(sale);
                return (
                  <tr key={sale.id} className="hover:bg-blue-50/30 transition-colors cursor-pointer border-b border-slate-100 last:border-0">
                    <td className="px-4 py-3 text-slate-600 whitespace-nowrap">
                      <div>{new Date(sale.date).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' })}</div>
                      <div className="text-xs text-slate-400">{new Date(sale.date).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <div className="flex items-center gap-1.5">
                        {sale.isPos
                          ? <span className="bg-purple-100 text-purple-700 text-[9px] font-bold px-1.5 py-0.5 rounded-full">POS</span>
                          : <span className="bg-blue-100 text-blue-700 text-[9px] font-bold px-1.5 py-0.5 rounded-full">INV</span>
                        }
                        <span className="inline-flex items-center gap-1 font-mono text-sm font-semibold text-blue-600">
                          <FileText size={13} />
                          {sale.number}
                        </span>
                      </div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="font-medium text-slate-800">
                        {sale.customer?.name ?? <span className="text-slate-400 italic">Walk-in</span>}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className={`inline-flex items-center px-2.5 py-1 rounded-full text-xs font-semibold ${ps.cls}`}>
                        {ps.label}
                      </span>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="px-2 py-0.5 rounded-md text-xs font-medium bg-slate-100 text-slate-600">
                        {PAYMENT_LABELS[sale.paymentMethod as PaymentMethod] ?? sale.paymentMethod}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-slate-800 whitespace-nowrap">
                      {formatCents(sale.totalCents)}
                    </td>
                    <td className="px-4 py-3 text-right font-medium text-emerald-600 whitespace-nowrap">
                      {formatCents(sale.paidCents)}
                    </td>
                    <td className="px-4 py-3 text-center whitespace-nowrap sticky right-0 bg-white border-l border-slate-100">
                      <PortalDropdown items={[
                        { label: 'View Detail',      icon: <Eye size={14} />,        onClick: () => setDetailId(sale.id) },
                        { label: 'Edit Draft',       icon: <FileText size={14} />,   onClick: () => { const s = sales.find(x => x.id === sale.id); if (s) { setEditSale(s); setShowNewInvoice(true); } }, hidden: sale.status !== 'DRAFT' || sale.isPos },
                        { label: 'Confirm Invoice',  icon: <CheckCircle size={14} />,onClick: () => inlineConfirmMutation.mutate(sale.id),  hidden: sale.status !== 'DRAFT' || sale.isPos || !isAdminOrManager },
                        { label: 'Delete Draft',     icon: <Trash2 size={14} />,     onClick: () => setDeleteSaleId(sale.id), danger: true,  hidden: sale.status !== 'DRAFT' || sale.isPos || !isAdmin },
                        { label: 'Record Payment',   icon: <CreditCard size={14} />, onClick: () => setPaymentSaleId(sale.id),               hidden: sale.status !== 'CONFIRMED' || (sale.totalCents ?? 0) - (sale.paidCents ?? 0) <= 0 },
                        { label: 'Download PDF',     icon: <Download size={14} />,   onClick: () => exportSaleInvoice(sale),                 hidden: sale.status === 'DRAFT' },
                        { label: 'Process Return',   icon: <RotateCcw size={14} />,  onClick: () => setReturnId(sale.id),                    hidden: sale.status !== 'CONFIRMED' },
                        { label: 'Cancel Invoice',   icon: <XCircle size={14} />,    onClick: () => inlineCancelMutation.mutate(sale.id), danger: true, hidden: sale.status !== 'CONFIRMED' || !isAdminOrManager },
                      ]} />
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Pagination */}
        {total > 0 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 no-print">
            <span className="text-sm text-slate-500">
              Showing{' '}
              <span className="font-semibold text-slate-700">{(page - 1) * pageSize + 1}</span>–<span className="font-semibold text-slate-700">{Math.min(page * pageSize, total)}</span>
              {' '}of{' '}
              <span className="font-semibold text-slate-700">{total}</span> entries
            </span>
            <div className="flex items-center gap-1">
              <button onClick={() => setPage(1)} disabled={page === 1}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
                <ChevronLeft className="w-4 h-4" />
              </button>
              {Array.from({ length: Math.min(pages, 7) }, (_, i) => {
                const p = pages <= 7 ? i + 1 : page <= 4 ? i + 1 : page >= pages - 3 ? pages - 6 + i : page - 3 + i;
                return (
                  <button key={p} onClick={() => setPage(p)}
                    className={`w-8 h-8 rounded-lg text-sm font-medium transition ${page === p ? 'bg-blue-600 text-white' : 'border border-slate-200 text-slate-600 hover:bg-slate-50'}`}>
                    {p}
                  </button>
                );
              })}
              <button onClick={() => setPage(pages)} disabled={page === pages}
                className="p-1.5 rounded-lg border border-slate-200 text-slate-500 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed transition">
                <ChevronRight className="w-4 h-4" />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Modals ── */}
      {detailId    && <SaleDetailModal saleId={detailId} onClose={() => setDetailId(null)} onEdit={(s) => { setDetailId(null); setEditSale(s); setShowNewInvoice(true); }} />}
      {returnId    && <ReturnModal saleId={returnId} onClose={() => setReturnId(null)} />}
      {showNewInvoice && <NewInvoiceModal onClose={() => { setShowNewInvoice(false); setEditSale(null); }} editSale={editSale} />}
      {paymentSaleId && (() => {
        const s = sales.find(x => x.id === paymentSaleId);
        if (!s) return null;
        return (
          <RecordPaymentModal
            saleId={paymentSaleId}
            totalCents={s.totalCents}
            paidCents={s.paidCents}
            saleNumber={s.number}
            onClose={() => setPaymentSaleId(null)}
          />
        );
      })()}

      {/* Delete DRAFT invoice confirm dialog */}
      {deleteSaleId && (() => {
        const s = sales.find(x => x.id === deleteSaleId);
        return (
          <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
            <div className="bg-white rounded-xl w-full max-w-sm shadow-xl p-6">
              <h3 className="font-bold text-slate-800 mb-2">Delete {s?.number ?? 'Draft Invoice'}?</h3>
              <p className="text-sm text-slate-500 mb-5">This cannot be undone. Only DRAFT invoices can be deleted.</p>
              <div className="flex gap-3">
                <button onClick={() => setDeleteSaleId(null)}
                  className="flex-1 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">
                  Cancel
                </button>
                <button onClick={() => deleteMutation.mutate(deleteSaleId!)}
                  disabled={deleteMutation.isPending}
                  className="flex-1 py-2 bg-red-600 text-white rounded-lg text-sm font-semibold hover:bg-red-700 disabled:opacity-60">
                  {deleteMutation.isPending ? 'Deleting…' : 'Delete'}
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* Page-level toast */}
      {pageToast && (
        <div className={`fixed bottom-6 right-6 px-5 py-3 rounded-xl shadow-lg text-sm font-medium z-[9999] transition-all ${
          pageToast.ok ? 'bg-green-600 text-white' : 'bg-red-600 text-white'
        }`}>
          {pageToast.msg}
        </div>
      )}
    </div>
  );
}
