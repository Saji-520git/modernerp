import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Plus, Pencil, Trash2, X, Layers, Check } from 'lucide-react';
import { crmService } from '../../services/crmService';
import type { PriceTier, CreateTierDto } from '../../types/crm';

interface TierFormState {
  id?: string;
  name: string;
  description: string;
  isDefault: boolean;
  sortOrder: string;
}

const EMPTY_FORM: TierFormState = { name: '', description: '', isDefault: false, sortOrder: '0' };

function TierModal({ initial, onClose, onSave, loading, error }: {
  initial: TierFormState; onClose: () => void;
  onSave: (s: TierFormState) => void; loading: boolean; error: string;
}) {
  const [form, setForm] = useState<TierFormState>(initial);
  const isEdit = !!initial.id;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
          <h2 className="font-semibold text-slate-800">{isEdit ? 'Edit Price Tier' : 'New Price Tier'}</h2>
          <button onClick={onClose} className="text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Name</label>
            <input
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
              placeholder="e.g. Wholesale, VIP"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Description</label>
            <input
              value={form.description}
              onChange={(e) => setForm({ ...form, description: e.target.value })}
              placeholder="Optional"
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
            />
          </div>
          <div className="flex gap-4">
            <div className="w-28">
              <label className="block text-sm font-medium text-slate-700 mb-1">Sort Order</label>
              <input
                type="number"
                value={form.sortOrder}
                onChange={(e) => setForm({ ...form, sortOrder: e.target.value })}
                className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
              />
            </div>
            <label className="flex items-center gap-2 cursor-pointer mt-6">
              <input type="checkbox" checked={form.isDefault}
                onChange={(e) => setForm({ ...form, isDefault: e.target.checked })} />
              <span className="text-sm text-slate-700">Default tier</span>
            </label>
          </div>
          {error && <p className="text-sm text-red-600">{error}</p>}
        </div>
        <div className="flex justify-end gap-2 px-5 py-4 border-t border-slate-200">
          <button onClick={onClose} className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50">Cancel</button>
          <button onClick={() => onSave(form)} disabled={loading || !form.name.trim()}
            className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">
            {isEdit ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function PriceTiersPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [modalOpen, setModalOpen] = useState(false);
  const [editTier, setEditTier]   = useState<TierFormState | null>(null);
  const [error, setError]         = useState('');

  const { data: tiers, isLoading } = useQuery({ queryKey: ['crm', 'tiers'], queryFn: crmService.getTiers });

  const invalidate = () => queryClient.invalidateQueries({ queryKey: ['crm', 'tiers'] });

  const createMutation = useMutation({
    mutationFn: (body: CreateTierDto) => crmService.createTier(body),
    onSuccess: () => { invalidate(); setModalOpen(false); setError(''); },
    onError: (err: unknown) => setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to create tier'),
  });

  const updateMutation = useMutation({
    mutationFn: ({ id, body }: { id: string; body: CreateTierDto }) => crmService.updateTier(id, body),
    onSuccess: () => { invalidate(); setEditTier(null); setError(''); },
    onError: (err: unknown) => setError((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to update tier'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => crmService.deleteTier(id),
    onSuccess: invalidate,
    onError: (err: unknown) => alert((err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to delete tier'),
  });

  const handleSave = (s: TierFormState) => {
    const body: CreateTierDto = {
      name: s.name.trim(),
      description: s.description.trim() || null,
      isDefault: s.isDefault,
      sortOrder: parseInt(s.sortOrder, 10) || 0,
    };
    if (s.id) updateMutation.mutate({ id: s.id, body });
    else createMutation.mutate(body);
  };

  const toForm = (t: PriceTier): TierFormState => ({
    id: t.id, name: t.name, description: t.description ?? '', isDefault: t.isDefault, sortOrder: String(t.sortOrder),
  });

  return (
    <div className="p-6 max-w-3xl">
      <button onClick={() => navigate('/crm')}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4 transition-colors">
        <ArrowLeft size={14} /> Customer Intelligence
      </button>

      <div className="flex items-center justify-between mb-6">
        <div>
          <div className="flex items-center gap-2">
            <Layers size={22} className="text-indigo-600" />
            <h1 className="text-2xl font-bold text-slate-800">Price Tiers</h1>
          </div>
          <p className="text-sm text-slate-500">Group customers into pricing levels. Per-product tier prices are set on each product.</p>
        </div>
        <button onClick={() => { setError(''); setModalOpen(true); }}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 transition-colors">
          <Plus size={14} /> New Tier
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wide">Tier</th>
              <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500 uppercase tracking-wide">Default</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Customers</th>
              <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wide">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && <tr><td colSpan={4} className="text-center py-12 text-slate-400">Loading…</td></tr>}
            {!isLoading && (tiers?.length ?? 0) === 0 && (
              <tr><td colSpan={4} className="text-center py-12 text-slate-400">No price tiers yet. Create one to get started.</td></tr>
            )}
            {(tiers ?? []).map((t) => (
              <tr key={t.id} className="hover:bg-slate-50 transition-colors">
                <td className="px-4 py-3">
                  <p className="font-medium text-slate-800">{t.name}</p>
                  {t.description && <p className="text-xs text-slate-400">{t.description}</p>}
                </td>
                <td className="px-4 py-3 text-center">
                  {t.isDefault && <Check size={16} className="inline text-emerald-600" />}
                </td>
                <td className="px-4 py-3 text-right text-slate-600">{t._count?.customers ?? 0}</td>
                <td className="px-4 py-3 text-right">
                  <div className="flex justify-end gap-1">
                    <button onClick={() => { setError(''); setEditTier(toForm(t)); }}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded transition-colors">
                      <Pencil size={14} />
                    </button>
                    <button
                      onClick={() => { if (confirm(`Delete tier "${t.name}"?`)) deleteMutation.mutate(t.id); }}
                      disabled={(t._count?.customers ?? 0) > 0}
                      title={(t._count?.customers ?? 0) > 0 ? 'Cannot delete a tier with assigned customers' : 'Delete'}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-slate-400">
                      <Trash2 size={14} />
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {modalOpen && (
        <TierModal initial={EMPTY_FORM} onClose={() => setModalOpen(false)}
          onSave={handleSave} loading={createMutation.isPending} error={error} />
      )}
      {editTier && (
        <TierModal initial={editTier} onClose={() => setEditTier(null)}
          onSave={handleSave} loading={updateMutation.isPending} error={error} />
      )}
    </div>
  );
}
