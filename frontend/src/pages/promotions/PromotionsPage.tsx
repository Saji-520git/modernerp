import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Tag, Plus, Pencil, Trash2, X, Check, AlertCircle } from 'lucide-react';
import {
  promotionsApi, PROMO_TYPE_LABEL, PROMO_SCOPE_LABEL,
  type Promotion, type PromotionInput, type PromotionType, type PromotionScope,
} from '../../services/promotions';
import { productsApi } from '../../services/products';
import { useAppSettings } from '../../context/SettingsContext';

const toCents = (rupees: string) => Math.round(parseFloat(rupees || '0') * 100);
const toRupees = (cents: number | null | undefined) => cents != null ? (cents / 100).toString() : '';
const isoToLocal = (iso: string | null) => iso ? new Date(iso).toISOString().slice(0, 16) : '';
const localToIso = (v: string) => v ? new Date(v).toISOString() : null;

export default function PromotionsPage() {
  const qc = useQueryClient();
  const { formatMoney } = useAppSettings();
  const [editing, setEditing] = useState<Promotion | null>(null);
  const [creating, setCreating] = useState(false);

  const { data: promos = [], isLoading } = useQuery({ queryKey: ['promotions'], queryFn: promotionsApi.list });

  const removeMut = useMutation({
    mutationFn: (id: string) => promotionsApi.remove(id),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['promotions'] }),
  });

  const fmtValue = (p: Promotion) => p.type === 'PERCENT_OFF' ? `${p.value}%` : formatMoney(p.value);
  const fmtScope = (p: Promotion) => {
    if (p.scope === 'ALL') return 'Whole cart';
    return PROMO_SCOPE_LABEL[p.scope]; // specific target name resolved lazily; label is enough here
  };

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center">
            <Tag size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Promotions &amp; Offers</h1>
            <p className="text-sm text-slate-500">Discounts auto-applied at POS. Server-authoritative.</p>
          </div>
        </div>
        <button onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition">
          <Plus size={16} /> New Promotion
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        {isLoading ? (
          <p className="p-8 text-center text-slate-400">Loading…</p>
        ) : promos.length === 0 ? (
          <div className="p-10 text-center">
            <Tag size={32} className="mx-auto text-slate-300 mb-2" />
            <p className="text-slate-500 font-medium">No promotions yet</p>
            <p className="text-sm text-slate-400">Create your first offer to auto-discount at checkout.</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-200">
                <tr>
                  <th className="text-left px-4 py-3 font-semibold text-slate-500 uppercase text-xs">Name</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-500 uppercase text-xs">Type</th>
                  <th className="text-left px-4 py-3 font-semibold text-slate-500 uppercase text-xs">Applies to</th>
                  <th className="text-right px-4 py-3 font-semibold text-slate-500 uppercase text-xs">Value</th>
                  <th className="text-center px-4 py-3 font-semibold text-slate-500 uppercase text-xs">Priority</th>
                  <th className="text-center px-4 py-3 font-semibold text-slate-500 uppercase text-xs">Used</th>
                  <th className="text-center px-4 py-3 font-semibold text-slate-500 uppercase text-xs">Status</th>
                  <th className="px-4 py-3"></th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {promos.map((p) => (
                  <tr key={p.id} className="hover:bg-slate-50">
                    <td className="px-4 py-3">
                      <p className="font-medium text-slate-800">{p.name}</p>
                      {p.stackable && <span className="text-[10px] text-indigo-600">stackable</span>}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{PROMO_TYPE_LABEL[p.type]}</td>
                    <td className="px-4 py-3 text-slate-600">{fmtScope(p)}</td>
                    <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmtValue(p)}</td>
                    <td className="px-4 py-3 text-center text-slate-500">{p.priority}</td>
                    <td className="px-4 py-3 text-center text-slate-500">{p.timesUsed}</td>
                    <td className="px-4 py-3 text-center">
                      <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${p.active ? 'bg-green-100 text-green-700' : 'bg-slate-100 text-slate-500'}`}>
                        {p.active ? 'Active' : 'Inactive'}
                      </span>
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-end gap-1">
                        <button onClick={() => setEditing(p)} className="p-1.5 text-slate-400 hover:text-indigo-600 rounded" title="Edit"><Pencil size={15} /></button>
                        <button
                          onClick={() => { if (confirm(`Delete "${p.name}"? If it has been used, it is deactivated instead.`)) removeMut.mutate(p.id); }}
                          className="p-1.5 text-slate-400 hover:text-red-600 rounded" title="Delete"><Trash2 size={15} /></button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {(creating || editing) && (
        <PromotionModal
          promo={editing}
          onClose={() => { setCreating(false); setEditing(null); }}
          onSaved={() => { setCreating(false); setEditing(null); qc.invalidateQueries({ queryKey: ['promotions'] }); }}
        />
      )}
    </div>
  );
}

function PromotionModal({ promo, onClose, onSaved }: {
  promo: Promotion | null; onClose: () => void; onSaved: () => void;
}) {
  const isEdit = !!promo;
  const [f, setF] = useState({
    name:        promo?.name ?? '',
    description: promo?.description ?? '',
    type:        (promo?.type ?? 'PERCENT_OFF') as PromotionType,
    scope:       (promo?.scope ?? 'ALL') as PromotionScope,
    scopeCategoryId: promo?.scopeCategoryId ?? '',
    scopeBrandId:    promo?.scopeBrandId ?? '',
    scopeProductId:  promo?.scopeProductId ?? '',
    percentValue: promo && promo.type === 'PERCENT_OFF' ? String(promo.value) : '10',
    amountValue:  promo && promo.type === 'AMOUNT_OFF' ? toRupees(promo.value) : '',
    minQty:       promo?.minQty != null ? String(promo.minQty) : '',
    minCart:      toRupees(promo?.minCartCents),
    maxDiscount:  toRupees(promo?.maxDiscountCents),
    startsAt:     isoToLocal(promo?.startsAt ?? null),
    endsAt:       isoToLocal(promo?.endsAt ?? null),
    priority:     promo?.priority ?? 0,
    stackable:    promo?.stackable ?? false,
    active:       promo?.active ?? true,
    usageLimit:   promo?.usageLimit != null ? String(promo.usageLimit) : '',
  });
  const [error, setError] = useState<string | null>(null);

  const { data: meta } = useQuery({ queryKey: ['products-meta'], queryFn: productsApi.meta });
  const { data: productList } = useQuery({
    queryKey: ['promo-product-picker'],
    queryFn: () => productsApi.list({ pageSize: 500 }),
    enabled: f.scope === 'PRODUCT',
  });

  const qc = useQueryClient();
  const save = useMutation({
    mutationFn: (body: PromotionInput) => isEdit ? promotionsApi.update(promo!.id, body) : promotionsApi.create(body),
    onSuccess: onSaved,
    onError: (e: unknown) => setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Save failed'),
  });

  const submit = () => {
    setError(null);
    if (!f.name.trim()) { setError('Name is required'); return; }
    const body: PromotionInput = {
      name: f.name.trim(),
      description: f.description.trim() || null,
      type: f.type,
      scope: f.scope,
      scopeCategoryId: f.scope === 'CATEGORY' ? (f.scopeCategoryId || null) : null,
      scopeBrandId:    f.scope === 'BRAND'    ? (f.scopeBrandId || null)    : null,
      scopeProductId:  f.scope === 'PRODUCT'  ? (f.scopeProductId || null)  : null,
      value: f.type === 'PERCENT_OFF' ? Math.round(parseFloat(f.percentValue || '0')) : toCents(f.amountValue),
      minQty: f.minQty ? parseFloat(f.minQty) : null,
      minCartCents: f.minCart ? toCents(f.minCart) : null,
      maxDiscountCents: f.maxDiscount ? toCents(f.maxDiscount) : null,
      startsAt: localToIso(f.startsAt),
      endsAt: localToIso(f.endsAt),
      priority: Number(f.priority) || 0,
      stackable: f.stackable,
      active: f.active,
      usageLimit: f.usageLimit ? parseInt(f.usageLimit) : null,
    };
    if (f.scope === 'CATEGORY' && !body.scopeCategoryId) { setError('Select a category'); return; }
    if (f.scope === 'BRAND' && !body.scopeBrandId) { setError('Select a brand'); return; }
    if (f.scope === 'PRODUCT' && !body.scopeProductId) { setError('Select a product'); return; }
    if (f.type === 'PERCENT_OFF' && (body.value < 0 || body.value > 100)) { setError('Percentage must be 0–100'); return; }
    save.mutate(body);
  };

  const inp = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200';
  const lbl = 'block text-xs font-medium text-slate-600 mb-1';

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-lg max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100 sticky top-0 bg-white">
          <h2 className="text-base font-bold text-slate-800">{isEdit ? 'Edit Promotion' : 'New Promotion'}</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>

        <div className="p-5 space-y-4">
          {error && (
            <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700">
              <AlertCircle size={16} className="mt-0.5 flex-shrink-0" /> {error}
            </div>
          )}

          <div>
            <label className={lbl}>Name</label>
            <input className={inp} value={f.name} onChange={(e) => setF((p) => ({ ...p, name: e.target.value }))} placeholder="e.g. Weekend 10% off Beverages" />
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Type</label>
              <select className={inp} value={f.type} onChange={(e) => setF((p) => ({ ...p, type: e.target.value as PromotionType }))}>
                <option value="PERCENT_OFF">Percentage off</option>
                <option value="AMOUNT_OFF">Fixed amount off</option>
              </select>
            </div>
            <div>
              <label className={lbl}>{f.type === 'PERCENT_OFF' ? 'Percent (%)' : 'Amount (Rs.)'}</label>
              {f.type === 'PERCENT_OFF' ? (
                <input className={inp} type="number" min={0} max={100} value={f.percentValue} onChange={(e) => setF((p) => ({ ...p, percentValue: e.target.value }))} />
              ) : (
                <input className={inp} type="number" min={0} step="0.01" value={f.amountValue} onChange={(e) => setF((p) => ({ ...p, amountValue: e.target.value }))} />
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Applies to</label>
              <select className={inp} value={f.scope} onChange={(e) => setF((p) => ({ ...p, scope: e.target.value as PromotionScope }))}>
                <option value="ALL">Whole cart</option>
                <option value="CATEGORY">A category</option>
                <option value="BRAND">A brand</option>
                <option value="PRODUCT">A product</option>
              </select>
            </div>
            <div>
              {f.scope === 'CATEGORY' && (
                <>
                  <label className={lbl}>Category</label>
                  <select className={inp} value={f.scopeCategoryId} onChange={(e) => setF((p) => ({ ...p, scopeCategoryId: e.target.value }))}>
                    <option value="">Select…</option>
                    {meta?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                  </select>
                </>
              )}
              {f.scope === 'BRAND' && (
                <>
                  <label className={lbl}>Brand</label>
                  <select className={inp} value={f.scopeBrandId} onChange={(e) => setF((p) => ({ ...p, scopeBrandId: e.target.value }))}>
                    <option value="">Select…</option>
                    {meta?.brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                  </select>
                </>
              )}
              {f.scope === 'PRODUCT' && (
                <>
                  <label className={lbl}>Product</label>
                  <select className={inp} value={f.scopeProductId} onChange={(e) => setF((p) => ({ ...p, scopeProductId: e.target.value }))}>
                    <option value="">Select…</option>
                    {productList?.data.map((pr) => <option key={pr.id} value={pr.id}>{pr.name}</option>)}
                  </select>
                </>
              )}
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Min qty on line (optional)</label>
              <input className={inp} type="number" min={0} value={f.minQty} onChange={(e) => setF((p) => ({ ...p, minQty: e.target.value }))} placeholder="—" />
            </div>
            <div>
              <label className={lbl}>Min cart total Rs. (optional)</label>
              <input className={inp} type="number" min={0} step="0.01" value={f.minCart} onChange={(e) => setF((p) => ({ ...p, minCart: e.target.value }))} placeholder="—" />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className={lbl}>Starts (optional)</label>
              <input className={inp} type="datetime-local" value={f.startsAt} onChange={(e) => setF((p) => ({ ...p, startsAt: e.target.value }))} />
            </div>
            <div>
              <label className={lbl}>Ends (optional)</label>
              <input className={inp} type="datetime-local" value={f.endsAt} onChange={(e) => setF((p) => ({ ...p, endsAt: e.target.value }))} />
            </div>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className={lbl}>Priority</label>
              <input className={inp} type="number" value={f.priority} onChange={(e) => setF((p) => ({ ...p, priority: Number(e.target.value) }))} />
            </div>
            <div>
              <label className={lbl}>Max discount Rs.</label>
              <input className={inp} type="number" min={0} step="0.01" value={f.maxDiscount} onChange={(e) => setF((p) => ({ ...p, maxDiscount: e.target.value }))} placeholder="—" />
            </div>
            <div>
              <label className={lbl}>Usage limit</label>
              <input className={inp} type="number" min={1} value={f.usageLimit} onChange={(e) => setF((p) => ({ ...p, usageLimit: e.target.value }))} placeholder="∞" />
            </div>
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input type="checkbox" checked={f.stackable} onChange={(e) => setF((p) => ({ ...p, stackable: e.target.checked }))} />
              Stackable (combines with other promos)
            </label>
            <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
              <input type="checkbox" checked={f.active} onChange={(e) => setF((p) => ({ ...p, active: e.target.checked }))} />
              Active
            </label>
          </div>
        </div>

        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100 sticky bottom-0 bg-white">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button onClick={submit} disabled={save.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-60">
            <Check size={16} /> {save.isPending ? 'Saving…' : isEdit ? 'Save changes' : 'Create promotion'}
          </button>
        </div>
      </div>
    </div>
  );
}
