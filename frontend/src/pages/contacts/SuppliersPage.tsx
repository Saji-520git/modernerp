import { useState, useMemo } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Search, Pencil, ToggleLeft, ToggleRight, X,
  ChevronLeft, ChevronRight, Building,
} from 'lucide-react';
import {
  suppliersApi,
  type ContactBody, type Supplier,
} from '../../services/contacts';
import { purchasesApi } from '../../services/purchases';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function formatCents(cents: number) {
  return `Rs. ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Supplier Modal ────────────────────────────────────────────────────────────

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
          <button onClick={onClose} className="p-1 hover:bg-slate-100 rounded-lg">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>
        <form onSubmit={handleSubmit} className="px-6 py-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm">{error}</div>
          )}
          {[
            { label: 'Name *',   value: name,  setter: setName,  required: true,  type: 'text',  placeholder: 'e.g. ABC Trading Co.' },
            { label: 'Phone',    value: phone, setter: setPhone,  required: false, type: 'text',  placeholder: '+94 77 000 0000' },
            { label: 'Email',    value: email, setter: setEmail,  required: false, type: 'email', placeholder: 'contact@example.com' },
          ].map(({ label, value, setter, required, type, placeholder }) => (
            <div key={label}>
              <label className="block text-xs font-medium text-slate-600 mb-1">{label}</label>
              <input
                required={required} type={type} value={value}
                onChange={(e) => setter(e.target.value)} placeholder={placeholder}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          ))}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Address</label>
            <textarea
              value={address} onChange={(e) => setAddress(e.target.value)} rows={2}
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
              placeholder="Street, City, Country"
            />
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

export default function SuppliersPage() {
  const queryClient = useQueryClient();
  const PAGE_SIZE = 15;
  const [search, setSearch] = useState('');
  const [page, setPage]     = useState(1);
  const [modal, setModal]   = useState<{ mode: 'create' } | { mode: 'edit'; item: Supplier } | null>(null);
  const [modalError, setModalError] = useState('');

  // ── Suppliers list ──────────────────────────────────────────────────────────
  const { data, isLoading } = useQuery({
    queryKey: ['suppliers', search, page],
    queryFn:  () => suppliersApi.list({ search: search || undefined, page, pageSize: PAGE_SIZE }),
    placeholderData: (prev) => prev,
  });

  // ── Outstanding purchases (CONFIRMED, UNPAID or PARTIAL) ───────────────────
  const { data: purchasesData } = useQuery({
    queryKey: ['supplier-outstanding'],
    queryFn:  () => purchasesApi.listPurchases({ status: 'CONFIRMED', pageSize: 100 }),
    staleTime: 60_000,
  });

  const outstandingBySupplier = useMemo(() => {
    const map: Record<string, number> = {};
    for (const po of purchasesData?.data ?? []) {
      if (po.paymentStatus === 'UNPAID' || po.paymentStatus === 'PARTIAL') {
        const owed = po.totalCents - po.paidCents;
        const sid  = po.supplier.id;
        map[sid] = (map[sid] ?? 0) + Math.max(0, owed);
      }
    }
    return map;
  }, [purchasesData]);

  // ── Mutations ───────────────────────────────────────────────────────────────
  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['suppliers'] });

  const createMutation = useMutation({
    mutationFn: suppliersApi.create,
    onSuccess: () => { invalidate(); setModal(null); setModalError(''); },
    onError: (err: unknown) =>
      setModalError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to save'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: ContactBody }) => suppliersApi.update(id, body),
    onSuccess: () => { invalidate(); setModal(null); setModalError(''); },
    onError: (err: unknown) =>
      setModalError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to save'),
  });

  const toggleMutation = useMutation({ mutationFn: suppliersApi.toggleActive, onSuccess: invalidate });

  const handleSave = (body: ContactBody) => {
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
          <h1 className="text-2xl font-bold text-slate-800">Suppliers</h1>
          <p className="text-sm text-slate-500 mt-0.5">
            Manage your suppliers and purchase contacts
          </p>
        </div>
        <button
          onClick={() => { setModal({ mode: 'create' }); setModalError(''); }}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 transition-colors"
        >
          <Plus size={16} />
          Add Supplier
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
              <th className="text-center px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Orders</th>
              <th className="text-right px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Outstanding</th>
              <th className="text-center px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Status</th>
              <th className="text-center px-4 py-3 font-medium text-slate-600 text-xs uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr><td colSpan={6} className="text-center py-12 text-slate-400">Loading…</td></tr>
            )}
            {!isLoading && (data?.data.length ?? 0) === 0 && (
              <tr>
                <td colSpan={6} className="px-4 py-12 text-center">
                  <Building size={32} className="mx-auto text-slate-300 mb-3" />
                  <p className="text-slate-500 font-medium">No suppliers found</p>
                  <p className="text-slate-400 text-xs mt-1">
                    Add your first supplier to start creating purchase orders
                  </p>
                </td>
              </tr>
            )}
            {data?.data.map((item) => {
              const outstanding = outstandingBySupplier[item.id] ?? 0;
              return (
                <tr
                  key={item.id}
                  className={`hover:bg-slate-50 transition-colors ${!item.isActive ? 'opacity-50' : ''}`}
                >
                  <td className="px-4 py-3">
                    <div className="font-medium text-slate-800">{item.name}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{item.address || '—'}</div>
                  </td>
                  <td className="px-4 py-3">
                    <div className="text-slate-700">{item.phone ?? '—'}</div>
                    <div className="text-xs text-slate-400 mt-0.5">{item.email ?? '—'}</div>
                  </td>
                  <td className="px-4 py-3 text-center text-slate-600">
                    {item._count?.purchases ?? 0}
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
            <span>{total} supplier{total !== 1 ? 's' : ''}</span>
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
        <SupplierModal
          title={modal.mode === 'create' ? 'New Supplier' : 'Edit Supplier'}
          initial={modal.mode === 'edit' ? {
            name:    modal.item.name,
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
