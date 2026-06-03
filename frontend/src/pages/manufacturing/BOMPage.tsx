import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Search, Layers, Trash2, Pencil, X, RefreshCw, Package,
} from 'lucide-react';
import { manufacturingService } from '../../services/manufacturingService';
import { productsApi } from '../../services/products';
import type { BOM, BOMLineInput, CreateBOMDto } from '../../types/manufacturing';

const money = (cents: number) => `Rs. ${(cents / 100).toFixed(2)}`;

interface FormLine extends BOMLineInput {
  key: string;
}

interface FormState {
  id: string | null;
  productId: string;
  name: string;
  yieldQty: number;
  notes: string;
  lines: FormLine[];
}

const emptyForm = (): FormState => ({
  id: null,
  productId: '',
  name: '',
  yieldQty: 1,
  notes: '',
  lines: [{ key: crypto.randomUUID(), materialId: '', qty: 1, notes: '' }],
});

export default function BOMPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [showForm, setShowForm] = useState(false);
  const [form, setForm] = useState<FormState>(emptyForm());
  const [error, setError] = useState<string | null>(null);

  const { data: boms = [], isLoading } = useQuery<BOM[]>({
    queryKey: ['boms'],
    queryFn: () => manufacturingService.listBOMs(),
  });

  const { data: productResp } = useQuery({
    queryKey: ['products-for-bom'],
    queryFn: () => productsApi.list({ pageSize: 1000, isActive: 'true' }),
  });
  const products = productResp?.data ?? [];

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return boms;
    return boms.filter(
      (b) => b.name.toLowerCase().includes(q) || b.product.name.toLowerCase().includes(q),
    );
  }, [boms, search]);

  const saveMutation = useMutation({
    mutationFn: (payload: { id: string | null; dto: CreateBOMDto }) =>
      payload.id
        ? manufacturingService.updateBOM(payload.id, {
            name: payload.dto.name,
            yieldQty: payload.dto.yieldQty,
            notes: payload.dto.notes,
            lines: payload.dto.lines,
          })
        : manufacturingService.createBOM(payload.dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['boms'] });
      setShowForm(false);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Failed to save BOM');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => manufacturingService.removeBOM(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['boms'] }),
  });

  const openNew = () => {
    setForm(emptyForm());
    setError(null);
    setShowForm(true);
  };

  const openEdit = (bom: BOM) => {
    setForm({
      id: bom.id,
      productId: bom.productId,
      name: bom.name,
      yieldQty: Number(bom.yieldQty),
      notes: bom.notes ?? '',
      lines: bom.lines.map((l) => ({
        key: l.id,
        materialId: l.materialId,
        qty: Number(l.qty),
        notes: l.notes ?? '',
      })),
    });
    setError(null);
    setShowForm(true);
  };

  const updateLine = (key: string, patch: Partial<FormLine>) =>
    setForm((f) => ({ ...f, lines: f.lines.map((l) => (l.key === key ? { ...l, ...patch } : l)) }));

  const addLine = () =>
    setForm((f) => ({
      ...f,
      lines: [...f.lines, { key: crypto.randomUUID(), materialId: '', qty: 1, notes: '' }],
    }));

  const removeLine = (key: string) =>
    setForm((f) => ({ ...f, lines: f.lines.filter((l) => l.key !== key) }));

  const submit = () => {
    setError(null);
    if (!form.productId) return setError('Select a finished product');
    if (!form.name.trim()) return setError('Enter a BOM name');
    const cleanLines = form.lines.filter((l) => l.materialId && l.qty > 0);
    if (cleanLines.length === 0) return setError('Add at least one material line');
    const dto: CreateBOMDto = {
      productId: form.productId,
      name: form.name.trim(),
      yieldQty: form.yieldQty > 0 ? form.yieldQty : 1,
      notes: form.notes.trim() || null,
      lines: cleanLines.map((l) => ({ materialId: l.materialId, qty: l.qty, notes: l.notes || null })),
    };
    saveMutation.mutate({ id: form.id, dto });
  };

  // Estimate material cost live while editing the form.
  const formCostCents = useMemo(() => {
    return form.lines.reduce((sum, l) => {
      const p = products.find((pr) => pr.id === l.materialId);
      if (!p) return sum;
      return sum + Math.round(p.costCents * (l.qty || 0));
    }, 0);
  }, [form.lines, products]);

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Layers className="w-5 h-5 text-indigo-600" /> Bill of Materials
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">Recipes that define what goes into each product</p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition">
          <Plus className="w-4 h-4" /> New BOM
        </button>
      </div>

      {/* Search */}
      <div className="relative max-w-md">
        <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
        <input value={search} onChange={(e) => setSearch(e.target.value)}
          placeholder="Search by product or BOM name…"
          className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <Layers className="w-10 h-10 mx-auto text-slate-200 mb-2" />
            <p className="text-sm">No BOMs yet</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Product</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">BOM Name</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500">Yield</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500">Materials</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">Material Cost</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {filtered.map((b) => (
                <tr key={b.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-semibold text-slate-800">{b.product.name}</td>
                  <td className="px-4 py-3 text-slate-600">{b.name}</td>
                  <td className="px-4 py-3 text-center text-slate-600">{Number(b.yieldQty)}</td>
                  <td className="px-4 py-3 text-center text-slate-600">{b._count?.lines ?? b.lines.length}</td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-800">{money(b.materialCostCents)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                      b.isActive ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'
                    }`}>
                      {b.isActive ? 'Active' : 'Inactive'}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      <button onClick={() => openEdit(b)}
                        className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 rounded">
                        <Pencil className="w-4 h-4" />
                      </button>
                      <button onClick={() => { if (confirm(`Delete BOM for ${b.product.name}?`)) deleteMutation.mutate(b.id); }}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* Form modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-2xl max-h-[90vh] overflow-y-auto">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 sticky top-0 bg-white">
              <h2 className="font-bold text-slate-800">{form.id ? 'Edit BOM' : 'New BOM'}</h2>
              <button onClick={() => setShowForm(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>

            <div className="p-6 space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Finished Product</label>
                  <select value={form.productId} disabled={!!form.id}
                    onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm disabled:bg-slate-50">
                    <option value="">Select product…</option>
                    {products.map((p) => (
                      <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                    ))}
                  </select>
                </div>
                <div>
                  <label className="block text-xs font-semibold text-slate-500 mb-1">Yield (units per batch)</label>
                  <input type="number" min={0} step="any" value={form.yieldQty}
                    onChange={(e) => setForm((f) => ({ ...f, yieldQty: parseFloat(e.target.value) || 0 }))}
                    className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">BOM Name</label>
                <input value={form.name}
                  onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                  placeholder="e.g. White Bread Recipe"
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
              </div>

              {/* Lines */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="text-xs font-semibold text-slate-500">Materials</label>
                  <button onClick={addLine} className="text-xs text-indigo-600 font-semibold flex items-center gap-1">
                    <Plus className="w-3 h-3" /> Add material
                  </button>
                </div>
                <div className="space-y-2">
                  {form.lines.map((l) => (
                    <div key={l.key} className="flex items-center gap-2">
                      <select value={l.materialId}
                        onChange={(e) => updateLine(l.key, { materialId: e.target.value })}
                        className="flex-1 px-2 py-1.5 border border-slate-200 rounded-lg text-sm">
                        <option value="">Material…</option>
                        {products.map((p) => (
                          <option key={p.id} value={p.id}>{p.name}</option>
                        ))}
                      </select>
                      <input type="number" min={0} step="any" value={l.qty}
                        onChange={(e) => updateLine(l.key, { qty: parseFloat(e.target.value) || 0 })}
                        placeholder="Qty"
                        className="w-24 px-2 py-1.5 border border-slate-200 rounded-lg text-sm" />
                      <button onClick={() => removeLine(l.key)}
                        className="p-1.5 text-slate-400 hover:text-red-600 hover:bg-red-50 rounded">
                        <Trash2 className="w-4 h-4" />
                      </button>
                    </div>
                  ))}
                </div>
              </div>

              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Notes</label>
                <textarea value={form.notes} rows={2}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none" />
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-slate-100">
                <div className="text-sm text-slate-500 flex items-center gap-1.5">
                  <Package className="w-4 h-4" /> Estimated material cost:
                  <span className="font-semibold text-slate-800">{money(formCostCents)}</span>
                </div>
                <div className="flex gap-2">
                  <button onClick={() => setShowForm(false)}
                    className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm font-semibold hover:bg-slate-50">
                    Cancel
                  </button>
                  <button onClick={submit} disabled={saveMutation.isPending}
                    className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
                    {saveMutation.isPending ? 'Saving…' : form.id ? 'Update BOM' : 'Create BOM'}
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
