import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Database, AlertTriangle, Trash2, Loader2, CheckCircle2, ShieldAlert, Download } from 'lucide-react';
import { dataManagementApi, type ClearableEntity, type ClearReport, type ResetPreset, type ResetPreview } from '../../services/dataManagement';
import { productsApi } from '../../services/products';
import { suppliersApi, customersApi } from '../../services/contacts';

type TabKey = ClearableEntity;
const TABS: { key: TabKey; label: string }[] = [
  { key: 'product',  label: 'Products' },
  { key: 'supplier', label: 'Suppliers' },
  { key: 'customer', label: 'Customers' },
];

interface Row { id: string; name: string; sub?: string }

export default function DataManagementPage() {
  const queryClient = useQueryClient();
  const [tab, setTab]         = useState<TabKey>('product');
  const [search, setSearch]   = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState('');
  const [showConfirm, setShowConfirm] = useState(false);
  const [report, setReport]   = useState<ClearReport | null>(null);

  const { data: summary } = useQuery({ queryKey: ['data-summary'], queryFn: dataManagementApi.summary });

  const { data: rows = [], isFetching, isError } = useQuery({
    queryKey: ['data-mgmt-list', tab, search],
    queryFn: async (): Promise<Row[]> => {
      // pageSize capped at 100 by the list endpoints — request the max.
      if (tab === 'product') {
        const r = await productsApi.list({ search: search || undefined, isActive: 'all', pageSize: 100 });
        return r.data.map((p) => ({ id: p.id, name: p.name, sub: p.sku }));
      }
      if (tab === 'supplier') {
        const r = await suppliersApi.list({ search: search || undefined, pageSize: 100 });
        return r.data.map((s) => ({ id: s.id, name: s.name, sub: s.phone ?? undefined }));
      }
      const r = await customersApi.list({ search: search || undefined, pageSize: 100 });
      return r.data.map((c) => ({ id: c.id, name: c.name, sub: c.phone ?? undefined }));
    },
  });

  // ── Reset presets (danger zone) ──────────────────────────────────────────────
  const RESET_PRESETS: { key: ResetPreset; label: string; desc: string }[] = [
    { key: 'transactions', label: 'Clear transactions only', desc: 'Keep products, customers & suppliers. Wipe sales, purchases, stock, payments, returns.' },
    { key: 'keepProducts', label: 'Keep products only',      desc: 'Keep the product catalogue. Wipe transactions + customers + suppliers.' },
    { key: 'full',         label: 'Full reset (fresh system)', desc: 'Wipe everything except the super-admin, settings & warehouses.' },
  ];
  const [resetPreset, setResetPreset]   = useState<ResetPreset | null>(null);
  const [resetPreview, setResetPreview] = useState<ResetPreview | null>(null);
  const [resetPw, setResetPw]           = useState('');
  const [resetConfirm, setResetConfirm] = useState('');
  const [resetErr, setResetErr]         = useState('');

  const [downloading, setDownloading] = useState(false);
  const handleBackup = async () => {
    setDownloading(true);
    try { await dataManagementApi.downloadBackup(); }
    finally { setDownloading(false); }
  };

  // ── Restore from backup ──────────────────────────────────────────────────────
  const [restoreBackup, setRestoreBackup]   = useState<unknown>(null);
  const [restoreCounts, setRestoreCounts]   = useState<Record<string, number> | null>(null);
  const [restorePw, setRestorePw]           = useState('');
  const [restoreConfirm, setRestoreConfirm] = useState('');
  const [restoreErr, setRestoreErr]         = useState('');
  const [restoreBusy, setRestoreBusy]       = useState(false);
  const [restoreDone, setRestoreDone]       = useState<number | null>(null);
  const sum = (o: Record<string, number>) => Object.values(o).reduce((a, b) => a + b, 0);

  const onPickBackup = async (file: File) => {
    setRestoreErr(''); setRestoreCounts(null); setRestoreBackup(null); setRestoreDone(null);
    try {
      const parsed = JSON.parse(await file.text());
      const preview = await dataManagementApi.restorePreview(parsed);
      setRestoreBackup(parsed);
      setRestoreCounts(preview.counts);
    } catch (e) {
      setRestoreErr((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Invalid backup file');
    }
  };
  const runRestore = async () => {
    if (!restoreBackup) return;
    setRestoreBusy(true); setRestoreErr('');
    try {
      const res = await dataManagementApi.restoreExecute(restoreBackup, restorePw, restoreConfirm);
      setRestoreDone(sum(res.counts));
      setRestoreBackup(null); setRestoreCounts(null); setRestorePw(''); setRestoreConfirm('');
    } catch (e) {
      setRestoreErr((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Restore failed');
    } finally { setRestoreBusy(false); }
  };

  const openReset = async (preset: ResetPreset) => {
    setResetErr(''); setResetPw(''); setResetConfirm(''); setResetPreview(null); setResetPreset(preset);
    try { setResetPreview(await dataManagementApi.resetPreview(preset)); }
    catch { setResetErr('Failed to load preview'); }
  };
  const closeReset = () => { setResetPreset(null); setResetPreview(null); };

  const resetMut = useMutation({
    mutationFn: () => dataManagementApi.resetExecute(resetPreset!, resetPw, resetConfirm),
    onSuccess: () => {
      closeReset();
      queryClient.invalidateQueries({ queryKey: ['data-summary'] });
      queryClient.invalidateQueries({ queryKey: ['data-mgmt-list'] });
      setReport(null);
    },
    onError: (e: unknown) => {
      const msg = (e as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setResetErr(msg ?? 'Reset failed');
    },
  });

  const clearMut = useMutation({
    mutationFn: () => dataManagementApi.clearEntities(tab, [...selected]),
    onSuccess: (rep) => {
      setReport(rep);
      setShowConfirm(false);
      setConfirm('');
      setSelected(new Set());
      queryClient.invalidateQueries({ queryKey: ['data-summary'] });
      queryClient.invalidateQueries({ queryKey: ['data-mgmt-list'] });
    },
  });

  const toggle = (id: string) =>
    setSelected((prev) => { const n = new Set(prev); n.has(id) ? n.delete(id) : n.add(id); return n; });
  const allSelected = rows.length > 0 && rows.every((r) => selected.has(r.id));
  const toggleAll = () =>
    setSelected(allSelected ? new Set() : new Set(rows.map((r) => r.id)));

  const changeTab = (k: TabKey) => { setTab(k); setSelected(new Set()); setReport(null); };

  const cards: { label: string; value?: number }[] = [
    { label: 'Products',   value: summary?.products },
    { label: 'Suppliers',  value: summary?.suppliers },
    { label: 'Customers',  value: summary?.customers },
    { label: 'Sales',      value: summary?.sales },
    { label: 'Purchases',  value: summary?.purchases },
    { label: 'Stock moves', value: summary?.stockMovements },
  ];

  return (
    <div className="p-6 max-w-5xl mx-auto">
      <div className="flex items-center gap-2 mb-1">
        <Database className="w-6 h-6 text-indigo-600" />
        <h1 className="text-2xl font-bold text-slate-800">Data Management</h1>
      </div>
      <p className="text-sm text-slate-500 mb-4">Super-admin tools to clear selected records from the system.</p>

      {/* Danger banner */}
      <div className="flex items-start gap-2 rounded-xl border border-red-200 bg-red-50 px-4 py-3 mb-5">
        <AlertTriangle className="w-5 h-5 text-red-600 shrink-0 mt-0.5" />
        <p className="text-sm text-red-700">
          This permanently removes records with <b>no transaction history</b>. Records that have sales,
          purchases or stock movements are <b>hidden</b> (kept for audit), and anything still holding stock is
          <b> blocked</b>. This cannot be undone — proceed carefully.
        </p>
      </div>

      {/* Footprint */}
      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-3 mb-6">
        {cards.map((c) => (
          <div key={c.label} className="rounded-xl border border-slate-200 bg-white px-3 py-2.5">
            <p className="text-[11px] uppercase tracking-wide text-slate-400">{c.label}</p>
            <p className="text-xl font-bold text-slate-800">{c.value ?? '—'}</p>
          </div>
        ))}
      </div>

      {/* Report */}
      {report && (
        <div className="flex items-center gap-2 rounded-xl border border-green-200 bg-green-50 px-4 py-3 mb-4 text-sm text-green-800">
          <CheckCircle2 className="w-5 h-5 shrink-0" />
          <span>
            Cleared <b>{report.removed}</b> permanently, hidden <b>{report.softDeleted}</b> (had history)
            {report.blocked.length > 0 && <>, <b>{report.blocked.length}</b> blocked</>}.
            {report.blocked.length > 0 && (
              <span className="block text-xs text-green-700 mt-1">
                Blocked: {report.blocked.slice(0, 5).map((b) => b.reason).join(' · ')}
              </span>
            )}
          </span>
        </div>
      )}

      {/* Tabs */}
      <div className="flex gap-1 border-b border-slate-200 mb-3">
        {TABS.map((t) => (
          <button key={t.key} onClick={() => changeTab(t.key)}
            className={`px-4 py-2 text-sm font-medium -mb-px border-b-2 ${tab === t.key ? 'border-indigo-600 text-indigo-700' : 'border-transparent text-slate-500 hover:text-slate-700'}`}>
            {t.label}
          </button>
        ))}
      </div>

      {/* Search + clear bar */}
      <div className="flex items-center gap-2 mb-2">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={`Search ${tab}s…`}
          className="flex-1 border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500" />
        <button
          disabled={selected.size === 0}
          onClick={() => { setShowConfirm(true); setReport(null); }}
          className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 disabled:cursor-not-allowed">
          <Trash2 className="w-4 h-4" /> Clear {selected.size > 0 ? `(${selected.size})` : ''}
        </button>
      </div>

      {/* List */}
      <div className="border border-slate-200 rounded-xl overflow-hidden">
        <div className="flex items-center gap-2 px-3 py-2 bg-slate-50 border-b border-slate-200 text-xs text-slate-500">
          <input type="checkbox" checked={allSelected} onChange={toggleAll} />
          <span>Select all ({rows.length})</span>
          {isFetching && <Loader2 className="w-3.5 h-3.5 animate-spin ml-auto" />}
        </div>
        <div className="max-h-[420px] overflow-y-auto divide-y divide-slate-100">
          {isError && (
            <p className="text-sm text-red-500 text-center py-8">Failed to load {tab}s. Please try again.</p>
          )}
          {rows.length === 0 && !isFetching && !isError && (
            <p className="text-sm text-slate-400 text-center py-8">No {tab}s found.</p>
          )}
          {rows.map((r) => (
            <label key={r.id} className="flex items-center gap-2 px-3 py-2 hover:bg-slate-50 cursor-pointer">
              <input type="checkbox" checked={selected.has(r.id)} onChange={() => toggle(r.id)} />
              <span className="text-sm text-slate-700">{r.name}</span>
              {r.sub && <span className="text-xs text-slate-400">· {r.sub}</span>}
            </label>
          ))}
        </div>
      </div>

      {/* ── Danger Zone: full / preset reset ─────────────────────────────────── */}
      <div className="mt-8 rounded-xl border-2 border-red-200 bg-red-50/40 p-4">
        <div className="flex items-center gap-2 mb-1">
          <ShieldAlert className="w-5 h-5 text-red-600" />
          <h2 className="font-bold text-red-700">Danger Zone — System Reset</h2>
        </div>
        <p className="text-xs text-red-600 mb-3">
          Bulk-wipes data by preset. This permanently deletes history (unlike selective clear above).
          Download a backup first. Super-admin, settings & warehouses are always kept.
        </p>
        <button onClick={handleBackup} disabled={downloading}
          className="inline-flex items-center gap-1.5 mb-3 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50">
          {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
          Download backup (JSON)
        </button>
        <div className="grid gap-2 sm:grid-cols-3">
          {RESET_PRESETS.map((r) => (
            <button key={r.key} onClick={() => openReset(r.key)}
              className="text-left rounded-lg border border-red-200 bg-white hover:border-red-400 hover:bg-red-50 p-3 transition">
              <p className="text-sm font-semibold text-slate-800">{r.label}</p>
              <p className="text-[11px] text-slate-500 mt-0.5 leading-snug">{r.desc}</p>
            </button>
          ))}
        </div>
      </div>

      {/* ── Restore from backup ──────────────────────────────────────────────── */}
      <div className="mt-6 rounded-xl border-2 border-amber-200 bg-amber-50/40 p-4">
        <div className="flex items-center gap-2 mb-1">
          <Database className="w-5 h-5 text-amber-600" />
          <h2 className="font-bold text-amber-700">Restore from backup</h2>
        </div>
        <p className="text-xs text-amber-700 mb-3">
          Replaces ALL current data with an uploaded backup file. Runs atomically — a failed or
          invalid import rolls back, so a bad file never empties your system.
        </p>
        <input type="file" accept="application/json,.json"
          onChange={(e) => { const f = e.target.files?.[0]; if (f) onPickBackup(f); }}
          className="block text-xs text-slate-600 file:mr-3 file:py-1.5 file:px-3 file:rounded-lg file:border file:border-slate-300 file:bg-white file:text-slate-700 file:text-xs file:font-semibold hover:file:bg-slate-50" />
        {restoreDone !== null && (
          <p className="text-xs text-green-700 mt-2 font-medium">✓ Restore complete — {restoreDone} rows imported.</p>
        )}
        {restoreErr && !restoreCounts && <p className="text-xs text-red-600 mt-2">{restoreErr}</p>}
        {restoreCounts && (
          <div className="mt-3 rounded-lg border border-amber-200 bg-white p-3">
            <p className="text-xs font-semibold text-slate-700 mb-1">This file has {sum(restoreCounts)} rows:</p>
            <p className="text-[11px] text-slate-500 mb-2">
              Products <b>{restoreCounts.products ?? 0}</b> · Customers <b>{restoreCounts.customers ?? 0}</b> · Suppliers <b>{restoreCounts.suppliers ?? 0}</b> · Sales <b>{restoreCounts.sales ?? 0}</b> · Purchases <b>{restoreCounts.purchases ?? 0}</b> · Users <b>{restoreCounts.users ?? 0}</b>
            </p>
            <p className="text-[11px] text-red-600 mb-2">⚠ This wipes everything currently in the system and replaces it with this file.</p>
            <input type="password" autoComplete="off" value={restorePw} onChange={(e) => setRestorePw(e.target.value)} placeholder="Your password"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-amber-500" />
            <input value={restoreConfirm} onChange={(e) => setRestoreConfirm(e.target.value)} placeholder="Type RESTORE to confirm"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-amber-500" />
            {restoreErr && <p className="text-xs text-red-600 mb-2">{restoreErr}</p>}
            <button disabled={restoreConfirm !== 'RESTORE' || !restorePw || restoreBusy} onClick={runRestore}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-amber-600 hover:bg-amber-700 text-white disabled:opacity-40 disabled:cursor-not-allowed">
              {restoreBusy ? <Loader2 className="w-4 h-4 animate-spin" /> : <Database className="w-4 h-4" />}
              Restore now
            </button>
          </div>
        )}
      </div>

      {/* Reset modal — preview + password + type-RESET confirm */}
      {resetPreset && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center gap-2 mb-2">
              <ShieldAlert className="w-6 h-6 text-red-600" />
              <h3 className="font-bold text-lg text-slate-900">{RESET_PRESETS.find((r) => r.key === resetPreset)?.label}</h3>
            </div>
            {!resetPreview ? (
              <p className="text-sm text-slate-500 flex items-center gap-2"><Loader2 className="w-4 h-4 animate-spin" /> Loading preview…</p>
            ) : (
              <>
                <p className="text-sm text-slate-600 mb-2">This will permanently delete:</p>
                <ul className="text-sm text-slate-700 bg-slate-50 rounded-lg p-3 mb-3 space-y-0.5">
                  <li>Sales <b>{resetPreview.willClear.transactions.sales}</b> · Purchases <b>{resetPreview.willClear.transactions.purchases}</b> · Stock moves <b>{resetPreview.willClear.transactions.stockMovements}</b></li>
                  <li>Payments <b>{resetPreview.willClear.transactions.payments}</b> · Expenses <b>{resetPreview.willClear.transactions.expenses}</b> · Quotations <b>{resetPreview.willClear.transactions.quotations}</b></li>
                  {resetPreview.willClear.contacts && <li className="text-red-700">Customers <b>{resetPreview.willClear.contacts.customers}</b> · Suppliers <b>{resetPreview.willClear.contacts.suppliers}</b></li>}
                  {resetPreview.willClear.products && <li className="text-red-700">Products <b>{resetPreview.willClear.products.products}</b> + categories/brands/units</li>}
                  {resetPreview.willClear.users && <li className="text-red-700">Non-super users <b>{resetPreview.willClear.users.nonSuperUsers}</b></li>}
                </ul>
                <p className="text-[11px] text-green-700 mb-2">Kept: super-admin, settings, warehouses{resetPreview.keeps.products ? ', products' : ''}{resetPreview.keeps.contacts ? ', customers & suppliers' : ''}.</p>
                <button onClick={handleBackup} disabled={downloading}
                  className="inline-flex items-center gap-1.5 mb-3 px-3 py-1.5 rounded-lg text-xs font-semibold border border-slate-300 bg-white hover:bg-slate-50 text-slate-700 disabled:opacity-50">
                  {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
                  Download backup first
                </button>
                <input type="password" autoComplete="off" value={resetPw} onChange={(e) => setResetPw(e.target.value)} placeholder="Your password"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-red-500" />
                <input value={resetConfirm} onChange={(e) => setResetConfirm(e.target.value)} placeholder="Type RESET to confirm"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-2 focus:outline-none focus:ring-2 focus:ring-red-500" />
                {resetErr && <p className="text-xs text-red-600 mb-2">{resetErr}</p>}
                <div className="flex gap-2 justify-end">
                  <button onClick={closeReset} className="px-4 py-2 rounded-lg text-sm bg-slate-100 hover:bg-slate-200 text-slate-700">Cancel</button>
                  <button
                    disabled={resetConfirm !== 'RESET' || !resetPw || resetMut.isPending}
                    onClick={() => { setResetErr(''); resetMut.mutate(); }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 disabled:cursor-not-allowed">
                    {resetMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <ShieldAlert className="w-4 h-4" />}
                    Wipe now
                  </button>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* Confirm modal */}
      {showConfirm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-[9999] p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <div className="flex items-center gap-2 mb-2">
              <AlertTriangle className="w-6 h-6 text-red-600" />
              <h3 className="font-bold text-lg text-slate-900">Clear {selected.size} {tab}{selected.size > 1 ? 's' : ''}?</h3>
            </div>
            <p className="text-sm text-slate-600 mb-3">
              Clean records will be permanently removed; those with history will be hidden (kept for audit).
              Type <b>CLEAR</b> to confirm.
            </p>
            <input autoFocus value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="CLEAR"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm mb-3 focus:outline-none focus:ring-2 focus:ring-red-500" />
            {clearMut.isError && <p className="text-xs text-red-600 mb-2">Failed. Please try again.</p>}
            <div className="flex gap-2 justify-end">
              <button onClick={() => { setShowConfirm(false); setConfirm(''); }}
                className="px-4 py-2 rounded-lg text-sm bg-slate-100 hover:bg-slate-200 text-slate-700">Cancel</button>
              <button
                disabled={confirm !== 'CLEAR' || clearMut.isPending}
                onClick={() => clearMut.mutate()}
                className="inline-flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold bg-red-600 hover:bg-red-700 text-white disabled:opacity-40 disabled:cursor-not-allowed">
                {clearMut.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Trash2 className="w-4 h-4" />}
                Clear now
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
