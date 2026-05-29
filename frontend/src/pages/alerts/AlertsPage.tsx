import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Bell, Package, Clock, AlertTriangle, Check,
  RefreshCw, Settings, X, ChevronRight, ShoppingCart,
} from 'lucide-react';
import {
  alertsApi, type StockAlert, type AlertType,
} from '../../services/alerts';
import { purchasesApi } from '../../services/purchases';
import { inventoryApi } from '../../services/inventory';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function relTime(iso: string): string {
  const ms  = Date.now() - new Date(iso).getTime();
  const min = Math.floor(ms / 60_000);
  const hr  = Math.floor(ms / 3_600_000);
  const day = Math.floor(ms / 86_400_000);
  if (min  < 1)  return 'just now';
  if (min  < 60) return `${min}m ago`;
  if (hr   < 24) return `${hr}h ago`;
  return `${day}d ago`;
}

function fmtDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ─── Alert card ───────────────────────────────────────────────────────────────

function AlertCard({
  alert,
  onDismiss,
  onMarkRead,
  selected,
  onSelect,
}: {
  alert:       StockAlert;
  onDismiss:   (id: string) => void;
  onMarkRead:  (id: string) => void;
  selected?:   boolean;
  onSelect?:   (id: string, checked: boolean) => void;
}) {
  const isCritical = alert.severity === 'CRITICAL';
  const borderColor = isCritical ? 'border-l-red-500' : 'border-l-amber-400';
  const bgColor     = alert.isRead ? 'bg-slate-50' : 'bg-white';

  const TypeIcon = alert.type === 'LOW_STOCK'
    ? Package
    : alert.type === 'EXPIRED'
    ? AlertTriangle
    : Clock;

  const iconColor = alert.type === 'EXPIRED' || isCritical
    ? 'text-red-500'
    : 'text-amber-500';

  const typeLabel: Record<string, string> = {
    LOW_STOCK:     'Low Stock',
    EXPIRING_SOON: 'Expiring Soon',
    EXPIRED:       'Expired',
  };

  const daysLeft = alert.expiryDate
    ? Math.ceil((new Date(alert.expiryDate).getTime() - Date.now()) / 86_400_000)
    : null;

  return (
    <div
      className={`${bgColor} border border-slate-200 border-l-4 ${borderColor} rounded-xl p-4 flex gap-3 hover:shadow-sm transition ${selected ? 'ring-2 ring-indigo-400 ring-offset-1' : ''}`}
      onClick={() => !alert.isRead && onMarkRead(alert.id)}
    >
      {/* Checkbox — only for LOW_STOCK alerts */}
      {alert.type === 'LOW_STOCK' && onSelect && (
        <div className="mt-0.5 shrink-0" onClick={e => e.stopPropagation()}>
          <input
            type="checkbox"
            checked={selected ?? false}
            onChange={e => onSelect(alert.id, e.target.checked)}
            className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500 cursor-pointer"
          />
        </div>
      )}

      {/* Icon */}
      <div className={`mt-0.5 shrink-0 ${iconColor}`}>
        <TypeIcon size={18} />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-start justify-between gap-2 mb-1">
          <div className="flex items-center gap-2 flex-wrap">
            <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded ${
              isCritical ? 'bg-red-100 text-red-700' : 'bg-amber-100 text-amber-700'
            }`}>
              {alert.severity}
            </span>
            <span className="text-[10px] font-semibold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
              {typeLabel[alert.type]}
            </span>
          </div>
          <span className="text-[10px] text-slate-400 shrink-0">{relTime(alert.updatedAt)}</span>
        </div>

        <p className="text-sm font-semibold text-slate-800">{alert.product.name}</p>
        <p className="text-xs text-slate-500">SKU: {alert.product.sku}</p>

        {/* Detail row */}
        <div className="flex flex-wrap gap-3 mt-1.5 text-xs text-slate-600">
          {alert.type === 'LOW_STOCK' && (
            <>
              <span>Stock: <strong>{alert.qty}</strong> units</span>
              <span>Reorder at: <strong>{alert.threshold}</strong></span>
              <span>Deficit: <strong className="text-red-600">{Math.max(0, alert.threshold - alert.qty)}</strong></span>
            </>
          )}
          {(alert.type === 'EXPIRING_SOON' || alert.type === 'EXPIRED') && alert.expiryDate && (
            <>
              <span>Qty: <strong>{alert.qty}</strong> units</span>
              <span>Expiry: <strong>{fmtDate(alert.expiryDate)}</strong></span>
              {daysLeft !== null && (
                <span className={daysLeft < 0 ? 'text-red-600' : 'text-amber-600'}>
                  {daysLeft < 0 ? `${Math.abs(daysLeft)}d expired` : `${daysLeft}d left`}
                </span>
              )}
            </>
          )}
          <span className="text-slate-400">{alert.warehouse?.name ?? 'All Warehouses'}</span>
        </div>

        <p className="text-xs text-slate-500 mt-1.5 italic">{alert.message}</p>
      </div>

      {/* Actions */}
      <div className="flex flex-col gap-1.5 shrink-0">
        <Link
          to="/inventory"
          onClick={e => e.stopPropagation()}
          className="flex items-center gap-1 text-xs text-indigo-600 hover:text-indigo-800 font-medium"
        >
          View <ChevronRight size={11} />
        </Link>
        <button
          onClick={e => { e.stopPropagation(); onDismiss(alert.id); }}
          className="flex items-center gap-1 text-xs text-slate-400 hover:text-slate-600"
          title="Dismiss alert"
        >
          <X size={11} /> Dismiss
        </button>
      </div>
    </div>
  );
}

// ─── Empty state ──────────────────────────────────────────────────────────────

function EmptyState({ tab }: { tab: string }) {
  const messages: Record<string, { title: string; sub: string }> = {
    LOW_STOCK:     { title: 'All products are well stocked!',    sub: 'Stock levels are above all reorder points.' },
    EXPIRING_SOON: { title: 'No products expiring soon',         sub: 'No batches expire within your alert window.' },
    EXPIRED:       { title: 'No expired stock',                  sub: 'All batches are within expiry.' },
    ALL:           { title: 'No active alerts',                  sub: 'Everything looks good — no stock alerts at this time.' },
  };
  const m = messages[tab] ?? messages.ALL;
  return (
    <div className="flex flex-col items-center justify-center py-16 text-slate-400 gap-3">
      <div className="w-14 h-14 bg-emerald-50 rounded-full flex items-center justify-center">
        <Check size={28} className="text-emerald-500" />
      </div>
      <p className="text-base font-semibold text-slate-600">{m.title}</p>
      <p className="text-sm text-center max-w-xs">{m.sub}</p>
    </div>
  );
}

// ─── Page ─────────────────────────────────────────────────────────────────────

export default function AlertsPage() {
  const qc = useQueryClient();

  const navigate = useNavigate();

  const [typeFilter, setTypeFilter]   = useState<AlertType | 'ALL'>('ALL');
  const [unreadOnly, setUnreadOnly]   = useState(false);
  const [dismissed,  setDismissed]    = useState<string[]>([]);

  // ── Auto-PO selection state ───────────────────────────────────────────────
  const [selected,      setSelected]      = useState<Set<string>>(new Set());
  const [showPoModal,   setShowPoModal]   = useState(false);
  const [poWarehouseId, setPoWarehouseId] = useState('');
  const [poSupplierId,  setPoSupplierId]  = useState('');
  const [poQtys,        setPoQtys]        = useState<Record<string, number>>({});

  const params = {
    type:     typeFilter !== 'ALL' ? typeFilter : undefined,
    isRead:   unreadOnly ? false : undefined,
    pageSize: 100,
  };

  const { data, isLoading, isError, error, refetch } = useQuery({
    queryKey: ['alerts', typeFilter, unreadOnly],
    queryFn:  () => alertsApi.getAlerts(params),
    placeholderData: prev => prev,
  });

  const markReadMut = useMutation({
    mutationFn: (ids: string[] | 'all') => alertsApi.markRead(ids),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['alert-count'] });
    },
  });

  const dismissMut = useMutation({
    mutationFn: (id: string) => alertsApi.dismiss(id),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['alert-count'] });
    },
  });

  const dismissAllMut = useMutation({
    mutationFn: () => alertsApi.dismissAll(),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['alerts'] });
      qc.invalidateQueries({ queryKey: ['alert-count'] });
    },
  });

  const { data: warehouses = [] } = useQuery({
    queryKey: ['warehouses'],
    queryFn:  () => inventoryApi.getWarehouses(),
  });

  const { data: suppliers = [] } = useQuery({
    queryKey: ['suppliers'],
    queryFn:  () => purchasesApi.listSuppliers(),
  });

  const createPoMut = useMutation({
    mutationFn: purchasesApi.fromAlerts,
    onSuccess: () => {
      setShowPoModal(false);
      setSelected(new Set());
      navigate('/purchases');
    },
  });

  const items         = (data?.items ?? []).filter(a => !dismissed.includes(a.id));
  const total         = data?.total         ?? 0;
  const unreadCount   = data?.unreadCount   ?? 0;
  const criticalCount = data?.criticalCount ?? 0;

  const lowStockCount   = items.filter(a => a.type === 'LOW_STOCK').length;
  const expiringSoon    = items.filter(a => a.type === 'EXPIRING_SOON').length;
  const expiredCount    = items.filter(a => a.type === 'EXPIRED').length;
  const expiringToday   = items.filter(a => {
    if (a.type !== 'EXPIRING_SOON') return false;
    if (!a.expiryDate) return false;
    const d = new Date(a.expiryDate);
    const today = new Date();
    return d.toDateString() === today.toDateString();
  }).length;

  const handleDismiss = (id: string) => {
    setDismissed(p => [...p, id]);
    dismissMut.mutate(id);
  };

  const handleSelect = (id: string, checked: boolean) => {
    setSelected(prev => {
      const next = new Set(prev);
      if (checked) next.add(id); else next.delete(id);
      return next;
    });
  };

  const lowStockItems   = items.filter(a => a.type === 'LOW_STOCK');
  const selectedAlerts  = lowStockItems.filter(a => selected.has(a.id));
  const allLowSelected  = lowStockItems.length > 0 && lowStockItems.every(a => selected.has(a.id));

  const toggleSelectAll = () => {
    if (allLowSelected) {
      setSelected(new Set());
    } else {
      setSelected(new Set(lowStockItems.map(a => a.id)));
    }
  };

  const openPoModal = () => {
    const qtys: Record<string, number> = {};
    for (const alert of selectedAlerts) {
      qtys[alert.productId] = Math.max(1, alert.threshold - alert.qty);
    }
    setPoQtys(qtys);
    setPoWarehouseId(warehouses[0]?.id ?? '');
    setPoSupplierId(suppliers[0]?.id ?? '');
    setShowPoModal(true);
  };

  const submitPo = () => {
    if (!poWarehouseId || !poSupplierId) return;
    createPoMut.mutate({
      warehouseId: poWarehouseId,
      supplierId:  poSupplierId,
      items: selectedAlerts.map(a => ({
        productId: a.productId,
        qty:       poQtys[a.productId] ?? 1,
      })),
    });
  };

  const TABS: { key: AlertType | 'ALL'; label: string; count: number }[] = [
    { key: 'ALL',          label: 'All',          count: items.length },
    { key: 'LOW_STOCK',    label: 'Low Stock',     count: lowStockCount },
    { key: 'EXPIRING_SOON',label: 'Expiring Soon', count: expiringSoon },
    { key: 'EXPIRED',      label: 'Expired',       count: expiredCount },
  ];

  return (
    <div className="p-6">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3 mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800 flex items-center gap-2">
            <Bell size={22} className="text-indigo-600" /> Stock Alerts
          </h1>
          <p className="text-sm text-slate-500 mt-0.5">Monitor low stock levels and product expiry</p>
        </div>
        <div className="flex items-center gap-2">
          <button onClick={() => refetch()}
            className="p-2 rounded-lg border border-slate-200 hover:bg-slate-50 text-slate-500 transition">
            <RefreshCw size={14} />
          </button>
          {unreadCount > 0 && (
            <button
              onClick={() => markReadMut.mutate('all')}
              disabled={markReadMut.isPending}
              className="px-3 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 transition"
            >
              Mark All Read
            </button>
          )}
          {items.length > 0 && (
            <button
              onClick={() => dismissAllMut.mutate()}
              disabled={dismissAllMut.isPending}
              className="px-3 py-2 text-sm border border-red-200 rounded-lg hover:bg-red-50 text-red-600 transition"
            >
              Dismiss All
            </button>
          )}
          <Link
            to="/settings#alerts"
            className="flex items-center gap-1.5 px-3 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 transition"
          >
            <Settings size={13} /> Alert Settings
          </Link>
        </div>
      </div>

      {/* KPI tiles */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4 mb-6">
        <div className="bg-indigo-600 text-white rounded-xl p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-indigo-200 mb-1">Total</p>
          <p className="text-2xl font-bold">{total}</p>
          <p className="text-xs text-indigo-200 mt-0.5">active alerts</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">Critical</p>
          <p className={`text-2xl font-bold ${criticalCount > 0 ? 'text-red-600' : 'text-slate-800'}`}>{criticalCount}</p>
          <p className="text-xs text-slate-400 mt-0.5">needs attention</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">Unread</p>
          <p className={`text-2xl font-bold ${unreadCount > 0 ? 'text-amber-600' : 'text-slate-800'}`}>{unreadCount}</p>
          <p className="text-xs text-slate-400 mt-0.5">not yet viewed</p>
        </div>
        <div className="bg-white border border-slate-200 rounded-xl p-4">
          <p className="text-xs font-medium uppercase tracking-wide text-slate-500 mb-1">Expiring Today</p>
          <p className={`text-2xl font-bold ${expiringToday > 0 ? 'text-red-600' : 'text-slate-800'}`}>{expiringToday}</p>
          <p className="text-xs text-slate-400 mt-0.5">batches</p>
        </div>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-3 mb-5">
        {/* Type tabs */}
        <div className="flex gap-1 bg-slate-100 rounded-lg p-1">
          {TABS.map(t => (
            <button
              key={t.key}
              onClick={() => setTypeFilter(t.key)}
              className={`px-3 py-1 rounded-md text-xs font-medium transition flex items-center gap-1.5 ${
                typeFilter === t.key ? 'bg-white text-indigo-700 shadow-sm' : 'text-slate-500 hover:text-slate-700'
              }`}
            >
              {t.label}
              {t.count > 0 && (
                <span className={`text-[10px] font-bold px-1 rounded-full ${
                  typeFilter === t.key ? 'bg-indigo-100 text-indigo-700' : 'bg-slate-200 text-slate-500'
                }`}>{t.count}</span>
              )}
            </button>
          ))}
        </div>

        {/* Unread toggle */}
        <button
          onClick={() => setUnreadOnly(v => !v)}
          className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
            unreadOnly ? 'bg-indigo-50 border-indigo-300 text-indigo-700' : 'bg-white border-slate-200 text-slate-600 hover:bg-slate-50'
          }`}
        >
          {unreadOnly ? '● Unread only' : '○ Show all'}
        </button>
      </div>

      {/* Select-all + action bar (LOW_STOCK tab only) */}
      {(typeFilter === 'ALL' || typeFilter === 'LOW_STOCK') && lowStockItems.length > 0 && (
        <div className="flex items-center justify-between mb-3 px-1">
          <label className="flex items-center gap-2 text-xs text-slate-600 cursor-pointer select-none">
            <input
              type="checkbox"
              checked={allLowSelected}
              onChange={toggleSelectAll}
              className="w-4 h-4 rounded border-slate-300 text-indigo-600 focus:ring-indigo-500"
            />
            Select all low-stock ({lowStockItems.length})
          </label>
          {selected.size > 0 && (
            <div className="flex items-center gap-2">
              <span className="text-xs text-slate-500">{selected.size} selected</span>
              <button
                onClick={openPoModal}
                className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-semibold rounded-lg shadow-sm transition"
              >
                <ShoppingCart size={13} /> Generate PO
              </button>
              <button
                onClick={() => setSelected(new Set())}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 hover:bg-slate-100 transition"
                title="Clear selection"
              >
                <X size={13} />
              </button>
            </div>
          )}
        </div>
      )}

      {/* List */}
      {isLoading ? (
        <div className="flex items-center justify-center py-16 text-slate-400 gap-2">
          <RefreshCw size={16} className="animate-spin" /> Loading alerts…
        </div>
      ) : isError ? (
        <div className="flex flex-col items-center justify-center py-16 text-red-500 gap-2">
          <AlertTriangle size={18} />
          <p className="text-sm font-semibold">Could not load alerts</p>
          <p className="text-xs text-slate-400">{error instanceof Error ? error.message : 'Please try again.'}</p>
        </div>
      ) : items.length === 0 ? (
        <EmptyState tab={typeFilter} />
      ) : (
        <div className="space-y-3">
          {items.map(alert => (
            <AlertCard
              key={alert.id}
              alert={alert}
              onDismiss={handleDismiss}
              onMarkRead={id => markReadMut.mutate([id])}
              selected={selected.has(alert.id)}
              onSelect={handleSelect}
            />
          ))}
        </div>
      )}

      {/* Generate PO Modal */}
      {showPoModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg flex flex-col max-h-[90vh]">
            {/* Modal header */}
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <div className="flex items-center gap-2">
                <ShoppingCart size={18} className="text-indigo-600" />
                <h2 className="text-base font-bold text-slate-800">Generate Purchase Order</h2>
              </div>
              <button onClick={() => setShowPoModal(false)} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-400 transition">
                <X size={16} />
              </button>
            </div>

            {/* Modal body */}
            <div className="overflow-y-auto flex-1 px-6 py-4 space-y-4">
              {/* Warehouse */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Warehouse *</label>
                <select
                  value={poWarehouseId}
                  onChange={e => setPoWarehouseId(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  <option value="">Select warehouse…</option>
                  {warehouses.map(w => (
                    <option key={w.id} value={w.id}>{w.name} ({w.code})</option>
                  ))}
                </select>
              </div>

              {/* Supplier */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Supplier *</label>
                <select
                  value={poSupplierId}
                  onChange={e => setPoSupplierId(e.target.value)}
                  className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                >
                  <option value="">Select supplier…</option>
                  {suppliers.map(s => (
                    <option key={s.id} value={s.id}>{s.name}</option>
                  ))}
                </select>
              </div>

              {/* Per-product qty table */}
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-2">Order Quantities</label>
                <div className="border border-slate-200 rounded-xl overflow-hidden">
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="bg-slate-50 text-slate-500 text-left">
                        <th className="px-3 py-2 font-semibold">Product</th>
                        <th className="px-3 py-2 font-semibold text-center w-24">Current</th>
                        <th className="px-3 py-2 font-semibold text-center w-24">Order Qty</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100">
                      {selectedAlerts.map(alert => (
                        <tr key={alert.id} className="hover:bg-slate-50">
                          <td className="px-3 py-2">
                            <p className="font-medium text-slate-800">{alert.product.name}</p>
                            <p className="text-slate-400">{alert.product.sku}</p>
                          </td>
                          <td className="px-3 py-2 text-center text-slate-500">{alert.qty}</td>
                          <td className="px-3 py-2 text-center">
                            <input
                              type="number"
                              min={1}
                              value={poQtys[alert.productId] ?? 1}
                              onChange={e => setPoQtys(prev => ({
                                ...prev,
                                [alert.productId]: Math.max(1, Number(e.target.value)),
                              }))}
                              className="w-20 border border-slate-200 rounded-lg px-2 py-1 text-center focus:outline-none focus:ring-2 focus:ring-indigo-400"
                            />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              {createPoMut.isError && (
                <p className="text-xs text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2">
                  {createPoMut.error instanceof Error ? createPoMut.error.message : 'Failed to create PO.'}
                </p>
              )}
            </div>

            {/* Modal footer */}
            <div className="px-6 py-4 border-t border-slate-100 flex justify-end gap-3">
              <button
                onClick={() => setShowPoModal(false)}
                className="px-4 py-2 text-sm border border-slate-200 rounded-lg hover:bg-slate-50 text-slate-600 transition"
              >
                Cancel
              </button>
              <button
                onClick={submitPo}
                disabled={!poWarehouseId || !poSupplierId || createPoMut.isPending}
                className="px-5 py-2 text-sm bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white font-semibold rounded-lg shadow-sm transition flex items-center gap-2"
              >
                {createPoMut.isPending ? (
                  <><RefreshCw size={13} className="animate-spin" /> Creating…</>
                ) : (
                  <><ShoppingCart size={13} /> Create PO ({selectedAlerts.length} items)</>
                )}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
