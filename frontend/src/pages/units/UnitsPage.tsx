import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Search, Plus, Edit2, Trash2, ToggleLeft, ToggleRight, Ruler } from 'lucide-react';
import {
  unitsApi,
  UNIT_TYPE_LABELS,
  UNIT_TYPE_COLORS,
  type Unit,
  type UnitBody,
  type UnitType,
} from '../../services/units';

function cls(...args: (string | false | null | undefined)[]) {
  return args.filter(Boolean).join(' ');
}

// ─── Unit Form Modal ──────────────────────────────────────────────────────────

interface UnitFormProps {
  initial?: Unit | null;
  onSave:   (data: UnitBody) => void;
  onCancel: () => void;
  saving:   boolean;
  error?:   string;
}

const UNIT_TYPES: UnitType[] = ['COUNT', 'WEIGHT', 'VOLUME', 'LENGTH', 'OTHER'];

function UnitForm({ initial, onSave, onCancel, saving, error }: UnitFormProps) {
  const [name,         setName]         = useState(initial?.name         ?? '');
  const [shortCode,    setShortCode]    = useState(initial?.shortCode    ?? '');
  const [type,         setType]         = useState<UnitType>(initial?.type ?? 'COUNT');
  const [allowDecimal, setAllowDecimal] = useState(initial?.allowDecimal ?? false);
  const [isActive,     setIsActive]     = useState(initial?.isActive     ?? true);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    onSave({ name: name.trim(), shortCode: shortCode.trim(), type, allowDecimal, isActive });
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
      <div className="bg-white rounded-xl shadow-xl w-full max-w-md p-6">
        <h2 className="text-lg font-semibold text-slate-800 mb-5">
          {initial ? 'Edit Unit' : 'New Unit'}
        </h2>

        {error && (
          <div className="mb-4 px-4 py-3 rounded-lg bg-red-50 text-red-700 text-sm">{error}</div>
        )}

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Unit Name *</label>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. Piece, Box, Kilogram"
              required
            />
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Short Code *</label>
            <input
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              value={shortCode}
              onChange={(e) => setShortCode(e.target.value.slice(0, 10))}
              placeholder="e.g. pcs, box, kg"
              maxLength={10}
              required
            />
            <p className="mt-1 text-xs text-slate-400">Max 10 characters</p>
          </div>

          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">Type *</label>
            <select
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
              value={type}
              onChange={(e) => setType(e.target.value as UnitType)}
            >
              {UNIT_TYPES.map((t) => (
                <option key={t} value={t}>{UNIT_TYPE_LABELS[t]}</option>
              ))}
            </select>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-700">Allow Decimal Quantities</p>
              <p className="text-xs text-slate-400">e.g. 1.5 kg, 0.25 liters</p>
            </div>
            <button
              type="button"
              onClick={() => setAllowDecimal((v) => !v)}
              className={cls(
                'relative inline-flex h-6 w-11 items-center rounded-full transition',
                allowDecimal ? 'bg-brand-600' : 'bg-slate-200',
              )}
            >
              <span className={cls('inline-block h-4 w-4 rounded-full bg-white shadow transition', allowDecimal ? 'translate-x-6' : 'translate-x-1')} />
            </button>
          </div>

          <div className="flex items-center justify-between">
            <div>
              <p className="text-sm font-medium text-slate-700">Active</p>
            </div>
            <button
              type="button"
              onClick={() => setIsActive((v) => !v)}
              className={cls(
                'relative inline-flex h-6 w-11 items-center rounded-full transition',
                isActive ? 'bg-brand-600' : 'bg-slate-200',
              )}
            >
              <span className={cls('inline-block h-4 w-4 rounded-full bg-white shadow transition', isActive ? 'translate-x-6' : 'translate-x-1')} />
            </button>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button
              type="button"
              onClick={onCancel}
              className="px-4 py-2 text-sm rounded-lg border border-slate-200 text-slate-700 hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={saving}
              className="px-4 py-2 text-sm rounded-lg bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save Unit'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function UnitsPage() {
  const qc = useQueryClient();

  const [search,     setSearch]     = useState('');
  const [typeFilter, setTypeFilter] = useState<string>('');
  const [page,       setPage]       = useState(1);
  const [showForm,   setShowForm]   = useState(false);
  const [editing,    setEditing]    = useState<Unit | null>(null);
  const [formError,  setFormError]  = useState<string | undefined>();
  const [confirmDel, setConfirmDel] = useState<Unit | null>(null);

  const PAGE_SIZE = 20;

  const { data, isLoading } = useQuery({
    queryKey: ['units', search, typeFilter, page],
    queryFn: () =>
      unitsApi.list({
        search:   search || undefined,
        type:     (typeFilter as UnitType) || undefined,
        isActive: 'all',
        page,
        pageSize: PAGE_SIZE,
      }),
  });

  const createMut = useMutation({
    mutationFn: (body: UnitBody) => unitsApi.create(body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['units'] });
      setShowForm(false);
      setFormError(undefined);
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setFormError(err.response?.data?.message ?? 'Failed to create unit');
    },
  });

  const updateMut = useMutation({
    mutationFn: ({ id, body }: { id: string; body: Partial<UnitBody> }) =>
      unitsApi.update(id, body),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['units'] });
      setEditing(null);
      setFormError(undefined);
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      setFormError(err.response?.data?.message ?? 'Failed to update unit');
    },
  });

  const toggleMut = useMutation({
    mutationFn: (unit: Unit) =>
      unitsApi.update(unit.id, { isActive: !unit.isActive }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['units'] }),
  });

  const deleteMut = useMutation({
    mutationFn: (id: string) => unitsApi.softDelete(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['units'] });
      setConfirmDel(null);
    },
    onError: (err: { response?: { data?: { message?: string } } }) => {
      alert(err.response?.data?.message ?? 'Cannot delete this unit');
      setConfirmDel(null);
    },
  });

  const totalPages = Math.ceil((data?.total ?? 0) / PAGE_SIZE);

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Units</h1>
          <p className="text-sm text-slate-500 mt-0.5">Manage measurement units for products</p>
        </div>
        <button
          onClick={() => { setShowForm(true); setFormError(undefined); }}
          className="flex items-center gap-2 px-4 py-2 rounded-lg bg-brand-600 text-white text-sm font-medium hover:bg-brand-700"
        >
          <Plus size={16} /> New Unit
        </button>
      </div>

      {/* Filters */}
      <div className="flex gap-3 mb-4">
        <div className="relative flex-1 max-w-xs">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <input
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
            placeholder="Search units…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
          />
        </div>
        <select
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-500"
          value={typeFilter}
          onChange={(e) => { setTypeFilter(e.target.value); setPage(1); }}
        >
          <option value="">All Types</option>
          {(['COUNT', 'WEIGHT', 'VOLUME', 'LENGTH', 'OTHER'] as UnitType[]).map((t) => (
            <option key={t} value={t}>{UNIT_TYPE_LABELS[t]}</option>
          ))}
        </select>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-100 bg-slate-50">
              <th className="text-left px-4 py-3 font-medium text-slate-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Short Code</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Type</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Decimal</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Products</th>
              <th className="text-left px-4 py-3 font-medium text-slate-600">Status</th>
              <th className="px-4 py-3" />
            </tr>
          </thead>
          <tbody>
            {isLoading && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">Loading…</td>
              </tr>
            )}
            {!isLoading && data?.data.length === 0 && (
              <tr>
                <td colSpan={7} className="px-4 py-10 text-center text-slate-400">No units found</td>
              </tr>
            )}
            {data?.data.map((unit) => {
              const productCount =
                (unit._count?.productsAsBase ?? 0) +
                (unit._count?.productsAsPurchase ?? 0) +
                (unit._count?.productsAsSales ?? 0);
              return (
                <tr key={unit.id} className="border-b border-slate-50 hover:bg-slate-50">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Ruler size={14} className="text-slate-400" />
                      <span className="font-medium text-slate-800">{unit.name}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <code className="bg-slate-100 text-slate-700 px-2 py-0.5 rounded text-xs">
                      {unit.shortCode}
                    </code>
                  </td>
                  <td className="px-4 py-3">
                    <span className={cls('text-xs font-medium px-2 py-0.5 rounded-full', UNIT_TYPE_COLORS[unit.type])}>
                      {UNIT_TYPE_LABELS[unit.type]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs">
                    {unit.allowDecimal ? 'Yes' : 'No'}
                  </td>
                  <td className="px-4 py-3 text-slate-500">
                    {productCount > 0 ? (
                      <span className="bg-indigo-50 text-indigo-700 text-xs px-2 py-0.5 rounded-full font-medium">
                        {productCount}
                      </span>
                    ) : (
                      <span className="text-slate-300 text-xs">—</span>
                    )}
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => toggleMut.mutate(unit)}
                      className="flex items-center gap-1.5 text-xs"
                    >
                      {unit.isActive ? (
                        <>
                          <ToggleRight size={18} className="text-green-500" />
                          <span className="text-green-700">Active</span>
                        </>
                      ) : (
                        <>
                          <ToggleLeft size={18} className="text-slate-400" />
                          <span className="text-slate-400">Inactive</span>
                        </>
                      )}
                    </button>
                  </td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2 justify-end">
                      <button
                        onClick={() => { setEditing(unit); setFormError(undefined); }}
                        className="p-1.5 rounded hover:bg-slate-100 text-slate-500"
                        title="Edit"
                      >
                        <Edit2 size={14} />
                      </button>
                      <button
                        onClick={() => setConfirmDel(unit)}
                        className="p-1.5 rounded hover:bg-red-50 text-slate-400 hover:text-red-500"
                        title="Deactivate"
                      >
                        <Trash2 size={14} />
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        {/* Pagination */}
        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <span className="text-xs text-slate-500">
              {data?.total} units total
            </span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => setPage((p) => p - 1)}
                className="px-3 py-1.5 text-xs rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
              >
                Previous
              </button>
              <span className="px-3 py-1.5 text-xs text-slate-500">
                {page} / {totalPages}
              </span>
              <button
                disabled={page >= totalPages}
                onClick={() => setPage((p) => p + 1)}
                className="px-3 py-1.5 text-xs rounded border border-slate-200 disabled:opacity-40 hover:bg-slate-50"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Create form */}
      {showForm && (
        <UnitForm
          onSave={(body) => createMut.mutate(body)}
          onCancel={() => { setShowForm(false); setFormError(undefined); }}
          saving={createMut.isPending}
          error={formError}
        />
      )}

      {/* Edit form */}
      {editing && (
        <UnitForm
          initial={editing}
          onSave={(body) => updateMut.mutate({ id: editing.id, body })}
          onCancel={() => { setEditing(null); setFormError(undefined); }}
          saving={updateMut.isPending}
          error={formError}
        />
      )}

      {/* Delete confirm */}
      {confirmDel && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40">
          <div className="bg-white rounded-xl shadow-xl w-full max-w-sm p-6">
            <h3 className="text-base font-semibold text-slate-800 mb-2">Deactivate Unit</h3>
            <p className="text-sm text-slate-600 mb-5">
              Deactivate <strong>{confirmDel.name}</strong>? Units in use by products cannot be deactivated.
            </p>
            <div className="flex justify-end gap-3">
              <button
                onClick={() => setConfirmDel(null)}
                className="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-700 hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={() => deleteMut.mutate(confirmDel.id)}
                disabled={deleteMut.isPending}
                className="px-4 py-2 text-sm rounded-lg bg-red-600 text-white hover:bg-red-700 disabled:opacity-60"
              >
                {deleteMut.isPending ? 'Deactivating…' : 'Deactivate'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
