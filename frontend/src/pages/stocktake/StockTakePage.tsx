import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { ClipboardCheck, Plus, X, Check, AlertCircle, ArrowLeft } from 'lucide-react';
import {
  stockTakeApi, STOCKTAKE_STATUS_COLORS,
  type StockTake, type StockTakeLine, type SaveCountLine,
} from '../../services/stocktake';
import { inventoryApi } from '../../services/inventory';
import { productsApi } from '../../services/products';
import { useAppSettings } from '../../context/SettingsContext';

const num = (v: string | number | null | undefined) => (v == null ? 0 : Number(v));

export default function StockTakePage() {
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  if (selectedId) return <CountSheet id={selectedId} onBack={() => setSelectedId(null)} />;

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center">
            <ClipboardCheck size={20} />
          </div>
          <div>
            <h1 className="text-xl font-bold text-slate-800">Stock-take / Cycle count</h1>
            <p className="text-sm text-slate-500">Count physical stock, then reconcile system quantities.</p>
          </div>
        </div>
        <button onClick={() => setCreating(true)}
          className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium transition">
          <Plus size={16} /> New Count
        </button>
      </div>

      <StockTakeList onOpen={setSelectedId} />

      {creating && <NewStockTakeModal onClose={() => setCreating(false)} onCreated={(id) => { setCreating(false); setSelectedId(id); }} />}
    </div>
  );
}

function StockTakeList({ onOpen }: { onOpen: (id: string) => void }) {
  const { data: takes = [], isLoading } = useQuery({ queryKey: ['stock-takes'], queryFn: stockTakeApi.list });

  if (isLoading) return <p className="p-8 text-center text-slate-400">Loading…</p>;
  if (takes.length === 0) return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-10 text-center">
      <ClipboardCheck size={32} className="mx-auto text-slate-300 mb-2" />
      <p className="text-slate-500 font-medium">No stock-takes yet</p>
      <p className="text-sm text-slate-400">Start a new count to reconcile your stock.</p>
    </div>
  );

  return (
    <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-slate-500 uppercase text-xs">Number</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-500 uppercase text-xs">Warehouse</th>
              <th className="text-right px-4 py-3 font-semibold text-slate-500 uppercase text-xs">Items</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-500 uppercase text-xs">Created</th>
              <th className="text-center px-4 py-3 font-semibold text-slate-500 uppercase text-xs">Status</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {takes.map((t) => (
              <tr key={t.id} className="hover:bg-slate-50 cursor-pointer" onClick={() => onOpen(t.id)}>
                <td className="px-4 py-3 font-mono text-slate-700">{t.number}</td>
                <td className="px-4 py-3 text-slate-600">{t.warehouse.name}</td>
                <td className="px-4 py-3 text-right text-slate-500">{t._count?.lines ?? 0}</td>
                <td className="px-4 py-3 text-slate-500">{new Date(t.createdAt).toLocaleDateString()}</td>
                <td className="px-4 py-3 text-center">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium ${STOCKTAKE_STATUS_COLORS[t.status]}`}>{t.status}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function NewStockTakeModal({ onClose, onCreated }: { onClose: () => void; onCreated: (id: string) => void }) {
  const [warehouseId, setWarehouseId] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const { data: warehouses = [] } = useQuery({ queryKey: ['inv-warehouses'], queryFn: inventoryApi.getWarehouses });
  const { data: meta } = useQuery({ queryKey: ['products-meta'], queryFn: productsApi.meta });

  const create = useMutation({
    mutationFn: () => stockTakeApi.create({ warehouseId, categoryId: categoryId || null, note: note || null }),
    onSuccess: (st) => onCreated(st.id),
    onError: (e: unknown) => setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Failed to create'),
  });

  const inp = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200';

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={onClose}>
      <div className="bg-white rounded-2xl shadow-xl w-full max-w-md" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-100">
          <h2 className="text-base font-bold text-slate-800">New Stock-take</h2>
          <button onClick={onClose} className="p-1 text-slate-400 hover:text-slate-600"><X size={18} /></button>
        </div>
        <div className="p-5 space-y-4">
          {error && <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700"><AlertCircle size={16} className="mt-0.5" />{error}</div>}
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Warehouse</label>
            <select className={inp} value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
              <option value="">Select warehouse…</option>
              {warehouses.map((w) => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Category (optional — limits the count)</label>
            <select className={inp} value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="">All products</option>
              {meta?.categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-600 mb-1">Note (optional)</label>
            <input className={inp} value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Monthly count" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-2 px-5 py-4 border-t border-slate-100">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-600 hover:bg-slate-100 rounded-lg">Cancel</button>
          <button onClick={() => { setError(null); if (!warehouseId) { setError('Select a warehouse'); return; } create.mutate(); }} disabled={create.isPending}
            className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-60">
            <Check size={16} /> {create.isPending ? 'Creating…' : 'Start count'}
          </button>
        </div>
      </div>
    </div>
  );
}

function CountSheet({ id, onBack }: { id: string; onBack: () => void }) {
  const qc = useQueryClient();
  const { formatMoney } = useAppSettings();
  const { data: take, isLoading } = useQuery({ queryKey: ['stock-take', id], queryFn: () => stockTakeApi.getById(id) });
  const [counts, setCounts] = useState<Record<string, string>>({});
  const [units, setUnits] = useState<Record<string, string>>({}); // lineId → chosen count unit
  const [error, setError] = useState<string | null>(null);

  const editable = take?.status === 'DRAFT';

  const saveMut = useMutation({
    mutationFn: (lines: SaveCountLine[]) => stockTakeApi.saveCounts(id, lines),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['stock-take', id] }); qc.invalidateQueries({ queryKey: ['stock-takes'] }); },
    onError: (e: unknown) => setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Save failed'),
  });
  const confirmMut = useMutation({
    mutationFn: () => stockTakeApi.confirm(id),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['stock-take', id] }); qc.invalidateQueries({ queryKey: ['stock-takes'] }); },
    onError: (e: unknown) => setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Confirm failed'),
  });

  if (isLoading || !take) return <div className="p-6"><p className="text-slate-400">Loading…</p></div>;

  interface UOpt { id: string; label: string; factor: number; allowDecimal: boolean; type: string }
  const effBaseId = (l: StockTakeLine) => l.product.baseUnitId ?? l.product.unitId;
  const unitOptions = (l: StockTakeLine): UOpt[] => {
    const bId = effBaseId(l);
    const b = l.product.baseUnit ?? l.product.unit;
    const opts: UOpt[] = [{ id: bId, label: b?.shortCode ?? 'unit', factor: 1, allowDecimal: b?.allowDecimal ?? true, type: b?.type ?? 'OTHER' }];
    for (const c of l.product.unitConversions ?? []) {
      if (c.toUnit.id === bId) {
        opts.push({ id: c.fromUnit.id, label: c.fromUnit.shortCode, factor: Number(c.conversionQty), allowDecimal: c.fromUnit.allowDecimal, type: c.fromUnit.type });
      }
    }
    return opts;
  };
  const selUnitId = (l: StockTakeLine) => units[l.id] ?? l.countUnitId ?? effBaseId(l);
  const optFor = (l: StockTakeLine): UOpt => { const o = unitOptions(l); return o.find((x) => x.id === selUnitId(l)) ?? o[0]; };
  const fmtQty = (n: number) => Number(n.toFixed(3)).toString();

  const systemInUnit = (l: StockTakeLine) => num(l.systemQty) / optFor(l).factor;
  const countedVal = (l: StockTakeLine): string => counts[l.id] ?? (l.countedQty ?? '');
  const varianceUnit = (l: StockTakeLine): number | null => {
    const c = countedVal(l); if (c === '') return null;
    return Number(c) - systemInUnit(l);
  };
  const varianceBase = (l: StockTakeLine): number | null => {
    const c = countedVal(l); if (c === '') return null;
    return Number(c) * optFor(l).factor - num(l.systemQty);
  };
  const varianceValueCents = take.lines?.reduce((s, l) => {
    const v = varianceBase(l);
    return v == null ? s : s + Math.round(v * l.unitCostCents);
  }, 0) ?? 0;
  const countedCount = take.lines?.filter((l) => countedVal(l) !== '').length ?? 0;

  const buildLines = (): SaveCountLine[] =>
    (take.lines ?? []).map((l) => {
      const c = countedVal(l);
      const uid = selUnitId(l);
      return { lineId: l.id, countedQty: c === '' ? null : Number(c), countUnitId: uid === effBaseId(l) ? null : uid, note: l.note };
    });

  return (
    <div className="p-6 max-w-6xl mx-auto">
      <button onClick={onBack} className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4"><ArrowLeft size={15} /> Back to list</button>

      <div className="flex items-center justify-between mb-4">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            {take.number}
            <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${STOCKTAKE_STATUS_COLORS[take.status]}`}>{take.status}</span>
          </h1>
          <p className="text-sm text-slate-500">{take.warehouse.name} · {take.lines?.length ?? 0} items{take.note ? ` · ${take.note}` : ''}</p>
        </div>
        <div className="text-right">
          <p className="text-xs text-slate-400 uppercase">Net variance value</p>
          <p className={`text-lg font-bold ${varianceValueCents < 0 ? 'text-red-600' : varianceValueCents > 0 ? 'text-emerald-600' : 'text-slate-700'}`}>{formatMoney(varianceValueCents)}</p>
        </div>
      </div>

      {error && <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700 mb-4"><AlertCircle size={16} className="mt-0.5" />{error}</div>}

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 font-semibold text-slate-500 uppercase text-xs">Product</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-500 uppercase text-xs">System</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-500 uppercase text-xs">Counted</th>
                <th className="text-right px-4 py-3 font-semibold text-slate-500 uppercase text-xs">Variance</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {(take.lines ?? []).map((l) => {
                const v = varianceUnit(l);
                const opts = unitOptions(l);
                const o = optFor(l);
                const step = (o.allowDecimal && o.type !== 'COUNT') ? 'any' : '1';
                return (
                  <tr key={l.id} className="hover:bg-slate-50">
                    <td className="px-4 py-2.5">
                      <p className="font-medium text-slate-800">{l.product.name}</p>
                      <p className="text-xs text-slate-400 font-mono">{l.product.sku}</p>
                    </td>
                    <td className="px-4 py-2.5 text-right text-slate-600">{fmtQty(systemInUnit(l))} {o.label}</td>
                    <td className="px-4 py-2.5 text-right">
                      {editable ? (
                        <div className="flex items-center justify-end gap-1.5">
                          <input
                            type="number" min={0} step={step}
                            className="w-20 px-2 py-1 border border-slate-200 rounded text-right text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
                            value={countedVal(l)}
                            onChange={(e) => setCounts((p) => ({ ...p, [l.id]: e.target.value }))}
                            placeholder="—"
                          />
                          {opts.length > 1 ? (
                            <select
                              className="px-1.5 py-1 border border-slate-200 rounded text-xs text-slate-600 focus:outline-none focus:ring-2 focus:ring-indigo-200"
                              value={selUnitId(l)}
                              onChange={(e) => setUnits((p) => ({ ...p, [l.id]: e.target.value }))}
                            >
                              {opts.map((u) => <option key={u.id} value={u.id}>{u.label}</option>)}
                            </select>
                          ) : (
                            <span className="text-xs text-slate-400 w-10">{o.label}</span>
                          )}
                        </div>
                      ) : (
                        <span className="text-slate-700">{l.countedQty != null ? `${num(l.countedQty)} ${o.label}` : '—'}</span>
                      )}
                    </td>
                    <td className={`px-4 py-2.5 text-right font-medium ${v == null ? 'text-slate-300' : v < 0 ? 'text-red-600' : v > 0 ? 'text-emerald-600' : 'text-slate-400'}`}>
                      {v == null ? '—' : `${v > 0 ? '+' : ''}${fmtQty(v)} ${o.label}`}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {editable && (
        <div className="flex items-center justify-between mt-4">
          <p className="text-sm text-slate-500">{countedCount} of {take.lines?.length ?? 0} items counted</p>
          <div className="flex items-center gap-2">
            <button onClick={() => { setError(null); saveMut.mutate(buildLines()); }} disabled={saveMut.isPending}
              className="px-4 py-2 text-sm border border-slate-200 rounded-lg text-slate-600 hover:bg-slate-50 disabled:opacity-60">
              {saveMut.isPending ? 'Saving…' : 'Save draft'}
            </button>
            <button
              onClick={() => {
                setError(null);
                if (countedCount === 0) { setError('Enter at least one count before confirming'); return; }
                if (!confirm(`Confirm ${take.number}? This posts stock adjustments for ${countedCount} counted item(s) and cannot be undone.`)) return;
                // Persist counts first, then confirm.
                saveMut.mutate(buildLines(), { onSuccess: () => confirmMut.mutate() });
              }}
              disabled={saveMut.isPending || confirmMut.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-60">
              <Check size={16} /> {confirmMut.isPending ? 'Posting…' : 'Confirm & reconcile'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
