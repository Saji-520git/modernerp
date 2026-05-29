import { useState, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Search, Pencil, ToggleLeft, ToggleRight, X,
  ChevronLeft, ChevronRight, Users, CreditCard, AlertTriangle, ShieldCheck,
} from 'lucide-react';
import {
  customersApi,
  type CustomerBody, type Customer,
} from '../../services/contacts';
import { salesApi } from '../../services/sales';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCents(cents: number) {
  return `Rs. ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Customer Modal ────────────────────────────────────────────────────────────

function CustomerModal({
  title, initial, onSave, onClose, loading, error,
}: {
  title: string;
  initial?: Customer;
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
  const [alertPct, setAlertPct]     = useState(initial?.creditAlertPct ?? 80);
  const [settleDays, setSettleDays] = useState<number | ''>(initial?.creditSettleDays ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name,
      phone:            phone || undefined,
      email:            email || undefined,
      address:          address || undefined,
      creditEnabled,
      creditLimitCents: Math.round(parseFloat(creditLimit || '0') * 100),
      creditAlertPct:   alertPct,
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

          {/* Basic info */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
              <input
                required value={name} onChange={(e) => setName(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. John Smith"
              />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
                <input
                  value={phone} onChange={(e) => setPhone(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="+94 77 000 0000"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                <input
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  placeholder="email@example.com"
                />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Address</label>
              <textarea
                value={address} onChange={(e) => setAddress(e.target.value)} rows={2}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
                placeholder="Street, City, Country"
              />
            </div>
          </div>

          {/* Credit section */}
          <div className="border-t border-slate-200 pt-4">
            <div className="flex items-center justify-between mb-3">
              <div className="flex items-center gap-2">
                <CreditCard className="w-4 h-4 text-amber-500" />
                <span className="text-sm font-semibold text-slate-700">Credit Account</span>
              </div>
              <label className="flex items-center gap-2 cursor-pointer">
                <span className="text-xs text-slate-500">{creditEnabled ? 'Enabled' : 'Disabled'}</span>
                <div
                  onClick={() => setCreditEnabled((v) => !v)}
                  className={`w-9 h-5 rounded-full transition-colors relative cursor-pointer ${
                    creditEnabled ? 'bg-amber-500' : 'bg-slate-200'
                  }`}
                >
                  <div className={`absolute top-0.5 w-4 h-4 bg-white rounded-full shadow transition-transform ${
                    creditEnabled ? 'translate-x-4' : 'translate-x-0.5'
                  }`} />
                </div>
              </label>
            </div>

            {creditEnabled && (
              <div className="space-y-3 bg-amber-50/50 border border-amber-100 rounded-xl p-3">
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Credit Limit (Rs.)</label>
                    <input
                      type="number" min="0" step="0.01"
                      value={creditLimit} onChange={(e) => setCreditLimit(e.target.value)}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                      placeholder="0.00 = Unlimited"
                    />
                    <p className="text-[10px] text-slate-400 mt-0.5">0 = no limit</p>
                  </div>
                  <div>
                    <label className="block text-xs font-medium text-slate-600 mb-1">Alert Threshold (%)</label>
                    <input
                      type="number" min="1" max="100"
                      value={alertPct}
                      onChange={(e) => setAlertPct(Math.max(1, Math.min(100, parseInt(e.target.value) || 80)))}
                      className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    />
                    <p className="text-[10px] text-slate-400 mt-0.5">Warn at {alertPct}% of limit</p>
                  </div>
                </div>
                <div>
                  <label className="block text-xs font-medium text-slate-600 mb-1">
                    Settlement Period (days) <span className="text-slate-400 font-normal">— optional</span>
                  </label>
                  <input
                    type="number" min="1" max="365"
                    value={settleDays}
                    onChange={(e) => setSettleDays(e.target.value ? parseInt(e.target.value) : '')}
                    className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-amber-400"
                    placeholder="e.g. 30"
                  />
                  <p className="text-[10px] text-slate-400 mt-0.5">Customer must settle within this many days</p>
                </div>
                <div className="flex items-start gap-2 bg-amber-50 border border-amber-200 rounded-lg p-2 text-xs text-amber-700">
                  <AlertTriangle className="w-3.5 h-3.5 shrink-0 mt-0.5" />
                  <span>
                    Requires <strong>sell_on_credit</strong> role permission to use at POS.
                    Exceeding limit requires <strong>manage_credit</strong> permission.
                  </span>
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

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function CustomersPage() {
  const navigate     = useNavigate();
  const queryClient  = useQueryClient();
  const PAGE_SIZE = 15;
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(1);
  const [modal, setModal]   = useState<{ mode: 'create' } | { mode: 'edit'; item: Customer } | null>(null);
  const [modalError, setModalError] = useState('');

  // ── Customers list ──────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ['customers', search, page],
    queryFn:  () => customersApi.list({ search: search || undefined, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  // ── Outstanding sales (CONFIRMED, UNPAID or PARTIAL) ───────────────────────
  const { data: salesData } = useQuery({
    queryKey: ['customer-outstanding'],
    queryFn:  () => salesApi.listSales({ status: 'CONFIRMED', pageSize: 100 }),
    staleTime: 60_000,
  });

  const outstandingByCustomer = useMemo(() => {
    const map: Record<string, number> = {};
    for (const sale of salesData?.data ?? []) {
      if (
        sale.customer &&
        (sale.paymentStatus === 'UNPAID' || sale.paymentStatus === 'PARTIAL')
      ) {
        const owed = sale.totalCents - sale.paidCents;
        const cid  = sale.customer.id;
        map[cid] = (map[cid] ?? 0) + Math.max(0, owed);
      }
    }
    return map;
  }, [salesData]);

  // ── Mutations ───────────────────────────────────────────────────────────────
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['customers'] });

  const createMutation = useMutation({
    mutationFn: (body: CustomerBody) => customersApi.create(body),
    onSuccess: () => { invalidate(); setModal(null); setModalError(''); },
    onError: (err: unknown) =>
      setModalError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to save'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: CustomerBody }) => customersApi.update(id, body),
    onSuccess: () => { invalidate(); setModal(null); setModalError(''); },
    onError: (err: unknown) =>
      setModalError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to save'),
  });

  const toggleMutation = useMutation({ mutationFn: customersApi.toggleActive, onSuccess: invalidate });

  const handleSave = (body: CustomerBody) => {
    setModalError('');
    if (modal?.mode === 'create') createMutation.mutate(body);
    else if (modal?.mode === 'edit') updateMutation.mutate({ id: modal.item.id, body });
  };

  const total      = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const isSaving   = createMutation.isPending || updateMutation.isPending;

  return (
    <div className="p-6">

      {/* ── Page header ────────────────────────────────────────────────────────── */}
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Customers</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage your customers and sales contacts
          </p>
        </div>
        <button
          onClick={() => { setModal({ mode: 'create' }); setModalError(''); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          Add Customer
        </button>
      </div>

      {/* ── Search ─────────────────────────────────────────────────────────────── */}
      <div className="relative mb-4">
        <Search size={16} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
        <input
          value={search}
          onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          className="w-full pl-9 pr-4 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
          placeholder="Search by name, phone or email…"
        />
      </div>

      {/* ── Table ──────────────────────────────────────────────────────────────── */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-visible">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Name</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Phone / Email</th>
              <th className="text-center px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Sales</th>
              <th className="text-right px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Outstanding</th>
              <th className="text-center px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Credit</th>
              <th className="text-center px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Status</th>
              <th className="text-center px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr><td colSpan={7} className="text-center py-12 text-slate-400">Loading…</td></tr>
            )}
            {!isLoading && (data?.data.length ?? 0) === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-12 text-center">
                  <Users size={32} className="mx-auto text-slate-300 mb-3" />
                  <p className="text-slate-500 font-medium">No customers found</p>
                  <p className="text-slate-400 text-xs mt-1">
                    Add your first customer to start tracking sales
                  </p>
                </td>
              </tr>
            )}
            {data?.data.map((item) => {
              const outstanding = outstandingByCustomer[item.id] ?? 0;
              return (
                <tr
                  key={item.id}
                  className={`hover:bg-slate-50 transition-colors ${!item.isActive ? 'opacity-50' : ''}`}
                >
                  <td className="px-4 py-3">
                    <button
                      onClick={() => navigate(`/customers/${item.id}`)}
                      className="font-medium text-slate-800 hover:text-indigo-600 hover:underline text-left"
                    >
                      {item.name}
                    </button>
                    <div className="text-xs text-slate-400 mt-0.5">{item.address || '—'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-slate-700">{item.phone ?? '—'}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{item.email ?? '—'}</div>
                  </td>
                  <td className="px-4 py-3 text-center text-slate-600">
                    {item._count?.sales ?? 0}
                  </td>
                  <td className="px-4 py-3 text-right">
                    {outstanding > 0 ? (
                      <div>
                        <span className="text-amber-600 font-medium">{formatCents(outstanding)}</span>
                        <div className="text-xs text-amber-500">Unpaid</div>
                      </div>
                    ) : (
                      <span className="text-slate-400 text-xs">All paid</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    {item.creditEnabled ? (
                      <div className="flex flex-col items-center gap-0.5">
                        <span className="flex items-center gap-1 text-xs bg-amber-100 text-amber-700 px-2 py-0.5 rounded-full font-medium">
                          <ShieldCheck className="w-3 h-3" />
                          {item.creditLimitCents > 0 ? formatCents(item.creditLimitCents) : 'Unlimited'}
                        </span>
                        <span className="text-[10px] text-slate-400">Alert {item.creditAlertPct}%</span>
                      </div>
                    ) : (
                      <span className="text-xs text-slate-300">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3 text-center">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                      item.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {item.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center justify-center gap-1">
                      <button
                        onClick={() => { setModal({ mode: 'edit', item }); setModalError(''); }}
                        className="p-1.5 rounded hover:bg-slate-100 text-slate-400 hover:text-slate-600 transition-colors"
                        title="Edit"
                      >
                        <Pencil size={14} />
                      </button>
                      <button
                        onClick={() => toggleMutation.mutate(item.id)}
                        disabled={toggleMutation.isPending}
                        className="p-1.5 rounded hover:bg-slate-100 transition-colors"
                        title={item.isActive ? 'Deactivate' : 'Activate'}
                      >
                        {item.isActive
                          ? <ToggleRight size={18} className="text-green-500" />
                          : <ToggleLeft  size={18} className="text-slate-400" />}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm text-slate-600">
            <span>{total} customer{total !== 1 ? 's' : ''}</span>
            <div className="flex items-center gap-2">
              <button
                disabled={page === 1}
                onClick={() => setPage((p) => p - 1)}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-40"
              >
                <ChevronLeft size={16} />
              </button>
              <span>Page {page} of {totalPages}</span>
              <button
                disabled={page === totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="p-1 rounded hover:bg-slate-100 disabled:opacity-40"
              >
                <ChevronRight size={16} />
              </button>
            </div>
          </div>
        )}
      </div>

      {/* ── Modal ──────────────────────────────────────────────────────────────── */}
      {modal && (
        <CustomerModal
          title={modal.mode === 'create' ? 'New Customer' : 'Edit Customer'}
          initial={modal.mode === 'edit' ? modal.item : undefined}
          onSave={handleSave}
          onClose={() => setModal(null)}
          loading={isSaving}
          error={modalError}
        />
      )}
    </div>
  );
}
