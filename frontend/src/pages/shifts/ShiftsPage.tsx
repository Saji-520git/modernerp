import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Clock, X, RefreshCw, AlertTriangle, ChevronDown, ChevronUp } from 'lucide-react';
import { shiftsApi, formatShiftDuration, type PosShift, type ShiftWithSales } from '../../services/shifts';
import { inventoryApi } from '../../services/inventory';
import { useAuthStore } from '../../store/authStore';
import { isAdminRole } from '../../utils/roles';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function fmt(cents: number): string {
  return `Rs. ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function fmtShort(cents: number): string {
  const n = cents / 100;
  if (n >= 1_000_000) return `Rs. ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `Rs. ${(n / 1_000).toFixed(1)}K`;
  return `Rs. ${n.toFixed(0)}`;
}

function fmtTime(iso: string) {
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric',
    hour: '2-digit', minute: '2-digit',
  });
}

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Cash', CARD: 'Card', BANK_TRANSFER: 'Bank Transfer',
  QR_PAY: 'QR Pay', CREDIT: 'Credit',
};

// ─── VarianceChip ─────────────────────────────────────────────────────────────

function VarianceChip({ cents }: { cents: number | null }) {
  if (cents === null) return <span className="text-slate-300 text-xs">—</span>;
  if (cents === 0) return (
    <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-700">✓ Balanced</span>
  );
  if (cents > 0) return (
    <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-green-100 text-green-700">
      ▲ {fmt(cents)}
    </span>
  );
  return (
    <span className="px-1.5 py-0.5 rounded text-xs font-semibold bg-red-100 text-red-700">
      ▼ {fmt(Math.abs(cents))}
    </span>
  );
}

// ─── StatusBadge ─────────────────────────────────────────────────────────────

function StatusBadge({ status }: { status: 'OPEN' | 'CLOSED' }) {
  if (status === 'OPEN') return (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-emerald-700">
      <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" /> OPEN
    </span>
  );
  return (
    <span className="flex items-center gap-1.5 text-xs font-semibold text-slate-500">
      <span className="w-1.5 h-1.5 rounded-full bg-slate-400" /> CLOSED
    </span>
  );
}

// ─── ShiftDetailDrawer ────────────────────────────────────────────────────────

function ShiftDetailDrawer({
  shiftId,
  onClose,
}: {
  shiftId: string;
  onClose: () => void;
}) {
  const { user } = useAuthStore();
  const isAdmin  = isAdminRole(user?.role);
  const qc       = useQueryClient();
  const [forceNote, setForceNote] = useState('');
  const [forceError, setForceError] = useState<string | null>(null);
  const [confirmingForce, setConfirmingForce] = useState(false);

  const { data: shift, isLoading } = useQuery({
    queryKey: ['shift-detail', shiftId],
    queryFn:  () => shiftsApi.getOne(shiftId),
  });

  const forceMutation = useMutation({
    mutationFn: () => shiftsApi.forceClose(shiftId, forceNote.trim() || undefined),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['shifts'] });
      qc.invalidateQueries({ queryKey: ['shift-detail', shiftId] });
      setConfirmingForce(false);
    },
    onError: (err: any) => {
      setForceError(err?.response?.data?.message ?? 'Failed to force-close shift');
    },
  });

  const payRows = shift ? [
    { label: 'Cash',          value: shift.cashSalesCents },
    { label: 'Card',          value: shift.cardSalesCents },
    { label: 'QR Pay',        value: shift.qrPayCents },
    { label: 'Bank Transfer', value: shift.bankTransferCents },
    { label: 'Credit',        value: shift.creditSalesCents },
  ] : [];

  return (
    <div className="fixed inset-0 z-40 flex">
      {/* Backdrop */}
      <div className="flex-1 bg-slate-900/40" onClick={onClose} />
      {/* Drawer */}
      <div className="w-full max-w-lg bg-white shadow-2xl overflow-y-auto flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200 shrink-0">
          <h2 className="text-base font-bold text-slate-800">Shift Detail</h2>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
            <X size={16} />
          </button>
        </div>

        {isLoading && (
          <div className="flex items-center justify-center py-20 text-slate-400 gap-2">
            <RefreshCw size={16} className="animate-spin" /> Loading…
          </div>
        )}

        {shift && (
          <div className="p-6 space-y-5 flex-1">
            {/* Metadata */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Cashier</p>
                <p className="font-semibold text-slate-800">{shift.user.fullName}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Warehouse</p>
                <p className="font-semibold text-slate-800">{shift.warehouse.name}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Opened</p>
                <p className="font-semibold text-slate-800">{fmtTime(shift.openedAt)}</p>
              </div>
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Closed</p>
                <p className="font-semibold text-slate-800">
                  {shift.closedAt ? fmtTime(shift.closedAt) : '—'}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Duration</p>
                <p className="font-semibold text-slate-800">
                  {formatShiftDuration(shift.openedAt, shift.closedAt)}
                </p>
              </div>
              <div>
                <p className="text-xs text-slate-400 uppercase tracking-wide mb-0.5">Status</p>
                <StatusBadge status={shift.status} />
              </div>
            </div>

            {/* Payment breakdown */}
            <div>
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                Sales Breakdown
              </p>
              <div className="border border-slate-200 rounded-xl overflow-hidden text-sm">
                {payRows.map((row) => (
                  <div key={row.label} className="flex justify-between px-4 py-2.5 border-b border-slate-100 last:border-0">
                    <span className="text-slate-600">{row.label}</span>
                    <span className="font-medium text-slate-800">{fmt(row.value)}</span>
                  </div>
                ))}
                <div className="flex justify-between px-4 py-2.5 bg-slate-50 font-semibold text-sm border-t border-slate-200">
                  <span className="text-slate-700">Total Sales</span>
                  <span className="text-slate-800">{fmt(shift.totalSalesCents)}</span>
                </div>
              </div>
            </div>

            {/* Cash reconciliation */}
            {shift.status === 'CLOSED' && (
              <div className="bg-slate-50 border border-slate-200 rounded-xl p-4 text-sm space-y-1.5">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">Cash Reconciliation</p>
                <div className="flex justify-between">
                  <span className="text-slate-600">Opening Float</span>
                  <span>{fmt(shift.openingCashCents)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">+ Cash Sales</span>
                  <span>{fmt(shift.cashSalesCents)}</span>
                </div>
                <div className="flex justify-between font-semibold border-t border-slate-200 pt-1.5">
                  <span className="text-slate-700">Expected</span>
                  <span>{fmt(shift.expectedCashCents ?? 0)}</span>
                </div>
                <div className="flex justify-between">
                  <span className="text-slate-600">Actual Counted</span>
                  <span>{shift.closingCashCents !== null ? fmt(shift.closingCashCents) : '—'}</span>
                </div>
                <div className="flex justify-between font-semibold pt-0.5">
                  <span className="text-slate-700">Variance</span>
                  <VarianceChip cents={shift.varianceCents} />
                </div>
                {shift.note && (
                  <p className="text-xs text-slate-500 italic mt-1">Note: {shift.note}</p>
                )}
                {shift.forceClosedBy && (
                  <p className="text-xs text-amber-600 mt-1">
                    Force-closed by {shift.forceClosedBy.fullName}
                  </p>
                )}
              </div>
            )}

            {/* Sales list */}
            {'sales' in shift && (shift as ShiftWithSales).sales.length > 0 && (
              <div>
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
                  Sales ({(shift as ShiftWithSales).sales.length})
                </p>
                <div className="border border-slate-200 rounded-xl overflow-hidden text-sm max-h-64 overflow-y-auto">
                  {(shift as ShiftWithSales).sales.map((s) => (
                    <div key={s.id} className="flex items-center justify-between px-4 py-2.5 border-b border-slate-100 last:border-0 hover:bg-slate-50">
                      <div>
                        <p className="font-medium text-slate-800">{s.number}</p>
                        <p className="text-xs text-slate-400">
                          {s.customer?.name ?? 'Walk-in'} · {new Date(s.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </p>
                      </div>
                      <div className="text-right">
                        <p className="font-semibold text-slate-800">{fmt(s.totalCents)}</p>
                        <p className="text-xs text-slate-400">{PAYMENT_LABELS[s.paymentMethod] ?? s.paymentMethod}</p>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Force-close (ADMIN only, OPEN shifts) */}
            {isAdmin && shift.status === 'OPEN' && (
              <div className="border border-red-200 rounded-xl p-4">
                {!confirmingForce ? (
                  <button
                    onClick={() => setConfirmingForce(true)}
                    className="w-full py-2.5 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold transition"
                  >
                    Force Close Shift
                  </button>
                ) : (
                  <div className="space-y-3">
                    <p className="text-sm font-semibold text-red-700">Confirm Force Close</p>
                    <textarea
                      value={forceNote}
                      onChange={(e) => setForceNote(e.target.value)}
                      placeholder="Reason for force-closing (optional)"
                      rows={2}
                      className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-red-400 resize-none"
                    />
                    {forceError && <p className="text-xs text-red-600">{forceError}</p>}
                    <div className="flex gap-2">
                      <button
                        onClick={() => setConfirmingForce(false)}
                        className="flex-1 py-2 rounded-lg border border-slate-200 text-sm text-slate-600 hover:bg-slate-50"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => forceMutation.mutate()}
                        disabled={forceMutation.isPending}
                        className="flex-1 py-2 rounded-lg bg-red-600 hover:bg-red-700 text-white text-sm font-semibold disabled:opacity-50"
                      >
                        {forceMutation.isPending ? 'Closing…' : 'Force Close'}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Date helpers ─────────────────────────────────────────────────────────────

function thisMonthStart(): string {
  const d = new Date();
  return new Date(d.getFullYear(), d.getMonth(), 1).toISOString().split('T')[0];
}
function today(): string {
  return new Date().toISOString().split('T')[0];
}

// ─── ShiftsPage ───────────────────────────────────────────────────────────────

export default function ShiftsPage() {
  const [page, setPage]               = useState(1);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'OPEN' | 'CLOSED'>('ALL');
  const [warehouseFilter, setWarehouseFilter] = useState('');
  const [fromDate, setFromDate]       = useState(thisMonthStart);
  const [toDate, setToDate]           = useState(today);
  const [selectedShiftId, setSelectedShiftId] = useState<string | null>(null);
  const [sortDir, setSortDir]         = useState<'desc' | 'asc'>('desc');

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn:  inventoryApi.getWarehouses,
  });

  const { data, isLoading, refetch } = useQuery({
    queryKey: ['shifts', page, statusFilter, warehouseFilter, fromDate, toDate],
    queryFn:  () => shiftsApi.list({
      page,
      pageSize: 20,
      status:      statusFilter !== 'ALL' ? statusFilter : undefined,
      warehouseId: warehouseFilter || undefined,
      from:        fromDate || undefined,
      to:          toDate   || undefined,
    }),
    placeholderData: (prev) => prev,
  });

  const shifts = data?.data ?? [];
  const total  = data?.total ?? 0;
  const pages  = Math.ceil(total / 20);

  // ── KPI tiles computed from current page ──────────────────────────────────
  const openShifts   = shifts.filter((s) => s.status === 'OPEN').length;
  const totalSales   = shifts.reduce((s, sh) => s + sh.totalSalesCents, 0);
  const variances    = shifts.filter((s) => s.varianceCents !== null).map((s) => Math.abs(s.varianceCents!));
  const avgVariance  = variances.length > 0 ? Math.round(variances.reduce((a, b) => a + b, 0) / variances.length) : 0;

  const sorted = [...shifts].sort((a, b) => {
    const da = new Date(a.openedAt).getTime();
    const db = new Date(b.openedAt).getTime();
    return sortDir === 'desc' ? db - da : da - db;
  });

  return (
    <div className="p-6">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
          <Clock size={22} className="text-indigo-600" /> POS Shifts
        </h1>
        <p className="text-sm text-slate-500 mt-1">Shift history and cash reconciliation</p>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-indigo-600 text-white rounded-xl p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-indigo-200 mb-1">Shifts (page)</p>
          <p className="text-2xl font-bold">{shifts.length}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">Open Shifts</p>
          <p className={`text-2xl font-bold ${openShifts > 0 ? 'text-emerald-600' : 'text-slate-800'}`}>{openShifts}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">Total Sales</p>
          <p className="text-2xl font-bold text-slate-800">{fmtShort(totalSales)}</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">Avg Variance</p>
          <p className={`text-2xl font-bold ${avgVariance > 0 ? 'text-red-600' : 'text-slate-800'}`}>
            {avgVariance > 0 ? fmt(avgVariance) : '—'}
          </p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {/* Status */}
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {(['ALL', 'OPEN', 'CLOSED'] as const).map((s) => (
            <button
              key={s}
              onClick={() => { setStatusFilter(s); setPage(1); }}
              className={`px-3 py-1 rounded-md text-xs font-medium transition ${
                statusFilter === s ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {s}
            </button>
          ))}
        </div>

        {/* Warehouse */}
        <select
          value={warehouseFilter}
          onChange={(e) => { setWarehouseFilter(e.target.value); setPage(1); }}
          className="border border-slate-200 rounded-lg px-3 py-1.5 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500"
        >
          <option value="">All Warehouses</option>
          {(warehouses as { id: string; name: string }[]).map((w) => (
            <option key={w.id} value={w.id}>{w.name}</option>
          ))}
        </select>

        {/* Date range */}
        <input
          type="date" value={fromDate}
          onChange={(e) => { setFromDate(e.target.value); setPage(1); }}
          className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />
        <span className="text-slate-400 text-xs">to</span>
        <input
          type="date" value={toDate}
          onChange={(e) => { setToDate(e.target.value); setPage(1); }}
          className="border border-slate-200 rounded-lg px-2 py-1.5 text-xs focus:outline-none focus:ring-2 focus:ring-indigo-500"
        />

        <button type="button" onClick={() => { setFromDate(thisMonthStart()); setToDate(today()); setPage(1); }}
          className="text-xs text-slate-500 hover:text-slate-700 underline">This month</button>
        <button type="button" onClick={() => { setFromDate(''); setToDate(''); setPage(1); }}
          className="text-xs text-slate-500 hover:text-slate-700 underline">All time</button>

        <button
          onClick={() => refetch()}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-slate-200 text-xs text-slate-600 hover:bg-slate-50"
        >
          <RefreshCw size={12} /> Refresh
        </button>
      </div>

      {/* Table */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
          <RefreshCw size={18} className="animate-spin" /> Loading…
        </div>
      ) : (
        <div className="bg-white border border-slate-200 rounded-xl overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-slate-50 border-b border-slate-200">
              <tr>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Cashier</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase hidden md:table-cell">Warehouse</th>
                <th
                  className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase cursor-pointer select-none hover:text-slate-700"
                  onClick={() => setSortDir(d => d === 'desc' ? 'asc' : 'desc')}
                >
                  Opened {sortDir === 'desc' ? <ChevronDown size={10} className="inline" /> : <ChevronUp size={10} className="inline" />}
                </th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase hidden lg:table-cell">Closed</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase hidden lg:table-cell">Duration</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Sales</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase hidden md:table-cell">Txns</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase hidden lg:table-cell">Opening</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase hidden lg:table-cell">Closing</th>
                <th className="text-right px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Variance</th>
                <th className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase">Status</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {sorted.length === 0 ? (
                <tr>
                  <td colSpan={11} className="px-4 py-12 text-center text-slate-400 text-sm">
                    No shifts found for the selected filters
                  </td>
                </tr>
              ) : sorted.map((shift) => (
                <tr
                  key={shift.id}
                  className="hover:bg-slate-50 cursor-pointer"
                  onClick={() => setSelectedShiftId(shift.id)}
                >
                  <td className="px-4 py-3 font-medium text-slate-800">{shift.user.fullName}</td>
                  <td className="px-4 py-3 text-slate-600 hidden md:table-cell">{shift.warehouse.name}</td>
                  <td className="px-4 py-3 text-slate-600 text-xs">{fmtTime(shift.openedAt)}</td>
                  <td className="px-4 py-3 text-slate-500 text-xs hidden lg:table-cell">
                    {shift.closedAt ? fmtTime(shift.closedAt) : '—'}
                  </td>
                  <td className="px-4 py-3 text-slate-500 text-xs hidden lg:table-cell">
                    {formatShiftDuration(shift.openedAt, shift.closedAt)}
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-800">{fmtShort(shift.totalSalesCents)}</td>
                  <td className="px-4 py-3 text-right text-slate-600 hidden md:table-cell">{shift.saleCount}</td>
                  <td className="px-4 py-3 text-right text-slate-500 hidden lg:table-cell">{fmt(shift.openingCashCents)}</td>
                  <td className="px-4 py-3 text-right text-slate-500 hidden lg:table-cell">
                    {shift.closingCashCents !== null ? fmt(shift.closingCashCents) : '—'}
                  </td>
                  <td className="px-4 py-3 text-right"><VarianceChip cents={shift.varianceCents} /></td>
                  <td className="px-4 py-3"><StatusBadge status={shift.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Pagination */}
      {pages > 1 && (
        <div className="flex items-center justify-between mt-4 text-sm text-slate-600">
          <p>{total} shifts total</p>
          <div className="flex gap-2">
            <button
              onClick={() => setPage(p => Math.max(1, p - 1))}
              disabled={page === 1}
              className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-xs"
            >
              ← Prev
            </button>
            <span className="px-3 py-1.5 text-xs text-slate-500">Page {page} of {pages}</span>
            <button
              onClick={() => setPage(p => Math.min(pages, p + 1))}
              disabled={page === pages}
              className="px-3 py-1.5 rounded-lg border border-slate-200 hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed text-xs"
            >
              Next →
            </button>
          </div>
        </div>
      )}

      {/* Shift detail drawer */}
      {selectedShiftId && (
        <ShiftDetailDrawer
          shiftId={selectedShiftId}
          onClose={() => setSelectedShiftId(null)}
        />
      )}
    </div>
  );
}
