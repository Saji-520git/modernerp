import { useState, useRef, useMemo, Fragment } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Package,
  AlertTriangle,
  ArrowRightLeft,
  History,
  Search,
  CheckCircle,
  AlertCircle,
  TrendingUp,
  TrendingDown,
  RefreshCw,
  ChevronDown,
  ChevronRight,
  Layers,
  XCircle,
  Clock,
  DollarSign,
  Pencil,
  Check,
  X,
} from 'lucide-react';
import {
  inventoryApi,
  MOVEMENT_LABELS,
  MOVEMENT_COLORS,
  type MovementType,
  type AdjustmentPayload,
  type TransferPayload,
  type WriteOffPayload,
} from '../../services/inventory';
import { productsApi } from '../../services/products';
import BarcodeInput from '../../components/common/BarcodeInput';
import axios from 'axios';
import { fmtQty, formatStockDisplay } from '../../utils/format';

// ─── Helpers ──────────────────────────────────────────────────────────────────

type Tab = 'stock' | 'adjust' | 'transfer' | 'history';

function TabButton({
  active,
  onClick,
  icon: Icon,
  label,
  badge,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ElementType;
  label: string;
  badge?: number;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-2 px-4 py-2.5 text-sm font-medium rounded-lg transition ${
        active
          ? 'bg-blue-600 text-white shadow-sm'
          : 'text-slate-600 hover:bg-slate-100'
      }`}
    >
      <Icon className="w-4 h-4" />
      {label}
      {badge !== undefined && badge > 0 && (
        <span
          className={`text-xs px-1.5 py-0.5 rounded-full font-bold ${
            active ? 'bg-white/20 text-white' : 'bg-red-100 text-red-600'
          }`}
        >
          {badge}
        </span>
      )}
    </button>
  );
}

// ─── Inline Reorder Level Editor ─────────────────────────────────────────────

function InlineReorderEdit({
  productId,
  value,
}: {
  productId: string;
  value: number;
}) {
  const qc = useQueryClient();
  const [editing, setEditing]   = useState(false);
  const [draft, setDraft]       = useState(String(value));
  const [flash, setFlash]       = useState(false);
  const [errMsg, setErrMsg]     = useState<string | null>(null);

  const mutation = useMutation({
    mutationFn: (reorderLevel: number) =>
      productsApi.update(productId, { reorderLevel }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['inv-stock-full'] });
      qc.invalidateQueries({ queryKey: ['pos-products'] });
      setEditing(false);
      setErrMsg(null);
      setFlash(true);
      setTimeout(() => setFlash(false), 800);
    },
    onError: () => {
      setErrMsg('Failed to update');
      setTimeout(() => setErrMsg(null), 3000);
    },
  });

  function save() {
    const parsed = parseInt(draft, 10);
    if (isNaN(parsed) || parsed < 0 || parsed > 9999) {
      setErrMsg('Enter 0 – 9999');
      return;
    }
    mutation.mutate(parsed);
  }

  function cancel() {
    setDraft(String(value));
    setEditing(false);
    setErrMsg(null);
  }

  if (editing) {
    return (
      <div className="flex items-center justify-end gap-1">
        <input
          type="number" min={0} max={9999} step={1}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') cancel(); }}
          autoFocus
          className="w-16 text-right border border-blue-300 rounded px-1 py-0.5 text-xs focus:outline-none focus:ring-1 focus:ring-blue-500"
        />
        <button onClick={save} disabled={mutation.isPending}
          className="text-green-600 hover:text-green-700 disabled:opacity-50">
          <Check className="w-3.5 h-3.5" />
        </button>
        <button onClick={cancel} className="text-slate-400 hover:text-slate-600">
          <X className="w-3.5 h-3.5" />
        </button>
        {errMsg && <span className="text-red-500 text-[10px]">{errMsg}</span>}
      </div>
    );
  }

  return (
    <div
      className={`flex items-center justify-end gap-1 group cursor-pointer rounded px-1 transition ${flash ? 'bg-green-100' : ''}`}
      onClick={() => { setDraft(String(value)); setEditing(true); }}
      title="Click to edit reorder level"
    >
      <span className={`${flash ? 'text-green-700 font-semibold' : 'text-slate-400'}`}>{value}</span>
      <Pencil className="w-3 h-3 text-slate-300 group-hover:text-slate-500 opacity-0 group-hover:opacity-100 transition" />
    </div>
  );
}

// ─── Stock Row (with expandable batch detail + write-off) ─────────────────────

function StockRow({ row, onAdjust }: { row: import('../../services/inventory').StockRow; onAdjust: () => void }) {
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState(false);
  const [writeOffBatchId, setWriteOffBatchId] = useState<string | null>(null);
  const [woQty, setWoQty]     = useState('');
  const [woReason, setWoReason] = useState('');
  const [woError, setWoError]  = useState<string | null>(null);
  const [woToast, setWoToast]  = useState<string | null>(null);

  const { data: batches } = useQuery({
    queryKey: ['inv-batches', row.product.id, row.warehouse.id],
    queryFn: () => inventoryApi.getBatchDetail(row.product.id, row.warehouse.id),
    enabled: expanded,
    staleTime: 0,
  });

  const writeOffMutation = useMutation({
    mutationFn: (payload: WriteOffPayload) => inventoryApi.writeOff(payload),
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ['inv-batches', row.product.id, row.warehouse.id] });
      qc.invalidateQueries({ queryKey: ['inv-stock'] });
      qc.invalidateQueries({ queryKey: ['inv-low-stock'] });
      qc.invalidateQueries({ queryKey: ['inv-expiring'] });
      qc.invalidateQueries({ queryKey: ['pos-products'] });
      setWriteOffBatchId(null); setWoQty(''); setWoReason(''); setWoError(null);
      const loss = `Rs. ${(data.lossCents / 100).toFixed(2)}`;
      setWoToast(`${data.qty} unit(s) written off. Loss ${loss} recorded as expense (${data.expense.reference}).`);
      setTimeout(() => setWoToast(null), 5000);
    },
    onError: (e: unknown) => {
      setWoError((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Write-off failed');
    },
  });

  function startWriteOff(batchId: string, batchQty: number) {
    setWriteOffBatchId(batchId);
    setWoQty(String(batchQty));
    setWoReason('');
    setWoError(null);
  }

  function confirmWriteOff() {
    if (!writeOffBatchId) return;
    const qty = parseFloat(woQty);
    const batch = batches?.find(b => b.id === writeOffBatchId);
    if (isNaN(qty) || qty <= 0) { setWoError('Enter a valid quantity'); return; }
    if (batch && qty > batch.qty) { setWoError(`Cannot exceed batch qty (${batch.qty})`); return; }
    if (woReason.trim().length < 3) { setWoError('Reason must be at least 3 characters'); return; }
    setWoError(null);
    writeOffMutation.mutate({ batchId: writeOffBatchId, warehouseId: row.warehouse.id, qty, reason: woReason.trim() });
  }

  const expiryBadge = () => {
    if (row.expiryStatus === 'has_expired_batch')
      return <span className="inline-flex items-center gap-1 bg-red-100 text-red-600 text-xs px-2 py-0.5 rounded-full font-medium"><AlertTriangle className="w-3 h-3" /> {row.expiredQty} exp.</span>;
    if (row.expiryStatus === 'expiring' && row.nearestExpiry)
      return <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full font-medium">Exp {new Date(row.nearestExpiry).toLocaleDateString('en-US', { day: 'numeric', month: 'short' })}</span>;
    return <span className="text-slate-300 text-xs">—</span>;
  };

  const statusBadge = () => {
    if (row.qty <= 0)
      return <span className="inline-flex items-center gap-1 bg-slate-100 text-slate-500 text-xs px-2 py-0.5 rounded-full font-medium"><XCircle className="w-3 h-3" /> Out</span>;
    if (row.isLowStock)
      return <span className="inline-flex items-center gap-1 bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full font-medium"><AlertTriangle className="w-3 h-3" /> Low</span>;
    return <span className="inline-flex items-center gap-1 bg-green-100 text-green-700 text-xs px-2 py-0.5 rounded-full font-medium"><CheckCircle className="w-3 h-3" /> OK</span>;
  };

  const batchStatusColour = (s: string) => {
    if (s === 'expired')       return 'text-red-600';
    if (s === 'expiring_soon') return 'text-amber-600';
    return 'text-slate-600';
  };

  return (
    <Fragment>
      <tr className="hover:bg-slate-50">
        <td className="px-2 py-3 text-center">
          <button onClick={() => setExpanded(e => !e)} className="text-slate-400 hover:text-slate-600">
            {expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        </td>
        <td className="px-4 py-3 font-medium text-slate-800">{row.product.name}</td>
        <td className="px-4 py-3 text-slate-500 font-mono text-xs">{row.product.sku}</td>
        <td className="px-4 py-3 text-slate-600">{row.warehouse.name}</td>
        <td className="px-4 py-3 text-right font-semibold">
          {formatStockDisplay(row.product, Number(row.qty))}
        </td>
        <td className="px-4 py-3 text-right">
          {row.stockValueCents > 0
            ? <span className="text-green-700 font-medium text-xs">Rs. {(row.stockValueCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}</span>
            : <span className="text-slate-300 text-xs">—</span>}
        </td>
        <td className="px-4 py-3 text-right">
          <InlineReorderEdit productId={row.product.id} value={row.product.reorderLevel} />
        </td>
        <td className="px-4 py-3 text-center">{expiryBadge()}</td>
        <td className="px-4 py-3 text-center">{statusBadge()}</td>
        <td className="px-4 py-3 text-center">
          <button onClick={onAdjust} className="text-xs text-blue-600 hover:underline font-medium">Adjust</button>
        </td>
      </tr>
      {expanded && (
        <tr>
          <td colSpan={10} className="bg-slate-50 px-8 py-2">
            {/* Reorder info line */}
            {(row.product.reorderLevel > 0 || row.product.reorderQty > 0) && (
              <p className="text-[11px] text-slate-400 mb-1.5">
                Reorder at: <span className="font-semibold text-slate-600">{formatStockDisplay(row.product, Number(row.product.reorderLevel))}</span>
                {row.product.reorderQty > 0 && (
                  <> &nbsp;·&nbsp; Order qty: <span className="font-semibold text-slate-600">{formatStockDisplay(row.product, Number(row.product.reorderQty))}</span></>
                )}
              </p>
            )}
            {!batches ? (
              <p className="text-xs text-slate-400 py-1">Loading batches…</p>
            ) : batches.length === 0 ? (
              <p className="text-xs text-slate-400 py-1">No batch records (stock added before batch tracking)</p>
            ) : (
              <table className="w-full text-xs">
                <thead>
                  <tr className="text-slate-500">
                    <th className="text-left py-1 font-medium">Received</th>
                    <th className="text-right py-1 font-medium">Qty</th>
                    <th className="text-right py-1 font-medium">Expiry Date</th>
                    <th className="text-center py-1 font-medium">Status</th>
                    <th className="text-center py-1 font-medium">Action</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {batches.map((b) => (
                    <Fragment key={b.id}>
                      <tr>
                        <td className="py-1 text-slate-600">{new Date(b.receivedAt).toLocaleDateString()}</td>
                        <td className="py-1 text-right font-medium">{b.qty}</td>
                        <td className={`py-1 text-right ${batchStatusColour(b.status)}`}>
                          {b.expiryDate ? new Date(b.expiryDate).toLocaleDateString('en-US', { day: 'numeric', month: 'short', year: 'numeric' }) : '—'}
                        </td>
                        <td className={`py-1 text-center capitalize ${batchStatusColour(b.status)}`}>
                          {b.status.replace('_', ' ')}
                        </td>
                        <td className="py-1 text-center">
                          {writeOffBatchId === b.id ? (
                            <span className="text-slate-400 italic">editing…</span>
                          ) : (
                            <button
                              onClick={() => startWriteOff(b.id, b.qty)}
                              className="text-red-600 hover:underline font-medium"
                            >
                              Write-off
                            </button>
                          )}
                        </td>
                      </tr>
                      {writeOffBatchId === b.id && (
                        <tr className="bg-red-50">
                          <td colSpan={5} className="px-2 py-2">
                            <div className="flex flex-wrap items-center gap-2">
                              <input
                                type="number" min={1} max={b.qty} step={1}
                                value={woQty}
                                onChange={e => setWoQty(e.target.value)}
                                placeholder="Qty"
                                className="w-20 border border-red-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-red-400"
                              />
                              <input
                                type="text" placeholder="Reason (min 3 chars)"
                                value={woReason}
                                onChange={e => { setWoReason(e.target.value); if (woError) setWoError(null); }}
                                className="flex-1 min-w-32 border border-red-200 rounded px-2 py-1 text-xs focus:outline-none focus:ring-1 focus:ring-red-400"
                              />
                              <button
                                onClick={confirmWriteOff}
                                disabled={writeOffMutation.isPending}
                                className="px-3 py-1 bg-red-600 text-white rounded text-xs font-medium hover:bg-red-700 disabled:opacity-50"
                              >
                                {writeOffMutation.isPending ? '…' : 'Confirm'}
                              </button>
                              <button
                                onClick={() => { setWriteOffBatchId(null); setWoError(null); }}
                                className="px-3 py-1 border border-slate-200 rounded text-xs text-slate-600 hover:bg-slate-100"
                              >
                                Cancel
                              </button>
                              {woError && <span className="text-red-600 text-xs">{woError}</span>}
                            </div>
                          </td>
                        </tr>
                      )}
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
          </td>
        </tr>
      )}
      {woToast && (
        <tr>
          <td colSpan={10} className="px-8 py-1.5">
            <div className="bg-green-50 border border-green-200 text-green-800 text-xs font-medium rounded px-3 py-1.5">
              ✓ {woToast}
            </div>
          </td>
        </tr>
      )}
    </Fragment>
  );
}

// ─── KPI Tile ─────────────────────────────────────────────────────────────────

function KpiTile({ label, value, icon: Icon, color, onClick }: {
  label: string; value: number | string;
  icon: React.ElementType; color: string; onClick?: () => void;
}) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-3 bg-white rounded-xl border border-slate-200 px-4 py-3 text-left w-full hover:shadow-sm transition ${onClick ? 'cursor-pointer' : 'cursor-default'}`}
    >
      <div className={`w-9 h-9 rounded-lg flex items-center justify-center shrink-0 ${color}`}>
        <Icon className="w-4 h-4" />
      </div>
      <div>
        <p className="text-xs text-slate-400 font-medium">{label}</p>
        <p className="text-lg font-bold text-slate-800 leading-tight">{value}</p>
      </div>
    </button>
  );
}

// ─── Stock Levels Tab ─────────────────────────────────────────────────────────

function StockTab({ onAdjust }: { onAdjust: (productId: string, warehouseId: string) => void }) {
  const [search, setSearch]         = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [lowOnly, setLowOnly]       = useState(false);
  const [outOnly, setOutOnly]       = useState(false);
  const [page, setPage]             = useState(1);
  const PAGE_SIZE                   = 20;

  const { data: warehouses = [] } = useQuery({
    queryKey: ['inv-warehouses'],
    queryFn: inventoryApi.getWarehouses,
  });

  // Single source of truth: one query, no dependencies on other mutations.
  // KPIs and table both derive from this dataset — always consistent.
  const { data: allStockData, isLoading, refetch } = useQuery({
    queryKey: ['inv-stock-full'],
    queryFn: () => inventoryApi.listStock({ pageSize: 1000 }),
    staleTime: 30_000,
    refetchOnWindowFocus: false,
  });
  const allRows            = allStockData?.data ?? [];
  const totalStockValueCents = allStockData?.totalStockValueCents ?? 0;

  // ── KPIs — always from unfiltered allRows, never change when table is filtered ─
  const totalSkus     = new Set(allRows.map((r) => r.product.id)).size;
  const lowStockCount = allRows.filter(
    (r) => r.qty > 0 && r.product.reorderLevel > 0 && r.qty <= r.product.reorderLevel,
  ).length;
  const outOfStock    = allRows.filter((r) => r.qty <= 0).length;
  const expiringSoon  = allRows.filter((r) => r.expiringSoonQty > 0).length;

  // ── Table: client-side filter + paginate allRows ──────────────────────────────
  const lc = search.toLowerCase();
  const filteredRows = allRows
    .filter((r) => !warehouseId || r.warehouse.id === warehouseId)
    .filter((r) => !lc || r.product.name.toLowerCase().includes(lc) || r.product.sku.toLowerCase().includes(lc))
    .filter((r) => !lowOnly || r.isLowStock)
    .filter((r) => !outOnly || r.qty <= 0);

  const totalFiltered = filteredRows.length;
  const totalPages    = Math.ceil(totalFiltered / PAGE_SIZE);
  const pageRows      = filteredRows.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  return (
    <div className="space-y-4">
      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-5 gap-3">
        <KpiTile label="Total SKUs" value={totalSkus} icon={Layers} color="bg-indigo-100 text-indigo-600" />
        <KpiTile label="Low Stock" value={lowStockCount} icon={AlertTriangle} color="bg-amber-100 text-amber-600"
          onClick={lowStockCount > 0 ? () => { setLowOnly(true); setOutOnly(false); setPage(1); } : undefined} />
        <KpiTile label="Out of Stock" value={outOfStock} icon={XCircle} color="bg-slate-100 text-slate-500"
          onClick={outOfStock > 0 ? () => { setOutOnly(true); setLowOnly(false); setPage(1); } : undefined} />
        <KpiTile label="Expiring Soon" value={expiringSoon} icon={Clock} color="bg-orange-100 text-orange-600" />
        <KpiTile
          label="Stock Value"
          value={`Rs. ${(totalStockValueCents / 100).toLocaleString('en-US', { maximumFractionDigits: 0 })}`}
          icon={DollarSign}
          color="bg-blue-100 text-blue-600"
        />
      </div>

      {/* Active filter badge */}
      {(lowOnly || outOnly) && (
        <div className="flex items-center gap-2">
          <span className={`inline-flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1 rounded-full ${
            outOnly ? 'bg-slate-100 text-slate-700' : 'bg-amber-100 text-amber-700'
          }`}>
            {outOnly ? <XCircle className="w-3 h-3" /> : <AlertTriangle className="w-3 h-3" />}
            {outOnly ? 'Out of stock only' : 'Low stock only'}
          </span>
          <button
            onClick={() => { setLowOnly(false); setOutOnly(false); setPage(1); }}
            className="text-xs text-slate-400 hover:text-slate-600 underline"
          >
            Clear filter
          </button>
        </div>
      )}

      {/* Filters */}
      <div className="flex gap-3 flex-wrap">
        <div className="relative flex-1 min-w-48">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
          <input
            type="text"
            placeholder="Search product or SKU…"
            value={search}
            onChange={(e) => { setSearch(e.target.value); setPage(1); }}
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <button
          onClick={() => refetch()}
          title="Refresh stock data"
          className="flex items-center gap-1.5 px-3 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50 transition"
        >
          <RefreshCw className={`w-4 h-4 ${isLoading ? 'animate-spin text-blue-500' : ''}`} />
        </button>
        <select
          value={warehouseId}
          onChange={(e) => { setWarehouseId(e.target.value); setPage(1); }}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
        >
          <option value="">All Warehouses</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={lowOnly}
            onChange={(e) => { setLowOnly(e.target.checked); setOutOnly(false); setPage(1); }}
            className="rounded"
          />
          Low stock only
        </label>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="w-8" />
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Product</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">SKU</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Warehouse</th>
              <th className="text-right px-4 py-3 font-semibold text-slate-600">Sellable Qty</th>
              <th className="text-right px-4 py-3 font-semibold text-slate-600">Value</th>
              <th className="text-right px-4 py-3 font-semibold text-slate-600">Reorder</th>
              <th className="text-center px-4 py-3 font-semibold text-slate-600">Expiry</th>
              <th className="text-center px-4 py-3 font-semibold text-slate-600">Status</th>
              <th className="text-center px-4 py-3 font-semibold text-slate-600">Action</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isLoading && (
              <tr><td colSpan={10} className="text-center py-8 text-slate-400">Loading…</td></tr>
            )}
            {!isLoading && pageRows.length === 0 && (
              <tr><td colSpan={10} className="text-center py-8 text-slate-400">No stock records found</td></tr>
            )}
            {pageRows.map((row) => (
              <StockRow
                key={row.id}
                row={row}
                onAdjust={() => onAdjust(row.product.id, row.warehouse.id)}
              />
            ))}
          </tbody>
        </table>
      </div>

      {/* Total inventory value */}
      {totalStockValueCents > 0 && (
        <div className="flex justify-end">
          <p className="text-sm font-bold text-slate-700">
            Total Inventory Value:{' '}
            <span className="text-blue-700">
              Rs. {(totalStockValueCents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}
            </span>
          </p>
        </div>
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{totalFiltered} records</span>
          <div className="flex gap-2">
            <button
              disabled={page === 1}
              onClick={() => setPage(p => p - 1)}
              className="px-3 py-1 border border-slate-200 rounded disabled:opacity-40 hover:bg-slate-50"
            >
              ← Prev
            </button>
            <span className="px-3 py-1">Page {page} of {totalPages}</span>
            <button
              disabled={page === totalPages}
              onClick={() => setPage(p => p + 1)}
              className="px-3 py-1 border border-slate-200 rounded disabled:opacity-40 hover:bg-slate-50"
            >
              Next →
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Adjust Stock Tab ─────────────────────────────────────────────────────────

function AdjustTab({ prefillProductId, prefillWarehouseId }: { prefillProductId?: string; prefillWarehouseId?: string }) {
  const qc = useQueryClient();
  const [productId, setProductId] = useState(prefillProductId ?? '');
  const [unitId, setUnitId] = useState('');
  const [warehouseId, setWarehouseId] = useState(prefillWarehouseId ?? '');
  const [qty, setQty] = useState('');
  const [reason, setReason] = useState('');
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [reasonError, setReasonError] = useState<string | null>(null);
  const [scanMsg, setScanMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const qtyInputRef = useRef<HTMLInputElement>(null);

  async function handleAdjustScan(barcode: string) {
    setScanMsg(null);
    try {
      const found = await productsApi.getByBarcode(barcode);
      setProductId(found.id);
      setUnitId('');
      setScanMsg({ text: `✓ ${found.name} selected`, ok: true });
      setTimeout(() => setScanMsg(null), 2000);
      setTimeout(() => qtyInputRef.current?.focus(), 50);
    } catch (err: unknown) {
      const text = axios.isAxiosError(err) && err.response?.status === 404
        ? `Product not found: ${barcode}`
        : 'Scan error';
      setScanMsg({ text, ok: false });
      setTimeout(() => setScanMsg(null), 3000);
    }
  }

  const { data: warehouses = [] } = useQuery({
    queryKey: ['inv-warehouses'],
    queryFn: inventoryApi.getWarehouses,
  });

  const { data: stockData } = useQuery({
    queryKey: ['inv-stock-all'],
    queryFn: () => inventoryApi.listStock({ pageSize: 100 }),
  });
  const products = stockData
    ? [...new Map(stockData.data.map((r) => [r.product.id, r.product])).values()]
    : [];

  // Unit-aware adjustment: derive the selected product's base unit + the
  // packaging conversions that map directly to it (mirror Purchases picker).
  const selectedProduct = useMemo(
    () => products.find((p) => p.id === productId),
    [products, productId],
  );

  const baseUnitId = selectedProduct
    ? (selectedProduct.baseUnitId ?? selectedProduct.unit.id)
    : null;

  const baseUnit = selectedProduct
    ? (selectedProduct.baseUnit ?? selectedProduct.unit)
    : null;

  const availableConvs = useMemo(
    () => (selectedProduct?.unitConversions ?? []).filter((c) => c.toUnitId === baseUnitId),
    [selectedProduct, baseUnitId],
  );

  const selectedConv = availableConvs.find((c) => c.fromUnitId === unitId);

  const selectedUnitAllowDecimal = unitId === '' || unitId === baseUnitId
    ? (baseUnit?.allowDecimal ?? true)
    : (selectedConv?.fromUnit.allowDecimal ?? true);

  // Conversion preview: base-unit equivalent of the entered qty (string Decimal
  // → Number per house convention). Sign-aware; null hides the preview line.
  const previewBaseQty = useMemo(() => {
    const numQty = parseFloat(qty);
    if (!selectedConv || !Number.isFinite(numQty) || numQty === 0) return null;
    return numQty * Number(selectedConv.conversionQty);
  }, [qty, selectedConv]);

  const mutation = useMutation({
    mutationFn: (payload: AdjustmentPayload) => inventoryApi.createAdjustment(payload),
    onSuccess: (data) => {
      setSuccess(`✅ Done! ${data.productName} in ${data.warehouseName}: ${data.previousQty} → ${data.newQty}`);
      setError('');
      setQty('');
      setReason('');
      qc.invalidateQueries({ queryKey: ['inv-stock'] });
      qc.invalidateQueries({ queryKey: ['pos-products'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Adjustment failed';
      setError(msg);
      setSuccess('');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    setReasonError(null);
    if (!productId || !warehouseId || !qty || !reason) {
      setError('All fields are required');
      return;
    }
    const trimmedReason = reason.trim();
    if (trimmedReason.length < 3) {
      setReasonError('Reason must be at least 3 characters');
      return;
    }
    mutation.mutate({
      productId,
      warehouseId,
      unitId: unitId || undefined,
      qty: parseFloat(qty),
      reason: trimmedReason,
    });
  };

  return (
    <div className="max-w-lg">
      <p className="text-sm text-slate-500 mb-6">
        Use adjustments to correct stock after a physical count or to record damage/loss.
        A movement record is always created — adjustments cannot be undone silently.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4 bg-white border border-slate-200 rounded-xl p-6">
        {/* Barcode scan to select product */}
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Scan to find product</label>
          <div className="flex items-center gap-2">
            <BarcodeInput
              onScan={(code) => { void handleAdjustScan(code); }}
              placeholder="Scan barcode…"
              showScanning
              className="max-w-xs"
            />
            {scanMsg && (
              <span className={`text-xs font-medium px-2.5 py-1 rounded-lg ${scanMsg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                {scanMsg.text}
              </span>
            )}
          </div>
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700">Product</label>
          <select value={productId} onChange={(e) => { setProductId(e.target.value); setUnitId(''); }} required
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">— Select product —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700">Unit</label>
          <select
            value={unitId}
            onChange={(e) => setUnitId(e.target.value)}
            disabled={!productId}
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">{baseUnit?.shortCode ?? 'Base unit'} (base)</option>
            {availableConvs.map((c) => (
              <option key={c.fromUnitId} value={c.fromUnitId}>
                {c.fromUnit.shortCode}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700">Warehouse</label>
          <select value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)} required
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">— Select warehouse —</option>
            {warehouses.map((w) => (
              <option key={w.id} value={w.id}>{w.name}</option>
            ))}
          </select>
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700">
            Quantity <span className="text-slate-400 font-normal">(use negative to remove, e.g. -5)</span>
          </label>
          <div className="mt-1 relative">
            <input ref={qtyInputRef} type="number" step={selectedUnitAllowDecimal ? "0.01" : "1"} value={qty} onChange={(e) => setQty(e.target.value)}
              placeholder="e.g. 10 or -3" required
              className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
            {qty && (
              <span className="absolute right-3 top-1/2 -translate-y-1/2">
                {parseFloat(qty) > 0
                  ? <TrendingUp className="w-4 h-4 text-green-500" />
                  : <TrendingDown className="w-4 h-4 text-red-500" />}
              </span>
            )}
          </div>
          {selectedConv && previewBaseQty !== null && (
            <p className="text-[10px] text-indigo-500 mt-0.5 px-1">
              = {fmtQty(Math.abs(previewBaseQty))} {baseUnit?.shortCode}
              {previewBaseQty < 0 ? ' (removed)' : ' (added)'}
            </p>
          )}
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700">Reason <span className="text-red-500">*</span></label>
          <textarea value={reason}
            onChange={(e) => { setReason(e.target.value); if (reasonError) setReasonError(null); }}
            placeholder="e.g. Stocktake correction, damaged goods, opening balance" required
            rows={2}
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none" />
          {reasonError && <span className="text-red-600 text-xs">{reasonError}</span>}
        </div>

        {error && (
          <div className="flex gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
          </div>
        )}
        {success && (
          <div className="flex gap-2 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
            <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" /> {success}
          </div>
        )}

        <button type="submit" disabled={mutation.isPending}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold py-2.5 rounded-lg text-sm transition">
          {mutation.isPending ? 'Saving…' : 'Apply Adjustment'}
        </button>
      </form>
    </div>
  );
}

// ─── Transfer Tab ─────────────────────────────────────────────────────────────

function TransferTab() {
  const qc = useQueryClient();
  const [productId, setProductId] = useState('');
  const [fromWarehouseId, setFromWarehouseId] = useState('');
  const [toWarehouseId, setToWarehouseId] = useState('');
  const [qty, setQty] = useState('');
  const [note, setNote] = useState('');
  const [success, setSuccess] = useState('');
  const [error, setError] = useState('');
  const [scanMsg, setScanMsg] = useState<{ text: string; ok: boolean } | null>(null);
  const transferQtyRef = useRef<HTMLInputElement>(null);

  async function handleTransferScan(barcode: string) {
    setScanMsg(null);
    try {
      const found = await productsApi.getByBarcode(barcode);
      setProductId(found.id);
      setScanMsg({ text: `✓ ${found.name} selected`, ok: true });
      setTimeout(() => setScanMsg(null), 2000);
      setTimeout(() => transferQtyRef.current?.focus(), 50);
    } catch (err: unknown) {
      const text = axios.isAxiosError(err) && err.response?.status === 404
        ? `Product not found: ${barcode}`
        : 'Scan error';
      setScanMsg({ text, ok: false });
      setTimeout(() => setScanMsg(null), 3000);
    }
  }

  const { data: warehouses = [] } = useQuery({
    queryKey: ['inv-warehouses'],
    queryFn: inventoryApi.getWarehouses,
  });

  const { data: stockData } = useQuery({
    queryKey: ['inv-stock-all'],
    queryFn: () => inventoryApi.listStock({ pageSize: 100 }),
  });
  const products = stockData
    ? [...new Map(stockData.data.map((r) => [r.product.id, r.product])).values()]
    : [];

  const mutation = useMutation({
    mutationFn: (payload: TransferPayload) => inventoryApi.createTransfer(payload),
    onSuccess: (data) => {
      setSuccess(`✅ Transferred ${data.qty} units of "${data.productName}" from ${data.from} → ${data.to}`);
      setError('');
      setQty('');
      setNote('');
      qc.invalidateQueries({ queryKey: ['inv-stock'] });
      qc.invalidateQueries({ queryKey: ['pos-products'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Transfer failed';
      setError(msg);
      setSuccess('');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setSuccess('');
    if (fromWarehouseId === toWarehouseId) {
      setError('Source and destination warehouse must be different');
      return;
    }
    mutation.mutate({
      productId,
      fromWarehouseId,
      toWarehouseId,
      qty: parseFloat(qty),
      note: note || undefined,
    });
  };

  return (
    <div className="max-w-lg">
      <p className="text-sm text-slate-500 mb-6">
        Transfer stock between warehouses. Both a TRANSFER_OUT and TRANSFER_IN movement are
        recorded automatically. Stock in the source warehouse must be sufficient.
      </p>
      <form onSubmit={handleSubmit} className="space-y-4 bg-white border border-slate-200 rounded-xl p-6">
        {/* Barcode scan to select product */}
        <div>
          <label className="text-xs font-medium text-slate-500 mb-1 block">Scan to find product</label>
          <div className="flex items-center gap-2">
            <BarcodeInput
              onScan={(code) => { void handleTransferScan(code); }}
              placeholder="Scan barcode…"
              showScanning
              className="max-w-xs"
            />
            {scanMsg && (
              <span className={`text-xs font-medium px-2.5 py-1 rounded-lg ${scanMsg.ok ? 'bg-green-50 text-green-700' : 'bg-red-50 text-red-600'}`}>
                {scanMsg.text}
              </span>
            )}
          </div>
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700">Product</label>
          <select value={productId} onChange={(e) => setProductId(e.target.value)} required
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
            <option value="">— Select product —</option>
            {products.map((p) => (
              <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
            ))}
          </select>
        </div>
        <div className="grid grid-cols-2 gap-3">
          <div>
            <label className="text-sm font-medium text-slate-700">From</label>
            <select value={fromWarehouseId} onChange={(e) => setFromWarehouseId(e.target.value)} required
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">— Source —</option>
              {warehouses.map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
          <div>
            <label className="text-sm font-medium text-slate-700">To</label>
            <select value={toWarehouseId} onChange={(e) => setToWarehouseId(e.target.value)} required
              className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
              <option value="">— Destination —</option>
              {warehouses.filter((w) => w.id !== fromWarehouseId).map((w) => (
                <option key={w.id} value={w.id}>{w.name}</option>
              ))}
            </select>
          </div>
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700">Quantity</label>
          <input ref={transferQtyRef} type="number" step="0.01" min="0.01" value={qty}
            onChange={(e) => setQty(e.target.value)} required placeholder="e.g. 20"
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>
        <div>
          <label className="text-sm font-medium text-slate-700">Note <span className="text-slate-400 font-normal">(optional)</span></label>
          <input type="text" value={note} onChange={(e) => setNote(e.target.value)}
            placeholder="e.g. Branch restock"
            className="mt-1 w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
        </div>

        {error && (
          <div className="flex gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-600">
            <AlertCircle className="w-4 h-4 shrink-0 mt-0.5" /> {error}
          </div>
        )}
        {success && (
          <div className="flex gap-2 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700">
            <CheckCircle className="w-4 h-4 shrink-0 mt-0.5" /> {success}
          </div>
        )}

        <button type="submit" disabled={mutation.isPending}
          className="w-full bg-blue-600 hover:bg-blue-700 disabled:bg-slate-300 text-white font-semibold py-2.5 rounded-lg text-sm transition">
          {mutation.isPending ? 'Transferring…' : 'Execute Transfer'}
        </button>
      </form>
    </div>
  );
}

// ─── Movement History Tab ─────────────────────────────────────────────────────

// Display-only sign derivation. Stock math NEVER reads stockMovement.qty — it uses
// its own increment/decrement — so normalizing the sign here is purely cosmetic.
// Backend sign storage is inconsistent (RETURN_OUT and non-POS SALE_OUT are stored
// positive even though they reduce stock), so we derive the sign by direction:
//   OUT types → always negative · IN types → always positive
//   ADJUSTMENT carries its own signed delta → shown exactly as stored.
const MOVEMENT_OUT_TYPES: MovementType[] = ['RETURN_OUT', 'SALE_OUT', 'TRANSFER_OUT', 'WRITE_OFF'];
const MOVEMENT_IN_TYPES:  MovementType[] = ['PURCHASE_IN', 'RETURN_IN', 'TRANSFER_IN'];

function signedMovementQty(type: MovementType, qty: number): number {
  if (MOVEMENT_OUT_TYPES.includes(type)) return -Math.abs(qty);
  if (MOVEMENT_IN_TYPES.includes(type))  return  Math.abs(qty);
  return qty; // ADJUSTMENT (and any unknown) — preserve stored sign
}

function HistoryTab() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState<MovementType | ''>('');
  const [warehouseId, setWarehouseId] = useState('');

  const { data: warehouses = [] } = useQuery({
    queryKey: ['inv-warehouses'],
    queryFn: inventoryApi.getWarehouses,
  });

  const { data, isFetching } = useQuery({
    queryKey: ['inv-movements', type, warehouseId, page],
    queryFn: () =>
      inventoryApi.listMovements({
        type: type || undefined,
        warehouseId: warehouseId || undefined,
        page,
        pageSize: 20,
      }),
  });

  const movements = data?.data ?? [];
  const total = data?.total ?? 0;
  const totalPages = Math.ceil(total / 20);

  return (
    <div className="space-y-4">
      <div className="flex gap-3 flex-wrap">
        <select value={type} onChange={(e) => { setType(e.target.value as MovementType | ''); setPage(1); }}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Types</option>
          {Object.entries(MOVEMENT_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select value={warehouseId} onChange={(e) => { setWarehouseId(e.target.value); setPage(1); }}
          className="border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
          <option value="">All Warehouses</option>
          {warehouses.map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>
        <span className="ml-auto text-sm text-slate-400 self-center">{total} records</span>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 overflow-x-auto">
        <table className="w-full text-sm">
          <thead className="bg-slate-50 border-b border-slate-200">
            <tr>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Date</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Product</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Warehouse</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Type</th>
              <th className="text-right px-4 py-3 font-semibold text-slate-600">Qty</th>
              <th className="text-left px-4 py-3 font-semibold text-slate-600">Note</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-slate-100">
            {isFetching && (
              <tr><td colSpan={6} className="text-center py-8 text-slate-400">Loading…</td></tr>
            )}
            {!isFetching && movements.length === 0 && (
              <tr><td colSpan={6} className="text-center py-8 text-slate-400">No movements found</td></tr>
            )}
            {movements.map((m) => (
              <tr key={m.id} className="hover:bg-slate-50">
                <td className="px-4 py-3 text-slate-500 whitespace-nowrap">
                  {new Date(m.createdAt).toLocaleString()}
                </td>
                <td className="px-4 py-3">
                  <div className="font-medium text-slate-800">{m.product.name}</div>
                  <div className="text-xs text-slate-400">{m.product.sku}</div>
                </td>
                <td className="px-4 py-3 text-slate-600">{m.warehouse.name}</td>
                <td className="px-4 py-3">
                  <span className={`text-xs px-2 py-0.5 rounded-full font-medium ${MOVEMENT_COLORS[m.type]}`}>
                    {MOVEMENT_LABELS[m.type]}
                  </span>
                </td>
                {(() => {
                  const sq = signedMovementQty(m.type, m.qty);
                  return (
                    <td className={`px-4 py-3 text-right font-semibold ${sq > 0 ? 'text-green-600' : sq < 0 ? 'text-red-500' : 'text-slate-500'}`}>
                      {sq > 0 ? '+' : ''}{sq}
                    </td>
                  );
                })()}
                <td className="px-4 py-3 text-slate-500 text-xs max-w-xs truncate">{m.note ?? '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-slate-500">
          <span>{total} records</span>
          <div className="flex gap-2">
            <button disabled={page === 1} onClick={() => setPage(p => p - 1)}
              className="px-3 py-1 border border-slate-200 rounded disabled:opacity-40 hover:bg-slate-50">← Prev</button>
            <span className="px-3 py-1">Page {page} of {totalPages}</span>
            <button disabled={page === totalPages} onClick={() => setPage(p => p + 1)}
              className="px-3 py-1 border border-slate-200 rounded disabled:opacity-40 hover:bg-slate-50">Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function InventoryPage() {
  const location = useLocation();
  const navigate  = useNavigate();

  // Derive active tab from the current URL path — matches sidebar navigation
  const activeTab: Tab = location.pathname.includes('transfers')
    ? 'transfer'
    : location.pathname.includes('adjustments')
    ? 'adjust'
    : location.pathname.includes('movements')
    ? 'history'
    : 'stock';

  // Prefill state for the adjust tab (set when user clicks "Adjust" on a row)
  // Passed via navigation state so it survives the route change
  const navState = location.state as { prefillProductId?: string; prefillWarehouseId?: string } | null;
  const prefillProduct  = navState?.prefillProductId;
  const prefillWarehouse = navState?.prefillWarehouseId;

  const { data: lowStockData = [] } = useQuery({
    queryKey: ['inv-low-stock'],
    queryFn: inventoryApi.getLowStock,
  });

  // Clicking "Adjust" on a stock row → navigate to the adjustments sub-route
  // and pass the product/warehouse IDs via location state
  const handleAdjust = (productId: string, warehouseId: string) => {
    navigate('/inventory/adjustments', {
      state: { prefillProductId: productId, prefillWarehouseId: warehouseId },
    });
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Inventory</h1>
          <p className="text-sm text-slate-500 mt-1">
            Stock levels, adjustments, transfers and full movement history
          </p>
        </div>
        {lowStockData.length > 0 && (
          <div
            className="flex items-center gap-2 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-sm text-red-600 cursor-pointer hover:bg-red-100"
            onClick={() => navigate('/inventory')}
          >
            <AlertTriangle className="w-4 h-4" />
            {lowStockData.length} low stock item{lowStockData.length > 1 ? 's' : ''}
          </div>
        )}
      </div>

      {/* Tabs — clicking navigates so the URL + sidebar stay in sync */}
      <div className="flex gap-2 flex-wrap">
        <TabButton active={activeTab === 'stock'}    onClick={() => navigate('/inventory')}
          icon={Package} label="Stock Levels" />
        <TabButton active={activeTab === 'adjust'}   onClick={() => navigate('/inventory/adjustments')}
          icon={TrendingUp} label="Adjust Stock" />
        <TabButton active={activeTab === 'transfer'} onClick={() => navigate('/inventory/transfers')}
          icon={ArrowRightLeft} label="Transfer" />
        <TabButton active={activeTab === 'history'}  onClick={() => navigate('/inventory/movements')}
          icon={History} label="Movement History" />
      </div>

      {/* Tab content */}
      <div>
        {activeTab === 'stock'    && <StockTab onAdjust={handleAdjust} />}
        {activeTab === 'adjust'   && (
          <AdjustTab prefillProductId={prefillProduct} prefillWarehouseId={prefillWarehouse} />
        )}
        {activeTab === 'transfer' && <TransferTab />}
        {activeTab === 'history'  && <HistoryTab />}
      </div>
    </div>
  );
}
