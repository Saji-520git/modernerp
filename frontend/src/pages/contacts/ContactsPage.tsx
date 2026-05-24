import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Search, Pencil, ToggleLeft, ToggleRight, X,
  ChevronLeft, ChevronRight, CreditCard, AlertTriangle, ShieldCheck,
} from 'lucide-react';
import {
  suppliersApi, customersApi,
  type ContactBody, type CustomerBody, type Supplier, type Customer,
} from '../../services/contacts';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCents(cents: number) {
  return `Rs. ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Shared supplier modal ────────────────────────────────────────────────────

function SupplierModal({
  title, initial, onSave, onClose, loading, error,
}: {
  title: string;
  initial?: ContactBody;
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
    onSave({ name, phone: phone || undefined, email: email || undefined, address: address || undefined });
  };

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-xl w-full max-w-md shadow-xl">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-semibold text-slate-800">{title}</h2>
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-500" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}
          {[
            { label: 'Name *', value: name, setter: setName, required: true, type: 'text', placeholder: 'e.g. ABC Trading Co.' },
            { label: 'Phone', value: phone, setter: setPhone, required: false, type: 'text', placeholder: '+1 555 000 0000' },
            { label: 'Email', value: email, setter: setEmail, required: false, type: 'email', placeholder: 'contact@example.com' },
          ].map(({ label, value, setter, required, type, placeholder }) => (
            <div key={label}>
              <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
              <input required={required} type={type} value={value} onChange={(e) => setter(e.target.value)} placeholder={placeholder}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500" />
            </div>
          ))}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Address</label>
            <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
              placeholder="Street, City, Country" />
          </div>
          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-60">
              {loading ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Customer Modal (with credit section) ────────────────────────────────────

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
  const [creditLimit, setCreditLimit]     = useState(initial ? (initial.creditLimitCents / 100).toFixed(2) : '0.00');
  const [alertPct, setAlertPct]           = useState(initial?.creditAlertPct ?? 80);
  const [settleDays, setSettleDays]       = useState(initial?.creditSettleDays ?? '');

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSave({
      name,
      phone: phone || undefined,
      email: email || undefined,
      address: address || undefined,
      creditEnabled,
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
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-500" /></button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>}

          {/* Basic info */}
          <div className="space-y-3">
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Name *</label>
              <input required value={name} onChange={(e) => setName(e.target.value)}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                placeholder="e.g. John Smith" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Phone</label>
                <input value={phone} onChange={(e) => setPhone(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="+1 555 000 0000" />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1">Email</label>
                <input type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
                  placeholder="email@example.com" />
              </div>
            </div>
            <div>
              <label className="block text-xs font-medium text-slate-600 mb-1">Address</label>
              <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500 resize-none"
                placeholder="Street, City, Country" />
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
                    <label className="block text-xs font-medium text-slate-600 mb-1">Credit Limit ($)</label>
                    <input
                      type="number" min="0" step="0.01"
                      value={creditLimit}
                      onChange={(e) => setCreditLimit(e.target.value)}
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
                  <span>Requires <strong>sell_on_credit</strong> role permission to use at POS. Exceeding limit requires <strong>manage_credit</strong> permission.</span>
                </div>
              </div>
            )}
          </div>

          <div className="flex justify-end gap-3 pt-1">
            <button type="button" onClick={onClose} className="px-4 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
            <button type="submit" disabled={loading} className="px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700 disabled:opacity-60">
              {loading ? 'Saving…' : 'Save'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Supplier Table ────────────────────────────────────────────────────────────

function SupplierTable() {
  const queryClient = useQueryClient();
  const PAGE_SIZE = 15;
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; item: Supplier } | null>(null);
  const [modalError, setModalError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', search, page],
    queryFn: () => suppliersApi.list({ search: search || undefined, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['suppliers'] });

  const createMutation = useMutation({
    mutationFn: suppliersApi.create,
    onSuccess: () => { invalidate(); setModal(null); setModalError(''); },
    onError: (err: unknown) => setModalError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to save'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ContactBody }) => suppliersApi.update(id, body),
    onSuccess: () => { invalidate(); setModal(null); setModalError(''); },
    onError: (err: unknown) => setModalError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to save'),
  });

  const toggleMutation = useMutation({ mutationFn: suppliersApi.toggleActive, onSuccess: invalidate });

  const handleSave = (body: ContactBody) => {
    setModalError('');
    if (modal?.mode === 'create') createMutation.mutate(body);
    else if (modal?.mode === 'edit') updateMutation.mutate({ id: modal.item.id, body });
  };

  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search suppliers…"
            className="pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm w-60 focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <button onClick={() => { setModal({ mode: 'create' }); setModalError(''); }}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">
          <Plus className="w-4 h-4" /> Add Supplier
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Phone</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Email</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Address</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Orders</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="text-center py-12 text-slate-400">Loading…</td></tr>}
            {!isLoading && data?.data.length === 0 && <tr><td colSpan={7} className="text-center py-12 text-slate-400">No suppliers found</td></tr>}
            {data?.data.map((item) => (
              <tr key={item.id} className={`border-b border-slate-100 hover:bg-slate-50 ${!item.isActive ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3 font-medium text-slate-800">{item.name}</td>
                <td className="px-4 py-3 text-slate-500">{item.phone ?? '—'}</td>
                <td className="px-4 py-3 text-slate-500">{item.email ?? '—'}</td>
                <td className="px-4 py-3 text-slate-500 max-w-[160px] truncate">{item.address ?? '—'}</td>
                <td className="px-4 py-3 text-center text-slate-500">{item._count?.purchases ?? 0}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${item.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                    {item.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => { setModal({ mode: 'edit', item }); setModalError(''); }} className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => toggleMutation.mutate(item.id)} disabled={toggleMutation.isPending} className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700">
                      {item.isActive ? <ToggleRight className="w-4 h-4 text-green-600" /> : <ToggleLeft className="w-4 h-4" />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm text-slate-600">
            <span>{total} suppliers</span>
            <div className="flex items-center gap-2">
              <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="p-1 rounded hover:bg-slate-100 disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
              <span>Page {page} of {totalPages}</span>
              <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} className="p-1 rounded hover:bg-slate-100 disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </div>

      {modal && (
        <SupplierModal
          title={modal.mode === 'create' ? 'New Supplier' : 'Edit Supplier'}
          initial={modal.mode === 'edit' ? {
            ...modal.item,
            phone:   modal.item.phone   ?? undefined,
            email:   modal.item.email   ?? undefined,
            address: modal.item.address ?? undefined,
          } : undefined}
          onSave={handleSave}
          onClose={() => setModal(null)}
          loading={isSaving}
          error={modalError}
        />
      )}
    </div>
  );
}

// ─── Customer Table ───────────────────────────────────────────────────────────

function CustomerTable() {
  const queryClient = useQueryClient();
  const PAGE_SIZE = 15;
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [modal, setModal] = useState<{ mode: 'create' } | { mode: 'edit'; item: Customer } | null>(null);
  const [modalError, setModalError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['customers', search, page],
    queryFn: () => customersApi.list({ search: search || undefined, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['customers'] });

  const createMutation = useMutation({
    mutationFn: (body: CustomerBody) => customersApi.create(body),
    onSuccess: () => { invalidate(); setModal(null); setModalError(''); },
    onError: (err: unknown) => setModalError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to save'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: CustomerBody }) => customersApi.update(id, body),
    onSuccess: () => { invalidate(); setModal(null); setModalError(''); },
    onError: (err: unknown) => setModalError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to save'),
  });

  const toggleMutation = useMutation({ mutationFn: customersApi.toggleActive, onSuccess: invalidate });

  const handleSave = (body: CustomerBody) => {
    setModalError('');
    if (modal?.mode === 'create') createMutation.mutate(body);
    else if (modal?.mode === 'edit') updateMutation.mutate({ id: modal.item.id, body });
  };

  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / PAGE_SIZE);
  const isSaving = createMutation.isPending || updateMutation.isPending;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input value={search} onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            placeholder="Search customers…"
            className="pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm w-60 focus:outline-none focus:ring-2 focus:ring-brand-500" />
        </div>
        <button onClick={() => { setModal({ mode: 'create' }); setModalError(''); }}
          className="flex items-center gap-1.5 px-4 py-2 bg-brand-600 text-white rounded-lg text-sm font-medium hover:bg-brand-700">
          <Plus className="w-4 h-4" /> Add Customer
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Name</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Phone</th>
              <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Email</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Credit</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Sales</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Status</th>
              <th className="text-center px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody>
            {isLoading && <tr><td colSpan={7} className="text-center py-12 text-slate-400">Loading…</td></tr>}
            {!isLoading && data?.data.length === 0 && <tr><td colSpan={7} className="text-center py-12 text-slate-400">No customers found</td></tr>}
            {data?.data.map((item) => (
              <tr key={item.id} className={`border-b border-slate-100 hover:bg-slate-50 ${!item.isActive ? 'opacity-50' : ''}`}>
                <td className="px-4 py-3 font-medium text-slate-800">{item.name}</td>
                <td className="px-4 py-3 text-slate-500">{item.phone ?? '—'}</td>
                <td className="px-4 py-3 text-slate-500">{item.email ?? '—'}</td>
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
                <td className="px-4 py-3 text-center text-slate-500">{item._count?.sales ?? 0}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${item.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                    {item.isActive ? 'Active' : 'Inactive'}
                  </span>
                </td>
                <td className="px-4 py-3">
                  <div className="flex items-center justify-center gap-1">
                    <button onClick={() => { setModal({ mode: 'edit', item }); setModalError(''); }} className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700">
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button onClick={() => toggleMutation.mutate(item.id)} disabled={toggleMutation.isPending} className="p-1.5 rounded hover:bg-slate-100 text-slate-500 hover:text-slate-700">
                      {item.isActive ? <ToggleRight className="w-4 h-4 text-green-600" /> : <ToggleLeft className="w-4 h-4" />}
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100 text-sm text-slate-600">
            <span>{total} customers</span>
            <div className="flex items-center gap-2">
              <button disabled={page === 1} onClick={() => setPage((p) => p - 1)} className="p-1 rounded hover:bg-slate-100 disabled:opacity-40"><ChevronLeft className="w-4 h-4" /></button>
              <span>Page {page} of {totalPages}</span>
              <button disabled={page === totalPages} onClick={() => setPage((p) => p + 1)} className="p-1 rounded hover:bg-slate-100 disabled:opacity-40"><ChevronRight className="w-4 h-4" /></button>
            </div>
          </div>
        )}
      </div>

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

// ─── Page ─────────────────────────────────────────────────────────────────────

type Tab = 'suppliers' | 'customers';

export default function ContactsPage() {
  const [tab, setTab] = useState<Tab>('suppliers');

  return (
    <div className="p-6">
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800">Contacts</h1>
        <p className="text-sm text-slate-500 mt-0.5">Manage your suppliers and customers</p>
      </div>

      <div className="flex gap-1 border-b border-slate-200 mb-6">
        {([
          { key: 'suppliers', label: 'Suppliers' },
          { key: 'customers', label: 'Customers' },
        ] as { key: Tab; label: string }[]).map((t) => (
          <button
            key={t.key}
            onClick={() => setTab(t.key)}
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

      {tab === 'suppliers' && <SupplierTable />}
      {tab === 'customers' && <CustomerTable />}
    </div>
  );
}
