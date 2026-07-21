import React, { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft, Pencil, Plus, X, Check,
  Truck, AlertTriangle, Receipt, RotateCcw,
  DollarSign, TrendingDown, Wallet, ChevronRight,
  Package, Layers,
} from 'lucide-react';
import {
  suppliersApi,
  type SupplierDetail,
  type ContactBody,
} from '../../services/contacts';
import {
  purchasesApi,
  type Purchase,
  type PurchaseLine,
} from '../../services/purchases';
import {
  supplierPaymentsApi,
  type SupplierPaymentMethod,
  type LumpSumSupplierPaymentResult,
  type ApplyCreditSupplierResult,
  SPAY_METHOD_LABELS,
} from '../../services/supplierPayments';
import type { SupplierPayment } from '../../services/purchases';
import {
  purchaseReturnsApi,
  type PurchaseReturn,
  RETURN_STATUS_COLORS,
  RETURN_STATUS_LABELS,
} from '../../services/purchaseReturns';
import {
  fillTemplate, openWhatsApp,
  DEFAULT_PAYABLE_TEMPLATE,
} from '../../utils/whatsapp';
import { useAppSettings } from '../../context/SettingsContext';

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

const PO_STATUS_CLS: Record<string, string> = {
  DRAFT:     'bg-slate-100 text-slate-600',
  CONFIRMED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-red-100 text-red-600',
};
const PAY_STATUS_CLS: Record<string, string> = {
  UNPAID:  'bg-red-50 text-red-600',
  PARTIAL: 'bg-amber-50 text-amber-700',
  PAID:    'bg-green-50 text-green-700',
};
const SPAY_LABELS: Record<string, string> = {
  CASH: 'Cash', CHEQUE: 'Cheque', BANK_TRANSFER: 'Bank Transfer',
  CARD: 'Card', QR_PAY: 'QR Pay', OTHER: 'Other',
};

// ─── Supplier Modal (ContactBody — no credit fields) ──────────────────────────

function SupplierModal({
  title, initial, onSave, onClose, loading, error,
}: {
  title: string;
  initial?: SupplierDetail;
  onSave: (body: ContactBody) => void;
  onClose: () => void;
  loading: boolean;
  error: string;
}) {
  const [name, setName]       = useState(initial?.name ?? '');
  const [phone, setPhone]     = useState(initial?.phone ?? '');
  const [email, setEmail]     = useState(initial?.email ?? '');
  const [address, setAddress] = useState(initial?.address ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name,
      phone: phone || undefined,
      email: email || undefined,
      address: address || undefined,
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
                placeholder="e.g. ABC Traders" />
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

// ─── Purchase View Modal (read-only) ─────────────────────────────────────────

function PurchaseViewModal({ poId, onClose }: { poId: string; onClose: () => void }) {
  const { data: po, isLoading } = useQuery({
    queryKey: ['purchase', poId],
    queryFn: () => purchasesApi.getPurchase(poId),
  });

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-2xl shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-emerald-50">
              <Package className="w-4 h-4 text-emerald-600" />
            </div>
            <div>
              <h2 className="font-bold text-slate-800">{po?.number ?? '…'}</h2>
              <p className="text-xs text-slate-400">{po ? fmtDate(po.date) : ''}</p>
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
          {po && (
            <>
              <div className="grid grid-cols-3 gap-4 text-sm">
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Supplier</p>
                  <p className="font-medium text-slate-800">{po.supplier.name}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Warehouse</p>
                  <p className="font-medium text-slate-800">{po.warehouse.name}</p>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Status</p>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PO_STATUS_CLS[po.status]}`}>
                    {po.status}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Payment</p>
                  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${PAY_STATUS_CLS[po.paymentStatus]}`}>
                    {po.paymentStatus}
                  </span>
                </div>
                <div>
                  <p className="text-xs text-slate-400 mb-0.5">Prepared by</p>
                  <p className="font-medium text-slate-800">{po.createdBy.fullName}</p>
                </div>
              </div>

              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Items</p>
                <div className="rounded-xl overflow-hidden border border-slate-200">
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
                      {(po.lines as PurchaseLine[] | undefined)?.map((l) => (
                        <tr key={l.id} className="hover:bg-slate-50">
                          <td className="px-4 py-2.5">
                            <p className="font-medium text-slate-800">{l.product.name}</p>
                            <p className="text-xs text-slate-400">{l.product.sku}</p>
                          </td>
                          <td className="px-4 py-2.5 text-right text-slate-700">{Number(l.qty)}</td>
                          <td className="px-4 py-2.5 text-right text-slate-700">{fmtCents(l.unitCostCents)}</td>
                          <td className="px-4 py-2.5 text-right font-semibold text-slate-800">{fmtCents(l.lineTotalCents)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {(() => {
                // Option B — totalCents is never mutated; subtract confirmed return
                // credit from the displayed balance only.
                const returnedCents = (po.purchaseReturns ?? []).reduce((s, r) => s + r.totalCents, 0);
                const balanceDue = Math.max(0, po.totalCents - po.paidCents - returnedCents);
                return (
              <div className="bg-slate-50 rounded-xl p-4 space-y-1.5 text-sm">
                <div className="flex justify-between text-slate-500"><span>Subtotal</span><span>{fmtCents(po.subtotalCents)}</span></div>
                <div className="flex justify-between font-bold text-base pt-2 border-t border-slate-200 text-slate-800">
                  <span>Total</span><span>{fmtCents(po.totalCents)}</span>
                </div>
                <div className="flex justify-between text-green-600 font-medium">
                  <span>Paid</span><span>{fmtCents(po.paidCents)}</span>
                </div>
                {returnedCents > 0 && (
                  <div className="flex justify-between text-xs text-green-600">
                    <span>Incl. return credit</span><span>Rs.{(returnedCents / 100).toFixed(2)}</span>
                  </div>
                )}
                {balanceDue > 0 && (
                  <div className="flex justify-between text-red-600 font-bold">
                    <span>Balance Due</span><span>{fmtCents(balanceDue)}</span>
                  </div>
                )}
              </div>
                );
              })()}
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

// ─── Stat Card ────────────────────────────────────────────────────────────────

function StatCard({
  icon, label, value, sub, accent,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string;
  accent?: 'green' | 'orange' | 'red' | 'slate' | 'indigo' | 'emerald';
}) {
  const colors: Record<string, string> = {
    green:   'bg-green-50  text-green-600',
    orange:  'bg-amber-50  text-amber-600',
    red:     'bg-red-50    text-red-600',
    slate:   'bg-slate-100 text-slate-500',
    indigo:  'bg-indigo-50 text-indigo-600',
    emerald: 'bg-emerald-50 text-emerald-600',
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

// ─── Purchase Orders Tab ──────────────────────────────────────────────────────

function PurchasesTab({
  supplierId, onViewPO,
}: {
  supplierId: string;
  onViewPO: (id: string) => void;
}) {
  const { data, isLoading } = useQuery({
    queryKey: ['supplier-purchases', supplierId],
    queryFn: () => purchasesApi.listPurchases({ supplierId, pageSize: 50 }),
  });
  const orders = data?.data ?? [];

  if (isLoading) return <div className="text-center py-12 text-slate-400">Loading…</div>;
  if (orders.length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        <Package size={36} className="mx-auto mb-3 text-slate-300" />
        <p className="font-medium text-slate-500">No purchase orders yet</p>
        <p className="text-sm mt-1">Purchase orders for this supplier will appear here</p>
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead className="bg-slate-50 border-b border-slate-200">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Date</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">PO Number</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Items</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Total</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Paid</th>
            <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
            <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide"></th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {orders.map((po) => (
            <tr key={po.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{fmtDate(po.date)}</td>
              <td className="px-4 py-3">
                <button onClick={() => onViewPO(po.id)}
                  className="font-mono font-semibold text-emerald-600 hover:text-emerald-800 hover:underline">
                  {po.number}
                </button>
              </td>
              <td className="px-4 py-3 text-right text-slate-600">
                {po._count?.lines ?? '—'}
              </td>
              <td className="px-4 py-3 text-right font-medium text-slate-800 whitespace-nowrap">
                {fmtCents(po.totalCents)}
              </td>
              <td className="px-4 py-3 text-right font-medium text-emerald-600 whitespace-nowrap">
                {fmtCents(po.paidCents)}
              </td>
              <td className="px-4 py-3 text-center">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PAY_STATUS_CLS[po.paymentStatus]}`}>
                  {po.paymentStatus}
                </span>
                {(() => {
                  // Option B — supplier owes credit when payments exceed the
                  // return-adjusted total (never mutates totalCents).
                  const returnedCents = (po.purchaseReturns ?? []).reduce((s, r) => s + r.totalCents, 0);
                  const hasCredit = po.paidCents > Math.max(0, po.totalCents - returnedCents);
                  return hasCredit ? (
                    <span className="ml-1.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700">
                      Credit
                    </span>
                  ) : null;
                })()}
              </td>
              <td className="px-4 py-3 text-center">
                <button onClick={() => onViewPO(po.id)}
                  className="p-1.5 rounded hover:bg-emerald-50 text-slate-400 hover:text-emerald-600 transition-colors"
                  title="View PO">
                  <ChevronRight size={14} />
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {(data?.total ?? 0) > 50 && (
        <p className="text-xs text-slate-400 text-center py-3">
          Showing first 50 of {data?.total} orders
        </p>
      )}
    </div>
  );
}

// ─── Payments Tab ─────────────────────────────────────────────────────────────

function PaymentsTab({ supplierId }: { supplierId: string }) {
  const { data: payments = [], isLoading } = useQuery({
    queryKey: ['supplier-payments-by', supplierId],
    queryFn: () => supplierPaymentsApi.listBySupplier(supplierId),
  });

  if (isLoading) return <div className="text-center py-12 text-slate-400">Loading…</div>;
  if ((payments as SupplierPayment[]).length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        <Wallet size={36} className="mx-auto mb-3 text-slate-300" />
        <p className="font-medium text-slate-500">No payments recorded</p>
        <p className="text-sm mt-1">Payments against purchase orders will appear here</p>
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
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">PO</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Amount</th>
            <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Method</th>
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Notes</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {(payments as SupplierPayment[]).map((p) => (
            <tr key={p.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{fmtDate(p.paymentDate)}</td>
              <td className="px-4 py-3">
                <p className="font-mono text-xs text-slate-600">{p.paymentNumber}</p>
                {p.paymentType === 'CREDIT_RECEIVED' && (
                  <span className="inline-block mt-0.5 px-1.5 py-0.5 rounded text-[10px] font-bold bg-green-100 text-green-700">
                    Credit Received
                  </span>
                )}
                {p.referenceNo && <p className="text-xs text-slate-400">{p.referenceNo}</p>}
              </td>
              <td className="px-4 py-3 font-mono text-xs text-emerald-600">
                {/* purchaseId mapped via purchase relation — use paymentNumber prefix */}
                {p.purchaseId}
              </td>
              <td className={`px-4 py-3 text-right font-semibold whitespace-nowrap ${p.paymentType === 'CREDIT_RECEIVED' ? 'text-green-600' : 'text-emerald-600'}`}>
                {p.paymentType === 'CREDIT_RECEIVED' ? '+' : ''}{fmtCents(p.amountCents)}
              </td>
              <td className="px-4 py-3 text-center">
                <span className="text-xs bg-slate-100 text-slate-600 px-2 py-0.5 rounded font-medium">
                  {SPAY_LABELS[p.paymentMethod] ?? p.paymentMethod}
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

function ReturnsTab({ supplierId }: { supplierId: string }) {
  const { data: returns = [], isLoading } = useQuery({
    queryKey: ['supplier-returns', supplierId],
    queryFn: () => purchaseReturnsApi.list(undefined, supplierId),
  });

  if (isLoading) return <div className="text-center py-12 text-slate-400">Loading…</div>;
  if ((returns as PurchaseReturn[]).length === 0) {
    return (
      <div className="text-center py-16 text-slate-400">
        <RotateCcw size={36} className="mx-auto mb-3 text-slate-300" />
        <p className="font-medium text-slate-500">No returns</p>
        <p className="text-sm mt-1">Returns linked to this supplier's orders will appear here</p>
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
            <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Against PO</th>
            <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Items</th>
            <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Value</th>
          </tr>
        </thead>
        <tbody className="divide-y divide-slate-100">
          {(returns as PurchaseReturn[]).map((ret) => (
            <tr key={ret.id} className="hover:bg-slate-50 transition-colors">
              <td className="px-4 py-3 text-slate-600 whitespace-nowrap">{fmtDate(ret.createdAt)}</td>
              <td className="px-4 py-3">
                <span className="font-mono font-semibold text-rose-600">{ret.number}</span>
              </td>
              <td className="px-4 py-3 text-slate-600 font-mono text-xs">{ret.purchase.number}</td>
              <td className="px-4 py-3 text-center">
                <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${RETURN_STATUS_COLORS[ret.status]}`}>
                  {RETURN_STATUS_LABELS[ret.status]}
                </span>
              </td>
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
  supplier, onEdit,
}: {
  supplier: SupplierDetail;
  onEdit: () => void;
}) {
  const { settings, businessName, formatMoney } = useAppSettings();
  const [customMessage, setCustomMessage] = useState('');

  return (
    <div className="space-y-6 max-w-lg">
      <div className="bg-slate-50 rounded-xl p-5 space-y-3">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">Contact Details</h3>
        <div className="grid grid-cols-2 gap-4 text-sm">
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Full Name</p>
            <p className="font-medium text-slate-800">{supplier.name}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Phone</p>
            <p className="font-medium text-slate-800">{supplier.phone ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Email</p>
            <p className="font-medium text-slate-800">{supplier.email ?? '—'}</p>
          </div>
          <div>
            <p className="text-xs text-slate-400 mb-0.5">Status</p>
            <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${supplier.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
              {supplier.isActive ? 'Active' : 'Inactive'}
            </span>
          </div>
          {supplier.address && (
            <div className="col-span-2">
              <p className="text-xs text-slate-400 mb-0.5">Address</p>
              <p className="font-medium text-slate-800">{supplier.address}</p>
            </div>
          )}
        </div>
      </div>

      {/* WhatsApp actions — only when enabled AND the supplier has a phone.
          Balance reminder reuses the generic outstanding template; the custom
          message is built inline (supplier tone, NOT the offer template).
          Read-only: touches no purchase/payment/GRN data. */}
      {settings?.whatsappEnabled && supplier.phone && (
        <div className="bg-slate-50 rounded-xl p-5">
          <div className="flex items-center gap-2 mb-4">
            <span className="text-lg">💬</span>
            <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider">WhatsApp Actions</h3>
          </div>

          {/* Send Balance Reminder */}
          <button
            type="button"
            onClick={() => {
              // outstandingBalance is CENTS; formatMoney applies /100 + currency symbol.
              const outstanding = formatMoney(supplier.outstandingBalance ?? 0);
              const message = fillTemplate(
                settings.waPayableTemplate || DEFAULT_PAYABLE_TEMPLATE,
                {
                  // Supplier-direction template uses {supplierName}.
                  supplierName: supplier.name ?? 'Supplier',
                  businessName: businessName ?? 'Our Store',
                  outstanding,
                },
              );
              openWhatsApp(supplier.phone!, message, settings?.whatsappOpenMode);
            }}
            className="w-full flex items-center justify-center gap-2 px-3 py-2.5 bg-green-500 hover:bg-green-600 text-white rounded-lg text-sm font-medium transition mb-4"
            title="Open WhatsApp with the balance reminder pre-filled."
          >
            <span>💬</span>
            Send Balance Reminder
          </button>

          {/* Send Custom Message — inline, no template */}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1.5">Send Custom Message</label>
            <div className="flex gap-2">
              <input
                type="text"
                placeholder="Type message..."
                value={customMessage}
                onChange={e => setCustomMessage(e.target.value)}
                maxLength={500}
                className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-green-500"
              />
              <button
                type="button"
                disabled={!customMessage.trim()}
                onClick={() => {
                  // Inline message — suppliers get plain wording, not the offer template.
                  const msg = `Hi ${supplier.name ?? 'there'},\n\n${customMessage.trim()}\n\n— ${businessName ?? 'Our Store'}`;
                  openWhatsApp(supplier.phone!, msg, settings?.whatsappOpenMode);
                  setCustomMessage('');
                }}
                className="px-4 py-2 bg-green-500 hover:bg-green-600 disabled:opacity-40 disabled:cursor-not-allowed text-white rounded-lg text-sm font-medium transition whitespace-nowrap"
              >
                💬 Send
              </button>
            </div>
          </div>
        </div>
      )}

      <div className="bg-slate-50 rounded-xl p-5">
        <h3 className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-2">Supplier Since</h3>
        <p className="text-sm text-slate-700">
          Added on{' '}
          <span className="font-medium">{fmtDate(supplier.createdAt)}</span>
        </p>
        {supplier.lastOrderDate && (
          <p className="text-sm text-slate-500 mt-1">
            Last order:{' '}
            <span className="font-medium">{fmtDate(supplier.lastOrderDate)}</span>
          </p>
        )}
      </div>

      <div>
        <button onClick={onEdit}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
          <Pencil size={14} /> Edit Supplier
        </button>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

type TabKey = 'purchases' | 'payments' | 'returns' | 'account';

const TABS: { key: TabKey; label: string; icon: React.ReactNode }[] = [
  { key: 'purchases', label: 'Purchase Orders', icon: <Package    size={14} /> },
  { key: 'payments',  label: 'Payments',         icon: <Wallet     size={14} /> },
  { key: 'returns',   label: 'Returns',           icon: <RotateCcw  size={14} /> },
  { key: 'account',   label: 'Account Info',      icon: <Truck      size={14} /> },
];

// ─── Record Supplier Payment Modal ─────────────────────────────────────────────

function RecordSupplierPaymentModal({
  supplierId, onClose,
}: {
  supplierId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const { data: purchasesData, isLoading: purchasesLoading } = useQuery({
    queryKey: ['supplier-outstanding-purchases', supplierId],
    queryFn: () => purchasesApi.listPurchases({ supplierId, pageSize: 100 }),
  });

  const outstandingPurchases = (purchasesData?.data ?? []).filter(
    (p) => p.status === 'CONFIRMED' &&
      (p.paymentStatus === 'UNPAID' || p.paymentStatus === 'PARTIAL'),
  );

  const [purchaseId, setPurchaseId] = useState('');
  const [amount, setAmount]         = useState('');
  const [method, setMethod]         = useState<SupplierPaymentMethod>('CASH');
  const [refNo, setRefNo]           = useState('');
  const [bank, setBank]             = useState('');
  const [date, setDate]             = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes]           = useState('');
  const [error, setError]           = useState('');

  // Option B — confirmed return credit reduces what is still owed on a PO.
  // Mirrors the balance-due calc used in the PO list above and the backend's
  // effectiveOutstanding; never mutates totalCents.
  const poOutstanding = (p: { totalCents: number; paidCents: number; purchaseReturns?: { totalCents: number }[] }) =>
    p.totalCents - p.paidCents - (p.purchaseReturns ?? []).reduce((s, r) => s + r.totalCents, 0);

  const selectedPurchase = outstandingPurchases.find((p) => p.id === purchaseId);
  const outstanding = selectedPurchase ? poOutstanding(selectedPurchase) : 0;

  const mutation = useMutation({
    mutationFn: () => supplierPaymentsApi.create({
      purchaseId, amountCents: Math.round(parseFloat(amount) * 100), paymentMethod: method,
      referenceNo: refNo || undefined, bankName: bank || undefined,
      paymentDate: date, notes: notes || undefined,
    }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['supplier-payments-by', supplierId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-purchases', supplierId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-detail', supplierId] });
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
    if (!purchaseId) { setError('Select a purchase order'); return; }
    const amountCents = Math.round(parseFloat(amount) * 100);
    if (!amountCents || amountCents <= 0) { setError('Enter a valid amount'); return; }
    if (outstanding > 0 && amountCents > outstanding) {
      setError(`Amount exceeds outstanding balance of ${fmtCents(outstanding)}`);
      return;
    }
    mutation.mutate();
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
            <label className="block text-xs font-medium text-slate-600 mb-1">Purchase Order *</label>
            {purchasesLoading ? (
              <p className="text-sm text-slate-400">Loading outstanding orders…</p>
            ) : outstandingPurchases.length === 0 ? (
              <p className="text-sm text-slate-500 bg-slate-50 border border-slate-200 rounded-lg px-3 py-2">
                No outstanding purchase orders for this supplier.
              </p>
            ) : (
              <select value={purchaseId}
                onChange={(e) => { setPurchaseId(e.target.value); const p = outstandingPurchases.find(x => x.id === e.target.value); if (p) setAmount((poOutstanding(p) / 100).toFixed(2)); }}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">
                <option value="">— Select order —</option>
                {outstandingPurchases.map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.number} · Outstanding: {fmtCents(poOutstanding(p))}
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
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="0.00" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Method *</label>
              <select value={method} onChange={(e) => setMethod(e.target.value as SupplierPaymentMethod)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">
                <option value="CASH">Cash</option>
                <option value="CHEQUE">Cheque</option>
                <option value="BANK_TRANSFER">Bank Transfer</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Reference No</label>
              <input value={refNo} onChange={(e) => setRefNo(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Cheque / bank ref" />
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Date *</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>
          </div>

          {(method === 'CHEQUE' || method === 'BANK_TRANSFER') && (
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Bank</label>
              <input value={bank} onChange={(e) => setBank(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Bank name" />
            </div>
          )}

          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
            <input value={notes} onChange={(e) => setNotes(e.target.value)}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
              placeholder="Optional note" />
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose}
              className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">
              Cancel
            </button>
            <button type="submit" disabled={mutation.isPending || outstandingPurchases.length === 0}
              className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60">
              {mutation.isPending ? 'Saving…' : 'Record Payment'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Lump-Sum Payment Modal (supplier) ────────────────────────────────────────
// One payment auto-allocated across ALL outstanding purchase orders, oldest-first.
// Leftover beyond every PO is parked as supplier credit (preview + confirm).

function LumpSumSupplierPaymentModal({
  supplierId, onClose,
}: {
  supplierId: string;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const { data: purchasesData, isLoading: purchasesLoading } = useQuery({
    queryKey: ['supplier-outstanding-purchases', supplierId],
    queryFn: () => purchasesApi.listPurchases({ supplierId, pageSize: 100 }),
  });

  const poOutstanding = (p: { totalCents: number; paidCents: number; purchaseReturns?: { totalCents: number }[] }) =>
    Math.max(0, p.totalCents - p.paidCents - (p.purchaseReturns ?? []).reduce((s, r) => s + r.totalCents, 0));

  const outstandingPurchases = React.useMemo(() => {
    const rows = (purchasesData?.data ?? []).filter(
      (p) => p.status === 'CONFIRMED' &&
        (p.paymentStatus === 'UNPAID' || p.paymentStatus === 'PARTIAL'),
    );
    return rows.sort((a, b) => {
      const d = new Date(a.date).getTime() - new Date(b.date).getTime();
      return d !== 0 ? d : a.number.localeCompare(b.number);
    });
  }, [purchasesData]);

  const totalOutstanding = outstandingPurchases.reduce((s, p) => s + poOutstanding(p), 0);

  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<SupplierPaymentMethod>('CASH');
  const [refNo, setRefNo]   = useState('');
  const [bank, setBank]     = useState('');
  const [date, setDate]     = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes]   = useState('');
  const [error, setError]   = useState('');
  const [result, setResult] = useState<LumpSumSupplierPaymentResult | null>(null);

  const amountCents = Math.round(parseFloat(amount || '0') * 100);

  const preview = React.useMemo(() => {
    let remaining = amountCents > 0 ? amountCents : 0;
    const rows: { number: string; applied: number }[] = [];
    for (const p of outstandingPurchases) {
      if (remaining <= 0) break;
      const out = poOutstanding(p);
      if (out <= 0) continue;
      const applied = Math.min(remaining, out);
      rows.push({ number: p.number, applied });
      remaining -= applied;
    }
    return { rows, credit: Math.max(0, remaining) };
  }, [amountCents, outstandingPurchases]);

  const mutation = useMutation({
    mutationFn: () => supplierPaymentsApi.createLumpSum({
      supplierId, amountCents, paymentMethod: method,
      referenceNo: refNo || undefined, bankName: bank || undefined,
      paymentDate: date, notes: notes || undefined,
    }),
    onSuccess: (res) => {
      setResult(res);
      queryClient.invalidateQueries({ queryKey: ['supplier-payments-by', supplierId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-purchases', supplierId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-detail', supplierId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-outstanding-purchases', supplierId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-credit-ledger', supplierId] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg ?? 'Failed to record payment');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!amountCents || amountCents <= 0) { setError('Enter a valid amount'); return; }
    mutation.mutate();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-800">Lump-Sum Payment</h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {result ? (
          <div className="px-6 py-5 space-y-4">
            <div className="p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm flex items-center gap-2">
              <Check className="w-4 h-4" /> Payment recorded successfully.
            </div>
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
              {result.allocations.map((a) => (
                <div key={a.paymentNumber} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-slate-600">{a.purchaseNumber} <span className="text-slate-400">· {a.paymentNumber}</span></span>
                  <span className="font-semibold text-slate-800">{fmtCents(a.appliedCents)}</span>
                </div>
              ))}
              {result.allocations.length === 0 && (
                <div className="px-3 py-2 text-sm text-slate-400">No orders to apply — full amount stored as credit.</div>
              )}
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Applied to orders</span>
              <span className="font-semibold text-slate-800">{fmtCents(result.appliedCents)}</span>
            </div>
            {result.creditAddedCents > 0 && (
              <div className="flex justify-between text-sm">
                <span className="text-emerald-600 font-medium">Stored as supplier credit</span>
                <span className="font-bold text-emerald-700">{fmtCents(result.creditAddedCents)}</span>
              </div>
            )}
            <div className="flex justify-end pt-1">
              <button onClick={onClose}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700">
                Done
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
            )}

            <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">
              <span className="text-slate-500">Total outstanding ({outstandingPurchases.length} order{outstandingPurchases.length !== 1 ? 's' : ''})</span>
              <span className="font-semibold text-slate-800">{fmtCents(totalOutstanding)}</span>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Amount (Rs.) *</label>
                <input type="number" min="0.01" step="0.01" value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="0.00" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Method *</label>
                <select value={method} onChange={(e) => setMethod(e.target.value as SupplierPaymentMethod)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500">
                  {Object.entries(SPAY_METHOD_LABELS).map(([v, l]) => (
                    <option key={v} value={v}>{l}</option>
                  ))}
                </select>
              </div>
            </div>

            {amountCents > 0 && (
              <div className="border border-slate-200 rounded-lg">
                <div className="px-3 py-1.5 text-xs font-medium text-slate-500 border-b border-slate-100 bg-slate-50 rounded-t-lg">
                  Allocation preview (oldest-first)
                </div>
                <div className="divide-y divide-slate-100 max-h-40 overflow-y-auto">
                  {preview.rows.map((r) => (
                    <div key={r.number} className="flex items-center justify-between px-3 py-1.5 text-sm">
                      <span className="text-slate-600">{r.number}</span>
                      <span className="font-medium text-slate-800">{fmtCents(r.applied)}</span>
                    </div>
                  ))}
                  {preview.rows.length === 0 && (
                    <div className="px-3 py-1.5 text-sm text-slate-400">No outstanding orders.</div>
                  )}
                </div>
                {preview.credit > 0 && (
                  <div className="flex items-center justify-between px-3 py-2 text-sm border-t border-slate-200 bg-emerald-50 rounded-b-lg">
                    <span className="text-emerald-700 font-medium">→ Stored as supplier credit</span>
                    <span className="font-bold text-emerald-700">{fmtCents(preview.credit)}</span>
                  </div>
                )}
                <p className="px-3 py-1.5 text-[11px] text-slate-400 border-t border-slate-100">
                  Final split (returns-aware) is confirmed by the server on save.
                </p>
              </div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Reference No</label>
                <input value={refNo} onChange={(e) => setRefNo(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                  placeholder="Cheque / bank ref" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Date *</label>
                <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
              </div>
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Optional note" />
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <button type="button" onClick={onClose}
                className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button type="submit" disabled={mutation.isPending || purchasesLoading || amountCents <= 0}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60">
                {mutation.isPending ? 'Saving…' : 'Record Lump-Sum'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

// ─── Apply Supplier Credit Modal ──────────────────────────────────────────────

function ApplyCreditSupplierModal({
  supplierId, availableCents, onClose,
}: {
  supplierId: string;
  availableCents: number;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();

  const { data: purchasesData, isLoading: purchasesLoading } = useQuery({
    queryKey: ['supplier-outstanding-purchases', supplierId],
    queryFn: () => purchasesApi.listPurchases({ supplierId, pageSize: 100 }),
  });

  const poOutstanding = (p: { totalCents: number; paidCents: number; purchaseReturns?: { totalCents: number }[] }) =>
    Math.max(0, p.totalCents - p.paidCents - (p.purchaseReturns ?? []).reduce((s, r) => s + r.totalCents, 0));

  const outstandingPurchases = React.useMemo(() => {
    const rows = (purchasesData?.data ?? []).filter(
      (p) => p.status === 'CONFIRMED' &&
        (p.paymentStatus === 'UNPAID' || p.paymentStatus === 'PARTIAL'),
    );
    return rows.sort((a, b) => {
      const d = new Date(a.date).getTime() - new Date(b.date).getTime();
      return d !== 0 ? d : a.number.localeCompare(b.number);
    });
  }, [purchasesData]);

  const totalOutstanding = outstandingPurchases.reduce((s, p) => s + poOutstanding(p), 0);

  // Default the amount to the most that can actually be applied.
  const applicableMax = Math.min(availableCents, totalOutstanding);

  const [amount, setAmount] = useState('');
  const [date, setDate]     = useState(new Date().toISOString().slice(0, 10));
  const [notes, setNotes]   = useState('');
  const [error, setError]   = useState('');
  const [result, setResult] = useState<ApplyCreditSupplierResult | null>(null);

  const amountCents = Math.round(parseFloat(amount || '0') * 100);

  // Client-side preview (final numbers come from the backend on save).
  const preview = React.useMemo(() => {
    let remaining = Math.min(amountCents > 0 ? amountCents : 0, availableCents);
    const rows: { number: string; applied: number }[] = [];
    for (const p of outstandingPurchases) {
      if (remaining <= 0) break;
      const out = poOutstanding(p);
      if (out <= 0) continue;
      const applied = Math.min(remaining, out);
      rows.push({ number: p.number, applied });
      remaining -= applied;
    }
    const consumed = rows.reduce((sm, r) => sm + r.applied, 0);
    return { rows, consumed, creditLeft: Math.max(0, availableCents - consumed) };
  }, [amountCents, availableCents, outstandingPurchases]);

  const mutation = useMutation({
    mutationFn: () => supplierPaymentsApi.applyCredit({
      supplierId, amountCents, paymentDate: date, notes: notes || undefined,
    }),
    onSuccess: (res) => {
      setResult(res);
      queryClient.invalidateQueries({ queryKey: ['supplier-payments-by', supplierId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-detail', supplierId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-purchases', supplierId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-outstanding-purchases', supplierId] });
      queryClient.invalidateQueries({ queryKey: ['supplier-credit-ledger', supplierId] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg ?? 'Failed to apply credit');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    if (!amountCents || amountCents <= 0) { setError('Enter a valid amount'); return; }
    if (amountCents > availableCents) {
      setError(`Amount exceeds available credit of ${fmtCents(availableCents)}`);
      return;
    }
    mutation.mutate();
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-lg shadow-xl max-h-[90vh] overflow-y-auto">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-800">Apply Supplier Credit</h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        {result ? (
          /* ── Success summary ── */
          <div className="px-6 py-5 space-y-4">
            <div className="p-3 bg-green-50 border border-green-200 text-green-700 rounded-lg text-sm flex items-center gap-2">
              <Check className="w-4 h-4" /> Credit applied successfully.
            </div>
            <div className="border border-slate-200 rounded-lg divide-y divide-slate-100">
              {result.allocations.map((a) => (
                <div key={a.paymentNumber} className="flex items-center justify-between px-3 py-2 text-sm">
                  <span className="text-slate-600">{a.purchaseNumber} <span className="text-slate-400">· {a.paymentNumber}</span></span>
                  <span className="font-semibold text-slate-800">{fmtCents(a.appliedCents)}</span>
                </div>
              ))}
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-slate-500">Credit applied to orders</span>
              <span className="font-semibold text-slate-800">{fmtCents(result.appliedCents)}</span>
            </div>
            <div className="flex justify-between text-sm">
              <span className="text-emerald-600 font-medium">Remaining account credit</span>
              <span className="font-bold text-emerald-700">{fmtCents(result.creditRemainingCents)}</span>
            </div>
            <div className="flex justify-end pt-1">
              <button onClick={onClose}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700">
                Done
              </button>
            </div>
          </div>
        ) : (
          /* ── Entry form ── */
          <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
            {error && (
              <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
            )}

            <div className="grid grid-cols-2 gap-3">
              <div className="flex items-center justify-between bg-emerald-50 border border-emerald-200 rounded-lg px-3 py-2 text-sm">
                <span className="text-emerald-600">Available credit</span>
                <span className="font-semibold text-emerald-700">{fmtCents(availableCents)}</span>
              </div>
              <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-lg px-3 py-2 text-sm">
                <span className="text-slate-500">Outstanding ({outstandingPurchases.length})</span>
                <span className="font-semibold text-slate-800">{fmtCents(totalOutstanding)}</span>
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1">
                <label className="block text-xs font-medium text-slate-600">Amount to apply (Rs.) *</label>
                {applicableMax > 0 && (
                  <button type="button"
                    onClick={() => setAmount((applicableMax / 100).toFixed(2))}
                    className="text-[11px] font-medium text-indigo-600 hover:text-indigo-700">
                    Use max ({fmtCents(applicableMax)})
                  </button>
                )}
              </div>
              <input type="number" min="0.01" step="0.01" max={(availableCents / 100).toFixed(2)} value={amount}
                onChange={(e) => setAmount(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="0.00" />
            </div>

            {/* Allocation preview */}
            {amountCents > 0 && (
              <div className="border border-slate-200 rounded-lg">
                <div className="px-3 py-1.5 text-xs font-medium text-slate-500 border-b border-slate-100 bg-slate-50 rounded-t-lg">
                  Allocation preview (oldest-first)
                </div>
                <div className="divide-y divide-slate-100 max-h-40 overflow-y-auto">
                  {preview.rows.map((r) => (
                    <div key={r.number} className="flex items-center justify-between px-3 py-1.5 text-sm">
                      <span className="text-slate-600">{r.number}</span>
                      <span className="font-medium text-slate-800">{fmtCents(r.applied)}</span>
                    </div>
                  ))}
                  {preview.rows.length === 0 && (
                    <div className="px-3 py-1.5 text-sm text-slate-400">No outstanding orders to apply against.</div>
                  )}
                </div>
                <div className="flex items-center justify-between px-3 py-2 text-sm border-t border-slate-200 bg-emerald-50 rounded-b-lg">
                  <span className="text-emerald-700 font-medium">Credit remaining after</span>
                  <span className="font-bold text-emerald-700">{fmtCents(preview.creditLeft)}</span>
                </div>
                <p className="px-3 py-1.5 text-[11px] text-slate-400 border-t border-slate-100">
                  Final split (returns-aware) is confirmed by the server on save.
                </p>
              </div>
            )}

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Date *</label>
              <input type="date" value={date} onChange={(e) => setDate(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500" />
            </div>

            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Notes</label>
              <input value={notes} onChange={(e) => setNotes(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-emerald-500"
                placeholder="Optional note" />
            </div>

            <div className="flex justify-end gap-3 pt-1">
              <button type="button" onClick={onClose}
                className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">
                Cancel
              </button>
              <button type="submit" disabled={mutation.isPending || purchasesLoading || amountCents <= 0 || totalOutstanding === 0}
                className="px-4 py-2 rounded-lg bg-emerald-600 text-white text-sm font-medium hover:bg-emerald-700 disabled:opacity-60">
                {mutation.isPending ? 'Applying…' : 'Apply Credit'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}

export default function SupplierDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();

  const [tab, setTab]             = useState<TabKey>('purchases');
  const [editOpen, setEditOpen]   = useState(false);
  const [editError, setEditError] = useState('');
  const [viewPoId, setViewPoId]   = useState<string | null>(null);
  const [payOpen, setPayOpen]     = useState(false);
  const [lumpOpen, setLumpOpen]   = useState(false);
  const [applyCreditOpen, setApplyCreditOpen] = useState(false);

  const { data: supplier, isLoading } = useQuery({
    queryKey: ['supplier-detail', id],
    queryFn: () => suppliersApi.getOne(id!),
    enabled: !!id,
  });

  const updateMutation = useMutation({
    mutationFn: (body: ContactBody) => suppliersApi.update(id!, body),
    onSuccess: (updated) => {
      queryClient.setQueryData(['supplier-detail', id], (prev: SupplierDetail | undefined) =>
        prev ? { ...prev, ...updated } : prev,
      );
      queryClient.invalidateQueries({ queryKey: ['suppliers'] });
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
          <div className="w-8 h-8 border-2 border-emerald-600 border-t-transparent rounded-full animate-spin mx-auto mb-3" />
          <p className="text-sm">Loading supplier…</p>
        </div>
      </div>
    );
  }

  if (!supplier) {
    return (
      <div className="flex items-center justify-center h-64 text-slate-400">
        <div className="text-center">
          <Truck size={40} className="mx-auto mb-3 text-slate-300" />
          <p className="font-medium text-slate-600">Supplier not found</p>
          <button onClick={() => navigate('/suppliers')}
            className="mt-3 text-sm text-indigo-600 hover:underline">← Back to Suppliers</button>
        </div>
      </div>
    );
  }

  const outstanding = supplier.outstandingBalance;

  return (
    <div className="p-6 space-y-6">

      {/* ── Page Header ────────────────────────────────────────────────────────── */}
      <div>
        <button onClick={() => navigate('/suppliers')}
          className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4 transition-colors">
          <ArrowLeft size={14} /> Suppliers
        </button>

        <div className="flex items-start justify-between">
          <div className="flex items-center gap-4">
            <div className="w-12 h-12 rounded-xl bg-emerald-100 flex items-center justify-center shrink-0">
              <span className="text-emerald-600 font-bold text-xl">
                {supplier.name.charAt(0).toUpperCase()}
              </span>
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h1 className="text-2xl font-bold text-slate-800">{supplier.name}</h1>
                <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${supplier.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                  {supplier.isActive ? 'Active' : 'Inactive'}
                </span>
                {supplier.creditBalanceCents > 0 && (
                  <span className="inline-flex items-center gap-1 text-xs font-semibold px-2.5 py-1 rounded-full bg-emerald-100 text-emerald-700">
                    <Wallet size={10} /> Credit balance {fmtCents(supplier.creditBalanceCents)}
                  </span>
                )}
              </div>
              <div className="flex items-center gap-3 mt-1 text-sm text-slate-500">
                {supplier.phone && <span>{supplier.phone}</span>}
                {supplier.phone && supplier.email && <span>·</span>}
                {supplier.email && <span>{supplier.email}</span>}
                {supplier._count.purchases > 0 && (
                  <>
                    <span>·</span>
                    <span>{supplier._count.purchases} order{supplier._count.purchases !== 1 ? 's' : ''}</span>
                  </>
                )}
              </div>
            </div>
          </div>

          {/* Quick actions */}
          <div className="flex items-center gap-2 shrink-0">
            <button onClick={() => navigate('/purchases')}
              className="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 text-white rounded-lg text-sm font-medium hover:bg-emerald-700 transition-colors">
              <Plus size={14} /> New PO
            </button>
            <button onClick={() => setPayOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 border border-emerald-200 text-emerald-700 rounded-lg text-sm font-medium hover:bg-emerald-50 transition-colors">
              <Wallet size={14} /> Record Payment
            </button>
            <button onClick={() => setLumpOpen(true)}
              className="flex items-center gap-1.5 px-3 py-2 border border-emerald-200 text-emerald-700 rounded-lg text-sm font-medium hover:bg-emerald-50 transition-colors">
              <Layers size={14} /> Lump-Sum
            </button>
            {supplier.creditBalanceCents > 0 && (
              <button onClick={() => setApplyCreditOpen(true)}
                className="flex items-center gap-1.5 px-3 py-2 border border-emerald-200 text-emerald-700 bg-emerald-50 rounded-lg text-sm font-medium hover:bg-emerald-100 transition-colors">
                <Wallet size={14} /> Apply Credit
              </button>
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
          label="Total Orders"
          value={fmtCents(supplier.totalPurchaseAmount)}
          sub={`${supplier._count.purchases} order${supplier._count.purchases !== 1 ? 's' : ''}`}
          accent="emerald"
        />
        <StatCard
          icon={<Check size={20} />}
          label="Total Paid"
          value={fmtCents(supplier.totalPaid)}
          accent="green"
        />
        <StatCard
          icon={outstanding > 0 ? <AlertTriangle size={20} /> : <DollarSign size={20} />}
          label="Outstanding Balance"
          value={fmtCents(outstanding)}
          sub={outstanding === 0 ? 'All orders settled' : undefined}
          accent={outstanding > 0 ? 'orange' : 'green'}
        />
        <StatCard
          icon={<TrendingDown size={20} />}
          label="Total Returns"
          value={String(supplier.totalReturns)}
          sub={supplier.totalReturns === 0 ? 'No returns' : `${supplier.totalReturns} debit note${supplier.totalReturns !== 1 ? 's' : ''}`}
          accent={supplier.totalReturns > 0 ? 'red' : 'slate'}
        />
      </div>

      {/* ── Tabs ───────────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="flex border-b border-slate-200">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`flex items-center gap-1.5 px-5 py-3.5 text-sm font-medium transition-colors ${
                tab === t.key
                  ? 'border-b-2 border-emerald-600 text-emerald-600'
                  : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.icon} {t.label}
            </button>
          ))}
        </div>

        <div className="min-h-[300px]">
          {tab === 'purchases' && <PurchasesTab supplierId={id!} onViewPO={setViewPoId} />}
          {tab === 'payments'  && <PaymentsTab  supplierId={id!} />}
          {tab === 'returns'   && <ReturnsTab   supplierId={id!} />}
          {tab === 'account'   && <AccountInfoTab supplier={supplier} onEdit={() => { setEditError(''); setEditOpen(true); }} />}
        </div>
      </div>

      {/* ── Modals ─────────────────────────────────────────────────────────────── */}
      {editOpen && (
        <SupplierModal
          title="Edit Supplier"
          initial={supplier}
          onSave={(body) => updateMutation.mutate(body)}
          onClose={() => setEditOpen(false)}
          loading={updateMutation.isPending}
          error={editError}
        />
      )}

      {viewPoId && (
        <PurchaseViewModal
          poId={viewPoId}
          onClose={() => setViewPoId(null)}
        />
      )}

      {payOpen && (
        <RecordSupplierPaymentModal
          supplierId={id!}
          onClose={() => setPayOpen(false)}
        />
      )}

      {lumpOpen && (
        <LumpSumSupplierPaymentModal
          supplierId={id!}
          onClose={() => setLumpOpen(false)}
        />
      )}

      {applyCreditOpen && (
        <ApplyCreditSupplierModal
          supplierId={id!}
          availableCents={supplier.creditBalanceCents}
          onClose={() => setApplyCreditOpen(false)}
        />
      )}
    </div>
  );
}
