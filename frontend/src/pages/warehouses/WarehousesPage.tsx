import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Warehouse as WarehouseIcon, Plus, Search, X,
  MapPin, Package, ShoppingCart,
  CheckCircle, AlertCircle, Star, RefreshCw,
  MoreHorizontal, Edit2, ChevronRight,
  TrendingUp, Users, Trash2,
} from 'lucide-react';
import {
  warehousesApi,
  WAREHOUSE_TYPE_LABELS, WAREHOUSE_TYPE_COLORS,
  type Warehouse, type CreateWarehouseBody,
} from '../../services/warehouses';
import { useAuthStore } from '../../store/authStore';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(cents: number) {
  return `Rs. ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;
}
function fmtDate(iso: string) {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

const MOVEMENT_COLORS: Record<string, string> = {
  PURCHASE_IN:  'bg-green-100 text-green-700',
  SALE_OUT:     'bg-red-100 text-red-700',
  ADJUSTMENT:   'bg-amber-100 text-amber-700',
  TRANSFER_IN:  'bg-blue-100 text-blue-700',
  TRANSFER_OUT: 'bg-orange-100 text-orange-700',
  RETURN_IN:    'bg-purple-100 text-purple-700',
};

function relativeTime(iso: string): string {
  const ms = Date.now() - new Date(iso).getTime();
  const mins  = Math.floor(ms / 60_000);
  const hours = Math.floor(ms / 3_600_000);
  const days  = Math.floor(ms / 86_400_000);
  if (mins  < 1)   return 'just now';
  if (mins  < 60)  return `${mins}m ago`;
  if (hours < 24)  return `${hours}h ago`;
  if (days  < 7)   return `${days}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

function TypeBadge({ type }: { type: Warehouse['type'] }) {
  return (
    <span className={`inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-semibold ${WAREHOUSE_TYPE_COLORS[type]}`}>
      {WAREHOUSE_TYPE_LABELS[type]}
    </span>
  );
}

// ─── WarehouseForm Modal ──────────────────────────────────────────────────────

function WarehouseFormModal({
  initial,
  existingDefault,
  onClose,
  onSaved,
}: {
  initial?: Warehouse;
  existingDefault?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const qc   = useQueryClient();
  const { data: usersList = [] } = useQuery({
    queryKey: ['users-for-select'],
    queryFn:  () => import('../../services/users').then(m => m.usersApi.list({ page: 1, pageSize: 200 })).then(r => r.data),
    staleTime: 60_000,
  });

  const [f, setF] = useState<CreateWarehouseBody>({
    name:      initial?.name      ?? '',
    code:      initial?.code      ?? '',
    address:   initial?.address   ?? null,
    city:      initial?.city      ?? null,
    phone:     initial?.phone     ?? null,
    email:     initial?.email     ?? null,
    managerId: initial?.managerId ?? null,
    type:      initial?.type      ?? 'BRANCH',
    isDefault: initial?.isDefault ?? false,
    notes:     initial?.notes     ?? null,
  });
  const [error, setError] = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: () => initial
      ? warehousesApi.update(initial.id, f)
      : warehousesApi.create(f),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['warehouses'] });
      qc.invalidateQueries({ queryKey: ['inv-warehouses'] });
      qc.invalidateQueries({ queryKey: ['pos-warehouses'] });
      onSaved();
      onClose();
    },
    onError: (e: { response?: { data?: { message?: string } } }) => {
      setError(e?.response?.data?.message ?? 'Save failed');
    },
  });

  const inp = 'w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white';

  const showDefaultWarning = f.isDefault && !initial?.isDefault && existingDefault;

  return (
    <div className="fixed inset-0 bg-slate-900/60 flex items-center justify-center z-50 p-4 overflow-y-auto">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-2xl my-4">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <h2 className="text-base font-bold text-slate-800">
            {initial ? 'Edit Warehouse' : 'New Warehouse'}
          </h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
            <X size={16} />
          </button>
        </div>

        <div className="p-6 space-y-4">
          {/* Row 1: Name + Code */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Warehouse Name *</label>
              <input className={inp} value={f.name} onChange={e => setF(p => ({ ...p, name: e.target.value }))} placeholder="e.g. Main Warehouse" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Code * <span className="text-slate-400 font-normal">(uppercase)</span></label>
              <input className={inp} value={f.code}
                onChange={e => setF(p => ({ ...p, code: e.target.value.toUpperCase().replace(/[^A-Z0-9_-]/g, '') }))}
                placeholder="e.g. MAIN" maxLength={20} />
            </div>
          </div>

          {/* Row 2: Type + Manager */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Type</label>
              <select className={inp} value={f.type} onChange={e => setF(p => ({ ...p, type: e.target.value as Warehouse['type'] }))}>
                {(['MAIN', 'BRANCH', 'STORE', 'TRANSIT', 'VIRTUAL'] as const).map(t => (
                  <option key={t} value={t}>{WAREHOUSE_TYPE_LABELS[t]}</option>
                ))}
              </select>
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Manager</label>
              <select className={inp} value={f.managerId ?? ''} onChange={e => setF(p => ({ ...p, managerId: e.target.value || null }))}>
                <option value="">— No manager —</option>
                {(usersList as { id: string; fullName: string }[]).map((u) => (
                  <option key={u.id} value={u.id}>{u.fullName}</option>
                ))}
              </select>
            </div>
          </div>

          {/* Row 3: Address */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Address</label>
            <textarea className={`${inp} resize-none`} rows={2} value={f.address ?? ''}
              onChange={e => setF(p => ({ ...p, address: e.target.value || null }))}
              placeholder="Street address" />
          </div>

          {/* Row 4: City + Phone */}
          <div className="grid grid-cols-2 gap-4">
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">City</label>
              <input className={inp} value={f.city ?? ''} onChange={e => setF(p => ({ ...p, city: e.target.value || null }))} placeholder="e.g. Colombo" />
            </div>
            <div className="space-y-1.5">
              <label className="block text-sm font-medium text-slate-700">Phone</label>
              <input className={inp} value={f.phone ?? ''} onChange={e => setF(p => ({ ...p, phone: e.target.value || null }))} placeholder="+94 11 234 5678" />
            </div>
          </div>

          {/* Row 5: Email */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Email</label>
            <input className={inp} type="email" value={f.email ?? ''} onChange={e => setF(p => ({ ...p, email: e.target.value || null }))} placeholder="warehouse@company.com" />
          </div>

          {/* Row 6: Default toggle */}
          <div className="flex items-center justify-between py-2 px-3 bg-slate-50 rounded-lg">
            <div>
              <p className="text-sm font-medium text-slate-700">Default Warehouse</p>
              <p className="text-xs text-slate-500">Selected by default in POS and forms</p>
            </div>
            <button
              type="button"
              onClick={() => setF(p => ({ ...p, isDefault: !p.isDefault }))}
              className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${f.isDefault ? 'bg-indigo-600' : 'bg-slate-200'}`}
            >
              <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${f.isDefault ? 'translate-x-4' : 'translate-x-1'}`} />
            </button>
          </div>

          {showDefaultWarning && (
            <div className="flex items-center gap-2 text-sm text-amber-700 bg-amber-50 border border-amber-200 rounded-lg px-3 py-2">
              <AlertCircle size={14} />
              This will replace "{existingDefault}" as the default warehouse.
            </div>
          )}

          {/* Row 7: Notes */}
          <div className="space-y-1.5">
            <label className="block text-sm font-medium text-slate-700">Notes <span className="text-slate-400 font-normal">(optional)</span></label>
            <textarea className={`${inp} resize-none`} rows={2} value={f.notes ?? ''}
              onChange={e => setF(p => ({ ...p, notes: e.target.value || null }))}
              placeholder="Any notes about this warehouse…" />
          </div>

          {error && (
            <div className="flex items-center gap-2 text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
              <AlertCircle size={14} /> {error}
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200">
          <button onClick={onClose} className="px-4 py-2 text-sm font-medium border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 transition">
            Cancel
          </button>
          <button
            onClick={() => mutation.mutate()}
            disabled={!f.name || !f.code || mutation.isPending}
            className="px-4 py-2 text-sm font-medium bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? 'Saving…' : 'Save Warehouse'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── WarehouseDetailPanel ─────────────────────────────────────────────────────

function WarehouseDetailPanel({
  warehouseId,
  canManage,
  onEdit,
  onClose,
}: {
  warehouseId: string;
  canManage: boolean;
  onEdit: (w: Warehouse) => void;
  onClose: () => void;
}) {
  const [tab, setTab]             = useState<'overview' | 'stock' | 'activity'>('overview');
  const [confirmToggle, setConfirmToggle] = useState(false);
  const [toggleError,   setToggleError]   = useState<string | null>(null);
  const qc                        = useQueryClient();

  const { data: wh, isLoading } = useQuery({
    queryKey: ['warehouse', warehouseId],
    queryFn:  () => warehousesApi.get(warehouseId),
  });

  const { data: stats } = useQuery({
    queryKey: ['warehouse-stats', warehouseId],
    queryFn:  () => warehousesApi.getStats(warehouseId),
    enabled:  tab === 'overview' || tab === 'activity',
  });

  const toggleMut = useMutation({
    mutationFn: () => warehousesApi.toggle(warehouseId),
    onSuccess: () => {
      setConfirmToggle(false);
      setToggleError(null);
      qc.invalidateQueries({ queryKey: ['warehouses'] });
      qc.invalidateQueries({ queryKey: ['warehouse', warehouseId] });
      qc.invalidateQueries({ queryKey: ['inv-warehouses'] });
    },
    onError: (e: { response?: { data?: { message?: string } }; message?: string }) => {
      setToggleError(e?.response?.data?.message ?? e?.message ?? 'Failed to update warehouse');
    },
  });

  const defaultMut = useMutation({
    mutationFn: () => warehousesApi.setDefault(warehouseId),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['warehouses'] });
      qc.invalidateQueries({ queryKey: ['warehouse', warehouseId] });
      qc.invalidateQueries({ queryKey: ['inv-warehouses'] });
      qc.invalidateQueries({ queryKey: ['pos-warehouses'] });
    },
  });

  const tabs = [
    { key: 'overview' as const, label: 'Overview' },
    { key: 'stock'    as const, label: 'Stock' },
    { key: 'activity' as const, label: 'Activity' },
  ];

  return (
    <div className="flex flex-col h-full bg-white border-l border-slate-200">
      {/* Panel header */}
      <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200 shrink-0">
        <h3 className="font-bold text-slate-800 text-sm">Warehouse Detail</h3>
        <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
          <X size={15} />
        </button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center flex-1 text-slate-400 gap-2">
          <RefreshCw size={16} className="animate-spin" /> Loading…
        </div>
      )}

      {wh && (
        <>
          {/* Warehouse identity */}
          <div className="px-5 py-4 border-b border-slate-100 shrink-0">
            <div className="flex items-start justify-between gap-2">
              <div>
                <p className="font-bold text-slate-800">{wh.name}</p>
                <div className="flex items-center gap-2 mt-1">
                  <TypeBadge type={wh.type} />
                  {wh.isDefault && (
                    <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-semibold bg-yellow-100 text-yellow-700">
                      <Star size={9} fill="currentColor" /> Default
                    </span>
                  )}
                  <span className={`flex items-center gap-1 text-[10px] font-semibold ${wh.isActive ? 'text-emerald-600' : 'text-slate-400'}`}>
                    <span className={`w-1.5 h-1.5 rounded-full ${wh.isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
                    {wh.isActive ? 'Active' : 'Inactive'}
                  </span>
                </div>
              </div>
              {canManage && (
                <button onClick={() => onEdit(wh)} className="flex items-center gap-1.5 px-2.5 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 transition">
                  <Edit2 size={11} /> Edit
                </button>
              )}
            </div>
          </div>

          {/* Tabs */}
          <div className="flex gap-1 px-5 pt-3 pb-0 shrink-0 border-b border-slate-100">
            {tabs.map(t => (
              <button key={t.key} onClick={() => setTab(t.key)}
                className={`px-3 py-1.5 text-xs font-medium rounded-t-lg transition ${tab === t.key ? 'bg-white border border-b-white border-slate-200 -mb-px text-indigo-700' : 'text-slate-500 hover:text-slate-700'}`}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          <div className="flex-1 overflow-y-auto p-5 space-y-4">

            {/* ── OVERVIEW TAB ── */}
            {tab === 'overview' && (
              <>
                <div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm">
                  {[
                    { label: 'Code',    value: wh.code },
                    { label: 'Type',    value: WAREHOUSE_TYPE_LABELS[wh.type] },
                    { label: 'City',    value: wh.city ?? '—' },
                    { label: 'Phone',   value: wh.phone ?? '—' },
                    { label: 'Email',   value: wh.email ?? '—' },
                    { label: 'Manager', value: wh.manager?.fullName ?? '—' },
                    { label: 'Default', value: wh.isDefault ? 'Yes' : 'No' },
                    { label: 'Created', value: fmtDate(wh.createdAt) },
                  ].map(({ label, value }) => (
                    <div key={label}>
                      <p className="text-[10px] font-semibold text-slate-400 uppercase tracking-wide">{label}</p>
                      <p className="text-slate-800 mt-0.5 truncate">{value}</p>
                    </div>
                  ))}
                </div>

                {/* Stats */}
                {stats && (
                  <div className="grid grid-cols-3 gap-2 bg-slate-50 rounded-xl p-3">
                    <div className="text-center">
                      <p className="text-lg font-bold text-slate-800">{stats.totalProducts}</p>
                      <p className="text-[10px] text-slate-500">Products</p>
                    </div>
                    <div className="text-center border-x border-slate-200">
                      <p className="text-lg font-bold text-slate-800">{Number(stats.totalUnits).toFixed(0)}</p>
                      <p className="text-[10px] text-slate-500">Total units</p>
                    </div>
                    <div className="text-center">
                      <p className="text-lg font-bold text-slate-800">{stats.openShifts}</p>
                      <p className="text-[10px] text-slate-500">Open shifts</p>
                    </div>
                  </div>
                )}

                {/* Counts */}
                <div className="grid grid-cols-2 gap-2">
                  {[
                    { icon: Package,      label: 'Stock lines',  v: wh._count.stock },
                    { icon: ShoppingCart, label: 'Purchases',    v: wh._count.purchases },
                    { icon: TrendingUp,   label: 'Sales',        v: wh._count.sales },
                    { icon: Users,        label: 'Open shifts',  v: wh._count.posShifts },
                  ].map(({ icon: Icon, label, v }) => (
                    <div key={label} className="flex items-center gap-2 text-sm bg-slate-50 rounded-lg px-3 py-2">
                      <Icon size={13} className="text-slate-400 shrink-0" />
                      <span className="text-slate-600 flex-1">{label}</span>
                      <span className="font-bold text-slate-800">{v}</span>
                    </div>
                  ))}
                </div>

                {wh.notes && (
                  <div className="bg-amber-50 border border-amber-100 rounded-lg px-3 py-2.5">
                    <p className="text-[10px] font-semibold text-amber-600 uppercase tracking-wide mb-1">Notes</p>
                    <p className="text-sm text-slate-700">{wh.notes}</p>
                  </div>
                )}

                {/* Action buttons */}
                {canManage && (
                  <div className="space-y-2 pt-1">
                    {!wh.isDefault && (
                      <button
                        onClick={() => defaultMut.mutate()}
                        disabled={defaultMut.isPending}
                        className="w-full py-2 text-sm font-medium text-amber-700 bg-amber-50 border border-amber-200 rounded-lg hover:bg-amber-100 transition disabled:opacity-50"
                      >
                        {defaultMut.isPending ? 'Setting…' : '★ Set as Default'}
                      </button>
                    )}

                    {/* Inline deactivate confirmation */}
                    {confirmToggle && wh.isActive ? (
                      <div className="border border-red-200 bg-red-50 rounded-xl p-3 space-y-2">
                        <p className="text-sm font-semibold text-red-700 flex items-center gap-1.5">
                          <AlertCircle size={14} /> Deactivate "{wh.name}"?
                        </p>
                        <p className="text-xs text-red-600">
                          This warehouse will be hidden from all dropdowns and cannot receive new stock.
                        </p>
                        {toggleError && (
                          <p className="text-xs text-red-700 font-semibold">{toggleError}</p>
                        )}
                        <div className="flex gap-2 pt-1">
                          <button onClick={() => { setConfirmToggle(false); setToggleError(null); }}
                            className="flex-1 py-1.5 text-xs font-medium border border-slate-200 rounded-lg hover:bg-white text-slate-600 transition">
                            Cancel
                          </button>
                          <button onClick={() => toggleMut.mutate()}
                            disabled={toggleMut.isPending}
                            className="flex-1 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition disabled:opacity-50">
                            {toggleMut.isPending ? 'Deactivating…' : 'Deactivate'}
                          </button>
                        </div>
                      </div>
                    ) : (
                      <button
                        onClick={() => {
                          if (wh.isActive) { setConfirmToggle(true); setToggleError(null); }
                          else toggleMut.mutate();
                        }}
                        disabled={toggleMut.isPending}
                        className={`w-full py-2 text-sm font-medium rounded-lg border transition disabled:opacity-50 ${
                          wh.isActive
                            ? 'text-red-600 border-red-200 bg-red-50 hover:bg-red-100'
                            : 'text-emerald-700 border-emerald-200 bg-emerald-50 hover:bg-emerald-100'
                        }`}
                      >
                        {toggleMut.isPending ? 'Updating…' : wh.isActive ? 'Deactivate Warehouse' : 'Activate Warehouse'}
                      </button>
                    )}
                    {/* Show error when not in confirm mode (e.g. activate fails) */}
                    {toggleError && !confirmToggle && (
                      <p className="text-xs text-red-600 flex items-center gap-1">
                        <AlertCircle size={11} /> {toggleError}
                      </p>
                    )}
                  </div>
                )}
              </>
            )}

            {/* ── STOCK TAB ── */}
            {tab === 'stock' && (
              <>
                <div className="flex items-center justify-between mb-3">
                  <p className="text-sm font-semibold text-slate-700">Top products in this warehouse</p>
                  <Link
                    to={`/inventory?warehouse=${warehouseId}`}
                    className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
                  >
                    View full inventory <ChevronRight size={12} />
                  </Link>
                </div>
                {wh.stock.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 text-sm">No stock in this warehouse</div>
                ) : (
                  <div className="border border-slate-200 rounded-xl overflow-hidden">
                    <table className="w-full text-xs">
                      <thead className="bg-slate-50 border-b border-slate-200">
                        <tr>
                          <th className="text-left px-3 py-2 text-slate-500 font-semibold uppercase">Product</th>
                          <th className="text-right px-3 py-2 text-slate-500 font-semibold uppercase">Qty</th>
                          <th className="text-right px-3 py-2 text-slate-500 font-semibold uppercase">Value</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {wh.stock.map((s, i) => (
                          <tr key={i} className="hover:bg-slate-50">
                            <td className="px-3 py-2">
                              <p className="font-medium text-slate-800 truncate max-w-[140px]">{s.product.name}</p>
                              <p className="text-slate-400">{s.product.sku}</p>
                            </td>
                            <td className="px-3 py-2 text-right font-mono font-semibold text-slate-700">{Number(s.qty).toFixed(0)}</td>
                            <td className="px-3 py-2 text-right text-slate-500">{fmt(Number(s.qty) * s.product.costCents)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </>
            )}

            {/* ── ACTIVITY TAB ── */}
            {tab === 'activity' && (
              <>
                <p className="text-sm font-semibold text-slate-700 mb-3">Recent stock movements</p>
                {!stats || stats.recentMovements.length === 0 ? (
                  <div className="text-center py-8 text-slate-400 text-sm">No recent movements</div>
                ) : (
                  <div className="space-y-2">
                    {stats.recentMovements.map((m) => (
                      <div key={m.id} className="flex items-center gap-3 p-2.5 bg-slate-50 rounded-lg">
                        <span className={`px-1.5 py-0.5 rounded text-[10px] font-bold whitespace-nowrap ${MOVEMENT_COLORS[m.type] ?? 'bg-slate-100 text-slate-600'}`}>
                          {m.type.replaceAll('_', ' ')}
                        </span>
                        <div className="flex-1 min-w-0">
                          <p className="text-xs font-medium text-slate-800 truncate">{m.product.name}</p>
                          <p className="text-[10px] text-slate-400">{relativeTime(m.createdAt)}</p>
                        </div>
                        <span className={`text-xs font-bold font-mono ${Number(m.qty) > 0 ? 'text-emerald-600' : 'text-red-600'}`}>
                          {Number(m.qty) > 0 ? '+' : ''}{Number(m.qty).toFixed(1)}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>
        </>
      )}
    </div>
  );
}

// ─── WarehouseCard ────────────────────────────────────────────────────────────

function WarehouseCard({
  warehouse,
  selected,
  canManage,
  onSelect,
  onEdit,
  onToggle,
  onSetDefault,
}: {
  warehouse: Warehouse;
  selected:  boolean;
  canManage: boolean;
  onSelect:  () => void;
  onEdit:    () => void;
  onToggle:  () => void;
  onSetDefault: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div
      onClick={onSelect}
      className={`relative bg-white border rounded-xl p-4 cursor-pointer transition hover:shadow-md ${
        selected ? 'border-indigo-400 ring-1 ring-indigo-300' : 'border-slate-200 hover:border-slate-300'
      }`}
    >
      {/* Header row */}
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2 min-w-0">
          <div className="w-8 h-8 rounded-lg bg-indigo-100 flex items-center justify-center shrink-0">
            <WarehouseIcon size={15} className="text-indigo-600" />
          </div>
          <div className="min-w-0">
            <p className="font-bold text-slate-800 text-sm truncate">{warehouse.name}</p>
            <p className="text-[11px] text-slate-400">Code: {warehouse.code}</p>
          </div>
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {warehouse.isDefault && (
            <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[9px] font-bold bg-yellow-100 text-yellow-700">
              <Star size={8} fill="currentColor" /> DEFAULT
            </span>
          )}
          {canManage && (
            <div className="relative" onClick={e => e.stopPropagation()}>
              <button
                onClick={() => setMenuOpen(v => !v)}
                className="p-1 rounded hover:bg-slate-100 text-slate-400"
              >
                <MoreHorizontal size={14} />
              </button>
              {menuOpen && (
                <>
                  <div className="fixed inset-0 z-10" onClick={() => setMenuOpen(false)} />
                  <div className="absolute right-0 top-full mt-1 bg-white border border-slate-200 rounded-xl shadow-lg z-20 w-44 py-1 text-sm">
                    <button onClick={() => { onEdit(); setMenuOpen(false); }}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 text-slate-700 flex items-center gap-2">
                      <Edit2 size={13} /> Edit
                    </button>
                    {!warehouse.isDefault && (
                      <button onClick={() => { onSetDefault(); setMenuOpen(false); }}
                        className="w-full text-left px-3 py-2 hover:bg-slate-50 text-slate-700 flex items-center gap-2">
                        <Star size={13} /> Set as Default
                      </button>
                    )}
                    <Link to={`/inventory?warehouse=${warehouse.id}`} onClick={() => setMenuOpen(false)}
                      className="w-full text-left px-3 py-2 hover:bg-slate-50 text-slate-700 flex items-center gap-2">
                      <Package size={13} /> View Stock
                    </Link>
                    <hr className="my-1 border-slate-100" />
                    <button onClick={() => { onToggle(); setMenuOpen(false); }}
                      className={`w-full text-left px-3 py-2 hover:bg-slate-50 flex items-center gap-2 ${warehouse.isActive ? 'text-red-600' : 'text-emerald-600'}`}>
                      {warehouse.isActive ? <AlertCircle size={13} /> : <CheckCircle size={13} />}
                      {warehouse.isActive ? 'Deactivate' : 'Activate'}
                    </button>
                    <hr className="my-1 border-slate-100" />
                    <button
                      disabled
                      title="Warehouses cannot be deleted as they have transaction history. Deactivate instead."
                      className="w-full text-left px-3 py-2 flex items-center gap-2 text-slate-300 cursor-not-allowed text-sm"
                    >
                      <Trash2 size={13} /> Cannot Delete
                    </button>
                  </div>
                </>
              )}
            </div>
          )}
        </div>
      </div>

      {/* Info row */}
      <div className="flex flex-wrap items-center gap-2 mb-3">
        <TypeBadge type={warehouse.type} />
        {warehouse.city && (
          <span className="flex items-center gap-1 text-[11px] text-slate-500">
            <MapPin size={10} /> {warehouse.city}
          </span>
        )}
      </div>

      {/* Stats row */}
      <div className="flex items-center gap-4 text-[11px] text-slate-500 mb-3">
        <span className="flex items-center gap-1"><Package size={10} /> {warehouse._count.stock} products</span>
        <span className="flex items-center gap-1"><ShoppingCart size={10} /> {warehouse._count.purchases} purchases</span>
      </div>

      {/* Status */}
      <div className="flex items-center gap-1.5">
        <span className={`w-1.5 h-1.5 rounded-full ${warehouse.isActive ? 'bg-emerald-500 animate-pulse' : 'bg-slate-300'}`} />
        <span className={`text-[11px] font-medium ${warehouse.isActive ? 'text-emerald-600' : 'text-slate-400'}`}>
          {warehouse.isActive ? 'Active' : 'Inactive'}
        </span>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function WarehousesPage() {
  const { user }    = useAuthStore();
  const qc          = useQueryClient();
  const canManage   = user?.role === 'ADMIN' || user?.role === 'MANAGER';

  const [search,        setSearch]        = useState('');
  const [typeFilter,    setTypeFilter]    = useState('');
  const [statusFilter,  setStatusFilter]  = useState<'' | 'true' | 'false'>('');
  const [selected,      setSelected]      = useState<string | null>(null);
  const [showForm,      setShowForm]      = useState(false);
  const [editTarget,    setEditTarget]    = useState<Warehouse | null>(null);
  const [confirmToggle, setConfirmToggle] = useState<string | null>(null); // warehouse id being confirmed
  const [toggleError,   setToggleError]   = useState<string | null>(null);

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['warehouses', search, typeFilter, statusFilter],
    queryFn:  () => warehousesApi.list({
      search:   search   || undefined,
      type:     typeFilter || undefined,
      isActive: statusFilter === '' ? undefined : statusFilter === 'true',
      pageSize: 100,
    }),
    placeholderData: (prev) => prev,
  });

  const toggleMut = useMutation({
    mutationFn: (id: string) => warehousesApi.toggle(id),
    onSuccess: () => {
      setConfirmToggle(null);
      setToggleError(null);
      qc.invalidateQueries({ queryKey: ['warehouses'] });
      qc.invalidateQueries({ queryKey: ['inv-warehouses'] });
    },
    onError: (e: { response?: { data?: { message?: string } }; message?: string }) => {
      setToggleError(e?.response?.data?.message ?? e?.message ?? 'Failed to update warehouse');
    },
  });

  const defaultMut = useMutation({
    mutationFn: (id: string) => warehousesApi.setDefault(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['warehouses'] });
      qc.invalidateQueries({ queryKey: ['inv-warehouses'] });
      qc.invalidateQueries({ queryKey: ['pos-warehouses'] });
    },
  });

  const warehouses   = data?.items ?? [];
  const activeCount  = warehouses.filter(w => w.isActive).length;
  const openShifts   = warehouses.reduce((s, w) => s + w._count.posShifts, 0);
  const defaultWh    = warehouses.find(w => w.isDefault);

  const handleEdit = (w: Warehouse) => {
    setEditTarget(w);
    setShowForm(true);
  };

  const handleToggle = (w: Warehouse) => {
    if (w.isActive) {
      // Show inline confirmation instead of native browser dialog
      setConfirmToggle(w.id);
      setToggleError(null);
    } else {
      // Activating never needs confirmation
      toggleMut.mutate(w.id);
    }
  };

  // The warehouse being confirmed for deactivation
  const confirmingWarehouse = confirmToggle
    ? warehouses.find(w => w.id === confirmToggle) ?? null
    : null;

  return (
    <div className="h-full flex flex-col bg-slate-50">
      {/* ── Page header ── */}
      <div className="bg-white border-b border-slate-200 px-6 py-4 shrink-0">
        <div className="flex items-center justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
              <WarehouseIcon size={20} className="text-indigo-600" /> Warehouses
            </h1>
            <p className="text-sm text-slate-500 mt-0.5">Manage stock locations, branches and storage facilities</p>
          </div>
          <div className="flex items-center gap-3">
            <button onClick={() => refetch()} className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500 transition">
              <RefreshCw size={14} />
            </button>
            {canManage && (
              <button
                onClick={() => { setEditTarget(null); setShowForm(true); }}
                className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition"
              >
                <Plus size={15} /> New Warehouse
              </button>
            )}
          </div>
        </div>
      </div>

      {/* ── KPI tiles ── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 px-6 py-4 shrink-0">
        <div className="bg-indigo-600 text-white rounded-xl p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-indigo-200 mb-1">Total</p>
          <p className="text-2xl font-bold">{warehouses.length}</p>
          <p className="text-xs text-indigo-200 mt-0.5">warehouses</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">Active</p>
          <p className="text-2xl font-bold text-emerald-600">{activeCount}</p>
          <p className="text-xs text-slate-400 mt-0.5">of {warehouses.length} total</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">Default</p>
          <p className="text-sm font-bold text-slate-800 mt-1 truncate">{defaultWh?.name ?? '—'}</p>
          <p className="text-xs text-slate-400 mt-0.5">{defaultWh?.code ?? 'Not set'}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">Open Shifts</p>
          <p className={`text-2xl font-bold ${openShifts > 0 ? 'text-emerald-600' : 'text-slate-800'}`}>{openShifts}</p>
          <p className="text-xs text-slate-400 mt-0.5">open POS sessions</p>
        </div>
      </div>

      {/* ── Main content ── */}
      <div className="flex flex-1 overflow-hidden px-6 pb-6 gap-4">
        {/* Left: list */}
        <div className="flex flex-col flex-1 min-w-0">
          {/* Inline deactivate confirmation card */}
          {confirmingWarehouse && (
            <div className="mb-4 border border-red-200 bg-red-50 rounded-xl p-4 shrink-0">
              <p className="text-sm font-semibold text-red-700 flex items-center gap-1.5 mb-1">
                <AlertCircle size={14} /> Deactivate "{confirmingWarehouse.name}"?
              </p>
              <p className="text-xs text-red-600 mb-3">
                This warehouse will be hidden from all dropdowns and cannot receive new stock.
              </p>
              {toggleError && (
                <p className="text-xs text-red-700 font-semibold mb-2">{toggleError}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => { setConfirmToggle(null); setToggleError(null); }}
                  className="px-3 py-1.5 text-xs font-medium border border-slate-200 bg-white rounded-lg hover:bg-slate-50 text-slate-600 transition"
                >
                  Cancel
                </button>
                <button
                  onClick={() => toggleMut.mutate(confirmingWarehouse.id)}
                  disabled={toggleMut.isPending}
                  className="px-3 py-1.5 text-xs font-medium bg-red-600 hover:bg-red-700 text-white rounded-lg transition disabled:opacity-50"
                >
                  {toggleMut.isPending ? 'Deactivating…' : 'Yes, Deactivate'}
                </button>
              </div>
            </div>
          )}

          {/* Filter bar */}
          <div className="flex items-center gap-3 mb-4 shrink-0">
            <div className="relative flex-1">
              <Search size={13} className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
              <input
                className="w-full pl-8 pr-3 py-2 text-sm border border-slate-200 rounded-lg bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="Search name, code or city…"
                value={search}
                onChange={e => setSearch(e.target.value)}
              />
            </div>
            <select
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
            >
              <option value="">All Types</option>
              {(['MAIN', 'BRANCH', 'STORE', 'TRANSIT', 'VIRTUAL'] as const).map(t => (
                <option key={t} value={t}>{WAREHOUSE_TYPE_LABELS[t]}</option>
              ))}
            </select>
            <select
              className="border border-slate-200 rounded-lg px-3 py-2 text-sm bg-white focus:outline-none focus:ring-2 focus:ring-indigo-400"
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value as '' | 'true' | 'false')}
            >
              <option value="">All Status</option>
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
          </div>

          {/* Warehouse grid */}
          {isLoading ? (
            <div className="flex items-center justify-center flex-1 text-slate-400 gap-2">
              <RefreshCw size={18} className="animate-spin" /> Loading warehouses…
            </div>
          ) : warehouses.length === 0 ? (
            <div className="flex flex-col items-center justify-center flex-1 text-slate-400 gap-3">
              <div className="w-16 h-16 bg-slate-100 rounded-2xl flex items-center justify-center">
                <WarehouseIcon size={28} className="text-slate-300" />
              </div>
              <p className="text-base font-semibold text-slate-600">No warehouses found</p>
              <p className="text-sm text-slate-400 text-center max-w-xs">
                {search || typeFilter || statusFilter
                  ? 'Try adjusting your filters'
                  : 'Add your first warehouse to start managing stock locations'}
              </p>
              {canManage && !search && !typeFilter && !statusFilter && (
                <button
                  onClick={() => { setEditTarget(null); setShowForm(true); }}
                  className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white text-sm font-medium rounded-lg transition mt-1"
                >
                  <Plus size={14} /> Add Warehouse
                </button>
              )}
            </div>
          ) : (
            <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-3 overflow-y-auto">
              {warehouses.map(w => (
                <WarehouseCard
                  key={w.id}
                  warehouse={w}
                  selected={selected === w.id}
                  canManage={canManage}
                  onSelect={() => setSelected(v => v === w.id ? null : w.id)}
                  onEdit={() => handleEdit(w)}
                  onToggle={() => handleToggle(w)}
                  onSetDefault={() => defaultMut.mutate(w.id)}
                />
              ))}
            </div>
          )}
        </div>

        {/* Right: detail panel */}
        {selected && (
          <div className="w-96 shrink-0 rounded-xl overflow-hidden border border-slate-200 flex flex-col">
            <WarehouseDetailPanel
              warehouseId={selected}
              canManage={canManage}
              onEdit={handleEdit}
              onClose={() => setSelected(null)}
            />
          </div>
        )}
      </div>

      {/* ── Form modal ── */}
      {showForm && (
        <WarehouseFormModal
          initial={editTarget ?? undefined}
          existingDefault={defaultWh && !editTarget?.isDefault ? defaultWh.name : undefined}
          onClose={() => { setShowForm(false); setEditTarget(null); }}
          onSaved={() => {
            qc.invalidateQueries({ queryKey: ['warehouses'] });
          }}
        />
      )}
    </div>
  );
}
