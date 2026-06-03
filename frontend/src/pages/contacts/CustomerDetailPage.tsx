import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Pencil, Plus, CreditCard, X, Check,
  ShieldCheck, AlertTriangle, Users, Receipt, RotateCcw,
  DollarSign, TrendingDown, Wallet, ChevronRight,
  Star, MessageSquare, FileText,
} from 'lucide-react';
import {
  customersApi,
  type CustomerDetail,
  type CustomerBody,
} from '../../services/contacts';
import {
  salesApi,
  type Sale,
  type SaleLine,
  type SaleReturn,
} from '../../services/sales';
import {
  customerPaymentsApi,
  type CustomerPayment,
  type CreateCustomerPaymentInput,
} from '../../services/customerPayments';
import { crmService } from '../../services/crmService';
import type {
  LoyaltyTransaction,
  CustomerInteraction,
  InteractionType,
} from '../../types/crm';
import { useModules } from '../../hooks/useModules';
import { quotationService } from '../../services/quotationService';
import { QUOTATION_STATUS_COLORS, type Quotation } from '../../types/quotation';
import WhatsAppButton from '../../components/WhatsAppButton';
import { whatsappService } from '../../services/whatsappService';
import { openWhatsApp } from '../../utils/whatsappHelper';
import axios from 'axios';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmtCents(cents: number) {
  return `Rs. ${(cents / 100).toLocaleString('en-US', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
  });
}

function fmtDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    year: 'numeric', month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const SALE_STATUS_CLS: Record<string, string> = {
  DRAFT:     'bg-slate-100 text-slate-600',
  CONFIRMED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-600',
};
const PAY_STATUS_CLS: Record<string, string> = {
  UNPAID:  'bg-red-50 text-red-600',
  PARTIAL: 'bg-amber-50 text-amber-700',
  PAID:    'bg-green-50 text-green-700',
};
const PM_LABELS: Record<string, string> = {
  CASH: 'Cash', CARD: 'Card', BANK_TRANSFER: 'Bank Transfer',
  QR_PAY: 'QR Pay', CREDIT: 'Credit', CHEQUE: 'Cheque', OTHER: 'Other',
};

// ─── CustomerModal (same form as in CustomersPage.tsx) ────────────────────────

function CustomerModal({
  title, initial, onSave, onClose, loading, error,
}: {
  title: string;
  initial?: CustomerDetail;
  onSave: (body: CustomerBody) => void;
  onClose: () => void;
  loading: boolean;
  error: string;
}) {
  const [name, setName]                   = useState(initial?.name ?? '');
  const [phone, setPhone]                 = useState(initial?.phone ?? '');
  const [email, setEmail]                 = useState(initial?.email ?? '');
  const [address, setAddress]             = useState(initial?.address ?? '');
  const [creditEnabled, setCreditEnabled] = useState(initial?.creditEnabled ?? false);
  const [creditLimit, setCreditLimit]     = useState(
    initial ? (initial.creditLimitCents / 100).toFixed(2) : '0.00',
  );
  const [alertPct, setAlertPct]       = useState(initial?.creditAlertPct ?? 80);
  const [settleDays, setSettleDays]   = useState<number | ''>(initial?.creditSettleDays ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name, phone: phone || undefined, email: email || undefined,
      address: address || undefined, creditEnabled,
      creditLimitCents: Math.round(parseFloat(creditLimit || '0') * 100),
      creditAlertPct: alertPct,
      creditSettleDays: settleDays ? parseInt(String(settleDays)) : null,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg shadow-xl overflow-y-auto max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
          )}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
              <input required value={name} onChange={(e) => setName(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. John Smith" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="+94 77 000 0000" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="email@example.com" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Address</label>
              <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="Street, City, Country" />
            </div>
          </div>
          <div className="border-t border-slate-200 pt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-semibold text-slate-700">Credit Account</span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-xs text-slate-500">{creditEnabled ? 'Enabled' : 'Disabled'}</span>
                <div onClick={() => setCreditEnabled((v) => !v)}
                  className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${creditEnabled ? 'bg-amber-500' : 'bg-slate-200'}`}>
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${creditEnabled ? 'translate-x-4' : 'translate-x-0.5'}`} />
                </div>
              </label>
            </div>
            {creditEnabled && (
              <div className="space-y-3 bg-amber-50/50 border border-amber-100 rounded-xl p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Credit Limit (Rs.)</label>
                    <input type="number" min="0" step="0.01" value={creditLimit}
                      onChange={(e) => setCreditLimit(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                      placeholder="0.00 = Unlimited" />
                    <p className="text-[10px] text-slate-400 mt-0.5">0 = no limit</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Alert Threshold (%)</label>
                    <input type="number" min="1" max="100" value={alertPct}
                      onChange={(e) => setAlertPct(Math.max(1, Math.min(100, parseInt(e.target.value) || 80)))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400" />
                    <p className="text-[10px] text-slate-400 mt-0.5">Warn at {alertPct}% of limit</p>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Settlement Period (days) <span className="text-slate-400 font-normal">— optional</span>
                  </label>
                  <input type="number" min="1" max="365" value={settleDays}
                    onChange={(e) => setSettleDays(e.target.value ? parseInt(e.target.value) : '')}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    placeholder="e.g. 30" />
                </div>
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-700">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>Requires <strong>sell_on_credit</strong> permission at POS.</span>
                </div>
              </div>
            )}
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button type="submit" disabled={loading}
              className="px-4 py-2 rounded-lg bg-blue-600 text-white text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
              {loading ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Sale View Modal (read-only) ──────────────────────────────────────────────

function SaleViewModal({ saleId, onClose }: { saleId: string; onClose: () => void }) {
  const { data: sale, isLoading } = useQuery({
    queryKey: ['sale', saleId],
    queryFn: () => salesApi.getSale(saleId),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-50">
              <Receipt className="w-4 h-4 text-indigo-600" />
            </div>
            <div>
              <h2 className="font-bold text-slate-800">{sale?.number ?? '…'}</h2>
              <p className="text-xs text-slate-400">
                {sale ? fmtDate(sale.date) : ''}
              </p>
            </div>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-5">
          {isLoading && (
            <div className="text-center py-12 text-slate-400">Loading…</div>
          )}
          {sale && (
            <>
              {/* Meta */}
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Customer</p>
                  <p className="font-medium text-slate-800">{sale.customer?.name ?? 'Walk-in'}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Warehouse</p>
                  <p className="font-medium text-slate-800">{sale.warehouse.name}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Payment</p>
                  <p className="font-medium text-slate-800">{PM_LABELS[sale.paymentMethod] ?? sale.paymentMethod}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Status</p>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${SALE_STATUS_CLS[sale.status]}`}>
                    {sale.status}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Payment Status</p>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PAY_STATUS_CLS[sale.paymentStatus]}`}>
                    {sale.paymentStatus}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Prepared by</p>
                  <p className="font-medium text-slate-800">{sale.createdBy.fullName}</p>
                </div>
              </div>

              {/* Items table */}
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Items</p>
                <div className="rounded-xl overflow-hidden border border-slate-200">
                  <table className="w-full text-sm">
                    <thead className="bg-slate-50">
                      <tr>
                        <th className="px-4 py-2.5 text-left text-xs font-semibold text-slate-500">Product</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Qty</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Unit Price</th>
                        <th className="px-4 py-2.5 text-right text-xs font-semibold text-slate-500">Total</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {(sale.lines as SaleLine[] | undefined)?.map((l) => (
                        <tr key={l.id} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-slate-800">{l.product.name}</p>
                            <p className="text-xs text-slate-400">{l.product.sku}</p>
                          </td>
                          <td className="px-4 py-2.5 text-right text-slate-700">
                            {Number(l.qty)} {l.product.unit?.shortCode}
                          </td>
                          <td className="px-4 py-2.5 text-right text-slate-700">{fmtCents(l.unitPriceCents)}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{fmtCents(l.lineTotalCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {/* Totals */}
              <div className="bg-slate-50 rounded-xl p-4 space-y-1.5 text-sm">
                <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{fmtCents(sale.subtotalCents)}</span></div>
                {sale.discountCents > 0 && (
                  <div className="flex justify-between text-slate-500"><span>Discount</span><span>− {fmtCents(sale.discountCents)}</span></div>
                )}
                <div className="flex justify-between font-bold text-base pt-2 border-t border-slate-200 text-slate-800">
                  <span>Total</span><span>{fmtCents(sale.totalCents)}</span>
                </div>
                <div className="flex justify-between text-green-600 font-medium">
                  <span>Paid</span><span>{fmtCents(sale.paidCents)}</span>
                </div>
                {sale.totalCents - sale.paidCents > 0 && (
                  <div className="flex justify-between text-red-600 font-bold">
                    <span>Balance Due</span><span>{fmtCents(sale.totalCents - sale.paidCents)}</span>
                  </div>
                )}
              </div>
            </>
          )}
        </div>

        <div className="px-6 py-4 border-t border-slate-100 flex justify-end">
          <button onClick={onClose}
            className="px-4 py-2 border border-slate-200 text-sm text-slate-600 rounded-lg hover:bg-slate-50">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Record Payment Modal ─────────────────────────────────────────────────────

function RecordPaymentModal({
  customerId, onClose,
}: {
  customerId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  // Fetch outstanding sales for this customer
  const { data: salesData, isLoading: salesLoading } = useQuery({
    queryKey: ['customer-outstanding-sales', customerId],
    queryFn: () => salesApi.listSales({
      customerId, status: 'CONFIRMED', pageSize: 100,
    }),
  });

  const outstandingSales = (salesData?.data ?? []).filter(
    (s) => s.paymentStatus === 'UNPAID' || s.paymentStatus === 'PARTIAL',
  );

  const [saleId, setSaleId]       = useState('');
  const [amount, setAmount]       = useState('');
  const [method, setMethod]       = useState('CASH');
  const [refNo, setRefNo]         = useState('');
  const [bank, setBank]           = useState('');
  const [date, setDate]           = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes]         = useState('');
  const [error, setError]         = useState('');

  // Auto-fill amount when sale selected
  const selectedSale = outstandingSales.find((s) => s.id === saleId);
  const outstanding  = selectedSale ? selectedSale.totalCents - selectedSale.paidCents : 0;

  const mutation = useMutation({
    mutationFn: (data: CreateCustomerPaymentInput) => customerPaymentsApi.create(data),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-payments-by', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer-detail', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer-sales', customerId] });
      onClose();
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg ?? 'Failed to record payment');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!saleId) { setError('Select an invoice'); return; }
    const amountCents = Math.round(parseFloat(amount) * 100);
    if (!amountCents || amountCents <= 0) { setError('Enter a valid amount'); return; }
    if (outstanding > 0 && amountCents > outstanding) {
      setError(`Amount exceeds outstanding balance of ${fmtCents(outstanding)}`);
      return;
    }
    mutation.mutate({
      saleId, amountCents, paymentMethod: method,
      referenceNo: refNo || undefined, bankName: bank || undefined,
      paymentDate: date, notes: notes || undefined,
    });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-800">Record Payment</h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
          )}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Invoice *</label>
            {salesLoading ? (
              <p className="text-sm text-slate-400">Loading outstanding invoices…</p>
            ) : outstandingSales.length === 0 ? (
              <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                No outstanding invoices for this customer.
              </p>
            ) : (
              <select value={saleId} onChange={(e) => { setSaleId(e.target.value); const s = outstandingSales.find(x => x.id === e.target.value); if (s) setAmount(((s.totalCents - s.paidCents) / 100).toFixed(2)); }}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                <option value="">— Select invoice —</option>
                {outstandingSales.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.number} · Outstanding: {fmtCents(s.totalCents - s.paidCents)}
                  </option>
                ))}
              </select>
            )}
            {outstanding > 0 && (
              <p className="text-xs text-amber-600 mt-0.5">Outstanding: {fmtCents(outstanding)}</p>
            )}
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Amount (Rs.) *</label>
              <input type="number" min="0.01" step="0.01" value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="0.00" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Method *</label>
              <select value={method} onChange={(e) => setMethod(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                {Object.entries(PM_LABELS).map(([v, l]) => (
                  <option key={v} value={v}>{l}</option>
                ))}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Reference No</label>
              <input value={refNo} onChange={(e) => setRefNo(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="Cheque / bank ref" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Date *</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            </div>
          </div>

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="Optional note" />
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button type="submit" disabled={mutation.isPending || outstandingSales.length === 0}
              className="px-4 py-2 rounded-lg bg-indigo-600 text-white text-sm font-medium hover:bg-indigo-700 disabled:opacity-60">
              {mutation.isPending ? 'Saving…' : 'Record Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  icon, label, value, sub, accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: 'green' | 'orange' | 'red' | 'slate' | 'indigo';
}) {
  const colors: Record<string, string> = {
    green:  'bg-green-50  text-green-600',
    orange: 'bg-amber-50  text-amber-600',
    red:    'bg-red-50    text-red-600',
    slate:  'bg-slate-100 text-slate-500',
    indigo: 'bg-indigo-50 text-indigo-600',
  };
  const cls = colors[accent ?? 'slate'];
  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 flex items-start gap-4">
      <div className={`p-3 rounded-xl ${cls}`}>{icon}</div>
      <div>
        <p className="text-xs text-slate-500 font-medium mb-0.5">{label}</p>
        <p className="text-lg font-bold text-slate-800 leading-tight">{value}</p>
        {sub && <p className="text-xs text-slate-400 mt-0.5">{sub}</p>}
      </div>
    </div>
  );
}

// ─── Sales Tab ────────────────────────────────────────────────────────────────

function SalesTab({
  customerId, onViewSale,
}: {
  customerId: string;
  onViewSale: (id: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['customer-sales', customerId],
    queryFn: () => salesApi.listSales({ customerId, pageSize: 50, includePos: 'true' }),
  });
  const sales = data?.data ?? [];

  if (isLoading) return <div className="text-center py-12 text-slate-400">Loading…</div>;
  if (sales.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        <Receipt size={36} className="mx-auto mb-3 text-slate-300" />
        <p className="font-medium text-slate-500">No sales yet</p>
        <p className="text-sm mt-1">Sales for this customer will appear here</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Invoice</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Items</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Total</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Paid</th>
            <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
            <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {sales.map((sale) => (
            <tr key={sale.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{fmtDate(sale.date)}</td>
              <td className="px-4 py-3">
                <button onClick={() => onViewSale(sale.id)}
                  className="font-mono font-semibold text-indigo-600 hover:text-indigo-800 hover:underline">
                  {sale.number}
                </button>
                {sale.isPos && (
                  <span className="ml-1.5 text-[10px] bg-purple-100 text-purple-600 px-1.5 py-0.5 rounded font-medium">POS</span>
                )}
              </td>
              <td className="px-4 py-3 text-right text-slate-600">
                {sale._count?.lines ?? '—'}
              </td>
              <td className="px-4 py-3 text-right font-medium text-slate-800 whitespace-nowrap">
                {fmtCents(sale.totalCents)}
              </td>
              <td className="px-4 py-3 text-right font-medium text-emerald-600 whitespace-nowrap">
                {fmtCents(sale.paidCents)}
              </td>
              <td className="px-4 py-3 text-center">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PAY_STATUS_CLS[sale.paymentStatus]}`}>
                  {sale.paymentStatus}
                </span>
              </td>
              <td className="px-4 py-3 text-center">
                <button onClick={() => onViewSale(sale.id)}
                  className="p-1.5 rounded hover:bg-indigo-50 text-slate-400 hover:text-indigo-600 transition-colors"
                  title="View invoice">
                  <ChevronRight size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(data?.total ?? 0) > 50 && (
        <p className="text-xs text-slate-400 text-center py-3">
          Showing first 50 of {data?.total} invoices
        </p>
      )}
    </div>
  );
}

// ─── Payments Tab ─────────────────────────────────────────────────────────────

function PaymentsTab({ customerId }: { customerId: string }) {
  const { data: payments = [], isLoading } = useQuery({
    queryKey: ['customer-payments-by', customerId],
    queryFn: () => customerPaymentsApi.listByCustomer(customerId),
  });

  if (isLoading) return <div className="text-center py-12 text-slate-400">Loading…</div>;
  if (payments.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        <Wallet size={36} className="mx-auto mb-3 text-slate-300" />
        <p className="font-medium text-slate-500">No payments recorded</p>
        <p className="text-sm mt-1">Payments against invoices will appear here</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Reference</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Amount</th>
            <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Method</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Note</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {payments.map((p) => (
            <tr key={p.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{fmtDate(p.paymentDate)}</td>
              <td className="px-4 py-3">
                <p className="font-mono text-xs text-slate-600">{p.paymentNumber}</p>
                {p.referenceNo && <p className="text-xs text-slate-400">{p.referenceNo}</p>}
              </td>
              <td className="px-4 py-3 text-right font-semibold text-emerald-600 whitespace-nowrap">
                {fmtCents(p.amountCents)}
              </td>
              <td className="px-4 py-3 text-center">
                <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">
                  {PM_LABELS[p.paymentMethod] ?? p.paymentMethod}
                </span>
              </td>
              <td className="px-4 py-3 text-slate-500 text-xs">{p.notes ?? '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Returns Tab ──────────────────────────────────────────────────────────────

function ReturnsTab({ customerId }: { customerId: string }) {
  const { data, isLoading } = useQuery({
    queryKey: ['customer-returns', customerId],
    queryFn: () => salesApi.listReturns({ customerId, pageSize: 50 }),
  });
  const returns: SaleReturn[] = data?.data ?? [];

  if (isLoading) return <div className="text-center py-12 text-slate-400">Loading…</div>;
  if (returns.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        <RotateCcw size={36} className="mx-auto mb-3 text-slate-300" />
        <p className="font-medium text-slate-500">No returns</p>
        <p className="text-sm mt-1">Returns linked to this customer's invoices will appear here</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Return No</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Against Invoice</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Items</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Refund</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {returns.map((ret) => (
            <tr key={ret.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{fmtDate(ret.createdAt)}</td>
              <td className="px-4 py-3">
                <span className="font-mono font-semibold text-rose-600">{ret.number}</span>
              </td>
              <td className="px-4 py-3 text-slate-600 font-mono text-xs">{ret.sale.number}</td>
              <td className="px-4 py-3 text-right text-slate-600">
                {ret._count?.lines ?? '—'}
              </td>
              <td className="px-4 py-3 text-right font-semibold text-rose-600 whitespace-nowrap">
                − {fmtCents(ret.totalCents)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── Account Info Tab ─────────────────────────────────────────────────────────

function AccountInfoTab({
  customer, onEdit,
}: {
  customer: CustomerDetail;
  onEdit: () => void;
}) {
  return (
    <div className="space-y-6 max-w-lg">
      {/* Contact details */}
      <div className="bg-slate-50 rounded-xl p-5 space-y-3">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Contact Details</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Full Name</p>
            <p className="font-medium text-slate-800">{customer.name}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Phone</p>
            <p className="font-medium text-slate-800">{customer.phone ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Email</p>
            <p className="font-medium text-slate-800">{customer.email ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Status</p>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${customer.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
              {customer.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
          {customer.address && (
            <div className="col-span-2">
              <p className="text-xs text-slate-400 mb-0.5">Address</p>
              <p className="font-medium text-slate-800">{customer.address}</p>
            </div>
          )}
        </div>
      </div>

      {/* Credit account */}
      <div className="bg-slate-50 rounded-xl p-5 space-y-3">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Credit Account</h3>
        {customer.creditEnabled ? (
          <div className="grid grid-cols-2 gap-4 text-sm">
            <div>
              <p className="text-xs text-slate-400 mb-0.5">Status</p>
              <span className="flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full w-fit font-medium">
                <ShieldCheck className="w-3 h-3" /> Enabled
              </span>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-0.5">Credit Limit</p>
              <p className="font-medium text-slate-800">
                {customer.creditLimitCents > 0 ? fmtCents(customer.creditLimitCents) : 'Unlimited'}
              </p>
            </div>
            <div>
              <p className="text-xs text-slate-400 mb-0.5">Alert Threshold</p>
              <p className="font-medium text-slate-800">{customer.creditAlertPct}%</p>
            </div>
            {customer.creditSettleDays && (
              <div>
                <p className="text-xs text-slate-400 mb-0.5">Settle Within</p>
                <p className="font-medium text-slate-800">{customer.creditSettleDays} days</p>
              </div>
            )}
          </div>
        ) : (
          <p className="text-sm text-slate-400">Credit account disabled</p>
        )}
      </div>

      {/* Member since */}
      <div className="bg-slate-50 rounded-xl p-5">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Membership</h3>
        <p className="text-sm text-slate-700">
          Member since{' '}
          <span className="font-medium">{fmtDate(customer.createdAt)}</span>
        </p>
        {customer.lastPurchaseDate && (
          <p className="text-sm text-slate-500 mt-1">
            Last purchase:{' '}
            <span className="font-medium">{fmtDate(customer.lastPurchaseDate)}</span>
          </p>
        )}
      </div>

      <div>
        <button onClick={onEdit}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
          <Pencil size={14} /> Edit Customer
        </button>
      </div>
    </div>
  );
}

// ─── Loyalty Tab (crm) ──────────────────────────────────────────────────────

const LOYALTY_TXN_CLS: Record<string, string> = {
  EARN:   'bg-emerald-50 text-emerald-700',
  REDEEM: 'bg-rose-50 text-rose-600',
  ADJUST: 'bg-indigo-50 text-indigo-700',
};

function LoyaltyTab({ customerId }: { customerId: string }) {
  const queryClient = useQueryClient();
  const [adjustPoints, setAdjustPoints] = useState('');
  const [adjustNote, setAdjustNote]     = useState('');
  const [adjustError, setAdjustError]   = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['customer-loyalty', customerId],
    queryFn:  () => crmService.getCustomerLoyalty(customerId),
  });

  const adjustMutation = useMutation({
    mutationFn: () => crmService.adjustPoints(customerId, parseInt(adjustPoints, 10), adjustNote.trim()),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-loyalty', customerId] });
      queryClient.invalidateQueries({ queryKey: ['customer-detail', customerId] });
      setAdjustPoints('');
      setAdjustNote('');
      setAdjustError('');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setAdjustError(msg ?? 'Failed to adjust points');
    },
  });

  const submitAdjust = () => {
    const n = parseInt(adjustPoints, 10);
    if (!Number.isInteger(n) || n === 0) { setAdjustError('Enter a non-zero whole number'); return; }
    if (!adjustNote.trim()) { setAdjustError('A note is required'); return; }
    adjustMutation.mutate();
  };

  if (isLoading) return <div className="text-center py-12 text-slate-400">Loading…</div>;
  if (!data) return <div className="text-center py-12 text-slate-400">No loyalty data</div>;

  const txns: LoyaltyTransaction[] = data.transactions ?? [];

  return (
    <div className="p-5 space-y-5">
      {!data.isEnabled && (
        <div className="bg-amber-50 border border-amber-200 text-amber-800 text-sm rounded-lg px-4 py-2.5">
          The loyalty program is currently disabled. Existing balances are preserved but no new points are earned.
        </div>
      )}

      <div className="grid grid-cols-2 lg:grid-cols-3 gap-4">
        <div className="bg-emerald-50 border border-emerald-100 rounded-xl px-4 py-3">
          <p className="text-xs text-emerald-700 font-medium">Points Balance</p>
          <p className="text-2xl font-bold text-emerald-800">{data.loyaltyPoints.toLocaleString()}</p>
        </div>
        <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3">
          <p className="text-xs text-indigo-700 font-medium">Cash Value</p>
          <p className="text-2xl font-bold text-indigo-800">{fmtCents(data.valueCents)}</p>
        </div>
        <div className="bg-slate-50 border border-slate-100 rounded-xl px-4 py-3">
          <p className="text-xs text-slate-500 font-medium">Min. to Redeem</p>
          <p className="text-2xl font-bold text-slate-700">{data.minRedeemPoints.toLocaleString()}</p>
        </div>
      </div>

      {/* Manual adjustment */}
      <div className="border border-slate-200 rounded-xl p-4">
        <p className="text-sm font-semibold text-slate-700 mb-3">Adjust Points</p>
        <div className="flex flex-wrap items-start gap-2">
          <input
            type="number"
            value={adjustPoints}
            onChange={(e) => setAdjustPoints(e.target.value)}
            placeholder="± points"
            className="w-28 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
          <input
            type="text"
            value={adjustNote}
            onChange={(e) => setAdjustNote(e.target.value)}
            placeholder="Reason (required)"
            className="flex-1 min-w-[180px] border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
          />
          <button
            onClick={submitAdjust}
            disabled={adjustMutation.isPending}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            Apply
          </button>
        </div>
        {adjustError && <p className="text-xs text-red-600 mt-2">{adjustError}</p>}
        <p className="text-xs text-slate-400 mt-2">Use a positive number to grant points, negative to deduct. The balance cannot go below zero.</p>
      </div>

      {/* Transactions */}
      {txns.length === 0 ? (
        <div className="text-center py-10 text-slate-400">
          <Star size={32} className="mx-auto mb-2 text-slate-300" />
          <p className="text-sm">No loyalty transactions yet</p>
        </div>
      ) : (
        <div className="overflow-x-auto border border-slate-200 rounded-xl">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Type</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Points</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Balance</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Note</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {txns.map((t) => (
                <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                  <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{fmtDateTime(t.createdAt)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs px-2 py-0.5 rounded font-medium ${LOYALTY_TXN_CLS[t.type] ?? 'bg-slate-100 text-slate-600'}`}>
                      {t.type}
                    </span>
                  </td>
                  <td className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${t.points >= 0 ? 'text-emerald-600' : 'text-rose-600'}`}>
                    {t.points >= 0 ? '+' : ''}{t.points.toLocaleString()}
                  </td>
                  <td className="px-4 py-3 text-right text-slate-600 whitespace-nowrap">{t.balanceAfter.toLocaleString()}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs">{t.note ?? '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// ─── Interactions Tab (crm) ─────────────────────────────────────────────────

const INTERACTION_TYPES: { value: InteractionType; label: string }[] = [
  { value: 'NOTE',             label: 'Note' },
  { value: 'CALL',             label: 'Call' },
  { value: 'VISIT',            label: 'Visit' },
  { value: 'PAYMENT_REMINDER', label: 'Payment Reminder' },
  { value: 'OTHER',            label: 'Other' },
];

function InteractionsTab({ customerId }: { customerId: string }) {
  const queryClient = useQueryClient();
  const [type, setType]           = useState<InteractionType>('NOTE');
  const [note, setNote]           = useState('');
  const [followUpAt, setFollowUp] = useState('');
  const [formError, setFormError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['customer-interactions', customerId],
    queryFn:  () => crmService.getInteractions(customerId),
  });

  const addMutation = useMutation({
    mutationFn: () => crmService.addInteraction({
      customerId,
      type,
      note: note.trim(),
      followUpAt: followUpAt ? new Date(followUpAt).toISOString() : null,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['customer-interactions', customerId] });
      setNote('');
      setFollowUp('');
      setType('NOTE');
      setFormError('');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setFormError(msg ?? 'Failed to save interaction');
    },
  });

  const doneMutation = useMutation({
    mutationFn: (interactionId: string) => crmService.markInteractionDone(interactionId),
    onSuccess: () => queryClient.invalidateQueries({ queryKey: ['customer-interactions', customerId] }),
  });

  const submit = () => {
    if (!note.trim()) { setFormError('A note is required'); return; }
    addMutation.mutate();
  };

  const interactions: CustomerInteraction[] = data ?? [];

  return (
    <div className="p-5 space-y-5">
      {/* Add interaction */}
      <div className="border border-slate-200 rounded-xl p-4 space-y-3">
        <p className="text-sm font-semibold text-slate-700">Log Interaction</p>
        <div className="flex flex-wrap gap-2">
          <select
            value={type}
            onChange={(e) => setType(e.target.value as InteractionType)}
            className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
          >
            {INTERACTION_TYPES.map((t) => <option key={t.value} value={t.value}>{t.label}</option>)}
          </select>
          <div className="flex items-center gap-1.5">
            <label className="text-xs text-slate-500">Follow-up</label>
            <input
              type="datetime-local"
              value={followUpAt}
              onChange={(e) => setFollowUp(e.target.value)}
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>
        </div>
        <textarea
          value={note}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What happened? (required)"
          rows={2}
          className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
        />
        {formError && <p className="text-xs text-red-600">{formError}</p>}
        <div className="flex justify-end">
          <button
            onClick={submit}
            disabled={addMutation.isPending}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      {/* List */}
      {isLoading ? (
        <div className="text-center py-12 text-slate-400">Loading…</div>
      ) : interactions.length === 0 ? (
        <div className="text-center py-10 text-slate-400">
          <MessageSquare size={32} className="mx-auto mb-2 text-slate-300" />
          <p className="text-sm">No interactions logged yet</p>
        </div>
      ) : (
        <div className="space-y-2">
          {interactions.map((it) => {
            const overdue = it.followUpAt && !it.isDone && new Date(it.followUpAt) <= new Date();
            return (
              <div key={it.id} className="border border-slate-200 rounded-xl p-4 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex items-center gap-2 mb-1">
                    <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">
                      {INTERACTION_TYPES.find((t) => t.value === it.type)?.label ?? it.type}
                    </span>
                    <span className="text-xs text-slate-400">{fmtDateTime(it.createdAt)}</span>
                  </div>
                  <p className="text-sm text-slate-700 whitespace-pre-wrap break-words">{it.note}</p>
                  {it.followUpAt && (
                    <p className={`text-xs mt-1.5 font-medium ${it.isDone ? 'text-slate-400' : overdue ? 'text-rose-600' : 'text-amber-600'}`}>
                      Follow-up: {fmtDateTime(it.followUpAt)}{it.isDone ? ' · done' : overdue ? ' · overdue' : ''}
                    </p>
                  )}
                </div>
                {it.followUpAt && !it.isDone && (
                  <button
                    onClick={() => doneMutation.mutate(it.id)}
                    disabled={doneMutation.isPending}
                    className="flex items-center gap-1 px-2.5 py-1.5 border border-slate-200 text-slate-600 rounded-lg text-xs hover:bg-slate-50 disabled:opacity-50 transition-colors shrink-0"
                  >
                    <Check size={12} /> Mark done
                  </button>
                )}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type TabKey = 'sales' | 'payments' | 'returns' | 'account' | 'loyalty' | 'interactions' | 'quotes';

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'sales',    label: 'Sales History', icon: <Receipt   size={14} /> },
  { key: 'payments', label: 'Payments',      icon: <Wallet    size={14} /> },
  { key: 'returns',  label: 'Returns',       icon: <RotateCcw size={14} /> },
  { key: 'account',  label: 'Account Info',  icon: <Users     size={14} /> },
];

// Quotes tab — appended only when the 'quotations' module is enabled.
const QUOTES_TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'quotes', label: 'Quotes', icon: <FileText size={14} /> },
];

// CRM tabs — appended only when the 'crm' module is enabled.
const CRM_TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'loyalty',      label: 'Loyalty',      icon: <Star          size={14} /> },
  { key: 'interactions', label: 'Interactions', icon: <MessageSquare size={14} /> },
];

// ─── Quotes Tab ─────────────────────────────────────────────────────────────

function QuotesTab({ customerId }: { customerId: string }) {
  const navigate = useNavigate();
  const money = (cents: number) => `Rs. ${(cents / 100).toFixed(2)}`;
  const { data: quotes = [], isLoading } = useQuery<Quotation[]>({
    queryKey: ['customer-quotes', customerId],
    queryFn: () => quotationService.list({ customerId }),
  });

  if (isLoading) return <div className="p-6 text-sm text-slate-400">Loading…</div>;
  if (quotes.length === 0) {
    return (
      <div className="text-center py-12 text-slate-400">
        <FileText className="w-10 h-10 mx-auto text-slate-200 mb-2" />
        <p className="text-sm">No quotations for this customer yet</p>
      </div>
    );
  }

  return (
    <table className="w-full text-sm">
      <thead className="bg-slate-50">
        <tr>
          <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">Number</th>
          <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">Title</th>
          <th className="px-5 py-3 text-center text-xs font-semibold text-slate-500">Status</th>
          <th className="px-5 py-3 text-right text-xs font-semibold text-slate-500">Total</th>
          <th className="px-5 py-3 text-left text-xs font-semibold text-slate-500">Created</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-slate-100">
        {quotes.map((q) => (
          <tr key={q.id} onClick={() => navigate(`/quotations/${q.id}`)} className="hover:bg-slate-50 cursor-pointer">
            <td className="px-5 py-3 font-mono font-semibold text-indigo-600">{q.number}</td>
            <td className="px-5 py-3 text-slate-500 max-w-[220px] truncate">{q.title ?? '—'}</td>
            <td className="px-5 py-3 text-center">
              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${QUOTATION_STATUS_COLORS[q.status]}`}>
                {q.status.charAt(0) + q.status.slice(1).toLowerCase()}
              </span>
            </td>
            <td className="px-5 py-3 text-right font-semibold text-slate-800">{money(q.totalCents)}</td>
            <td className="px-5 py-3 text-slate-400 text-xs">{new Date(q.createdAt).toLocaleDateString('en-GB')}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const { isModuleEnabled } = useModules();
  const crmEnabled = isModuleEnabled('crm');
  const quotesEnabled = isModuleEnabled('quotations');
  const visibleTabs = [
    ...TABS,
    ...(quotesEnabled ? QUOTES_TABS : []),
    ...(crmEnabled ? CRM_TABS : []),
  ];

  const [tab, setTab]             = useState<TabKey>('sales');
  const [editOpen, setEditOpen]   = useState(false);
  const [editError, setEditError] = useState('');
  const [paymentOpen, setPaymentOpen]   = useState(false);
  const [viewSaleId, setViewSaleId]     = useState<string | null>(null);
  const [waLoading, setWaLoading]       = useState(false);
  const [waMsg, setWaMsg]               = useState<{ ok: boolean; text: string } | null>(null);

  // Send a payment reminder to the customer's WhatsApp. WEB mode opens wa.me;
  // API mode dispatches automatically. Errors are surfaced inline.
  const handleSendReminder = async () => {
    if (!id) return;
    setWaLoading(true);
    setWaMsg(null);
    try {
      const result = await whatsappService.sendReminder(id);
      if (result.mode === 'WEB' && result.waLink) {
        openWhatsApp(result.waLink);
        setWaMsg({ ok: true, text: 'WhatsApp opened with the reminder.' });
      } else if (result.success) {
        setWaMsg({ ok: true, text: 'Reminder sent via WhatsApp.' });
      } else {
        setWaMsg({ ok: false, text: result.error ?? 'Failed to send.' });
      }
    } catch (err) {
      const msg = axios.isAxiosError(err) ? err.response?.data?.message : null;
      setWaMsg({ ok: false, text: msg ?? 'Could not send reminder.' });
    } finally {
      setWaLoading(false);
    }
  };

  const { data: customer, isLoading } = useQuery({
    queryKey: ['customer-detail', id],
    queryFn: () => customersApi.getOne(id!),
    enabled: !!id,
  });

  const updateMutation = useMutation({
    mutationFn: (body: CustomerBody) => customersApi.update(id!, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(['customer-detail', id], (prev: CustomerDetail | undefined) =>
        prev ? { ...prev, ...updated } : prev,
      );
      queryClient.invalidateQueries({ queryKey: ['customers'] });
      setEditOpen(false);
      setEditError('');
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setEditError(msg ?? 'Failed to save');
    },
  });

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <div className="text-center">
          <div className="w-8 h-8 border-2 border-indigo-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm">Loading customer…</p>
        </div>
      </div>
    );
  }

  if (!customer) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <div className="text-center">
          <Users size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="font-medium text-slate-600">Customer not found</p>
          <button onClick={() => navigate('/customers')}
            className="mt-3 text-sm text-indigo-600 hover:underline">← Back to Customers</button>
        </div>
      </div>
    );
  }

  const outstanding = customer.outstandingBalance;
  const creditPct   = customer.creditEnabled && customer.creditLimitCents > 0
    ? Math.min(100, Math.round((customer.creditUsedCents / customer.creditLimitCents) * 100))
    : null;

  return (
    <div className="p-6 space-y-6">

      {/* ── Page Header ────────────────────────────────────────────────────────── */}
      <div>
        <button onClick={() => navigate('/customers')}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4 transition-colors">
          <ArrowLeft size={14} /> Customers
        </button>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-indigo-100 flex items-center justify-center shrink-0">
              <span className="text-indigo-600 font-bold text-xl">
                {customer.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-800">{customer.name}</h1>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${customer.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                  {customer.isActive ? 'Active' : 'Inactive'}
                </span>
                {customer.creditEnabled && (
                  <span className="flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2.5 py-1 rounded-full font-medium">
                    <ShieldCheck size={10} /> Credit
                  </span>
                )}
                {crmEnabled && customer.priceTier && (
                  <span className="text-xs bg-emerald-100 text-emerald-700 px-2.5 py-1 rounded-full font-medium">
                    {customer.priceTier.name}
                  </span>
                )}
                {crmEnabled && (customer.loyaltyPoints ?? 0) > 0 && (
                  <span className="flex items-center gap-1 text-xs bg-indigo-100 text-indigo-700 px-2.5 py-1 rounded-full font-medium">
                    <Star size={10} /> {(customer.loyaltyPoints ?? 0).toLocaleString()} pts
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                {customer.phone && <span>{customer.phone}</span>}
                {customer.phone && customer.email && <span>·</span>}
                {customer.email && <span>{customer.email}</span>}
                {customer._count.sales > 0 && (
                  <>
                    <span>·</span>
                    <span>{customer._count.sales} sale{customer._count.sales !== 1 ? 's' : ''}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => navigate('/sales')}
              className="flex items-center gap-1.5 px-3 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
              <Plus size={14} /> New Sale
            </button>
            <button onClick={() => setPaymentOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50 transition-colors">
              <CreditCard size={14} /> Record Payment
            </button>
            {outstanding > 0 && customer.phone && (
              <div className="flex flex-col items-end gap-0.5">
                <WhatsAppButton
                  label="Send Reminder"
                  onClick={handleSendReminder}
                  isLoading={waLoading}
                />
                {waMsg && (
                  <span className={`text-[10px] ${waMsg.ok ? 'text-emerald-600' : 'text-red-600'}`}>{waMsg.text}</span>
                )}
              </div>
            )}
            <button onClick={() => { setEditError(''); setEditOpen(true); }}
              className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50 transition-colors">
              <Pencil size={14} /> Edit
            </button>
          </div>
        </div>
      </div>

      {/* ── Summary Cards ──────────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          icon={<Receipt size={20} />}
          label="Total Purchases"
          value={fmtCents(customer.totalSalesAmount)}
          sub={`${customer._count.sales} invoice${customer._count.sales !== 1 ? 's' : ''}`}
          accent="indigo"
        />
        <StatCard
          icon={<Check size={20} />}
          label="Total Paid"
          value={fmtCents(customer.totalPaid)}
          accent="green"
        />
        <StatCard
          icon={outstanding > 0 ? <AlertTriangle size={20} /> : <DollarSign size={20} />}
          label="Outstanding Balance"
          value={fmtCents(outstanding)}
          sub={outstanding === 0 ? 'All invoices settled' : undefined}
          accent={outstanding > 0 ? 'orange' : 'green'}
        />
        {customer.creditEnabled ? (
          <StatCard
            icon={<ShieldCheck size={20} />}
            label="Credit Used"
            value={fmtCents(customer.creditUsedCents)}
            sub={
              customer.creditLimitCents > 0
                ? `${creditPct}% of ${fmtCents(customer.creditLimitCents)}`
                : 'Limit: Unlimited'
            }
            accent={creditPct !== null && creditPct >= (customer.creditAlertPct ?? 80) ? 'orange' : 'slate'}
          />
        ) : (
          <StatCard
            icon={<TrendingDown size={20} />}
            label="Credit Account"
            value="Disabled"
            accent="slate"
          />
        )}
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {/* Tab bar */}
        <div className="flex border-b border-slate-200">
          {visibleTabs.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-5 py-3.5 text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'border-b-2 border-indigo-600 text-indigo-600'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        {/* Tab content */}
        <div className="min-h-[300px]">
          {tab === 'sales'    && <SalesTab    customerId={id!} onViewSale={setViewSaleId} />}
          {tab === 'payments' && <PaymentsTab customerId={id!} />}
          {tab === 'returns'  && <ReturnsTab  customerId={id!} />}
          {tab === 'account'  && <AccountInfoTab customer={customer} onEdit={() => { setEditError(''); setEditOpen(true); }} />}
          {quotesEnabled && tab === 'quotes'    && <QuotesTab       customerId={id!} />}
          {crmEnabled && tab === 'loyalty'      && <LoyaltyTab      customerId={id!} />}
          {crmEnabled && tab === 'interactions' && <InteractionsTab customerId={id!} />}
        </div>
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────────── */}
      {editOpen && (
        <CustomerModal
          title="Edit Customer"
          initial={customer}
          onSave={(body) => updateMutation.mutate(body)}
          onClose={() => setEditOpen(false)}
          loading={updateMutation.isPending}
          error={editError}
        />
      )}

      {paymentOpen && (
        <RecordPaymentModal
          customerId={id!}
          onClose={() => setPaymentOpen(false)}
        />
      )}

      {viewSaleId && (
        <SaleViewModal
          saleId={viewSaleId}
          onClose={() => setViewSaleId(null)}
        />
      )}
    </div>
  );
}
