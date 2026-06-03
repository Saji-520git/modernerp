import { useMemo, useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Search, Factory, X, RefreshCw, Play, CheckCircle, Ban,
  Clock, Loader2, DollarSign, AlertTriangle,
} from 'lucide-react';
import { manufacturingService } from '../../services/manufacturingService';
import { productsApi } from '../../services/products';
import { warehousesApi } from '../../services/warehouses';
import type {
  ProductionOrder, ProductionStatus, ProductionStats, CreateProductionOrderDto,
  StockWarning,
} from '../../types/manufacturing';

const money = (cents: number) => `Rs. ${(cents / 100).toFixed(2)}`;

const STATUS_OPTIONS: (ProductionStatus | 'ALL')[] = [
  'ALL', 'PENDING', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED',
];

const STATUS_COLORS: Record<ProductionStatus, string> = {
  PENDING: 'bg-amber-100 text-amber-700',
  IN_PROGRESS: 'bg-blue-100 text-blue-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

const STATUS_LABEL: Record<ProductionStatus, string> = {
  PENDING: 'Pending',
  IN_PROGRESS: 'In Progress',
  COMPLETED: 'Completed',
  CANCELLED: 'Cancelled',
};

export default function ProductionPage() {
  const qc = useQueryClient();
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<ProductionStatus | 'ALL'>('ALL');
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState({ productId: '', warehouseId: '', quantity: 1, notes: '' });

  const { data: stats } = useQuery<ProductionStats>({
    queryKey: ['production-stats'],
    queryFn: () => manufacturingService.productionStats(),
  });

  const { data: orders = [], isLoading } = useQuery<ProductionOrder[]>({
    queryKey: ['production-orders', status, search],
    queryFn: () => manufacturingService.listOrders({
      status: status === 'ALL' ? undefined : status,
      search: search || undefined,
    }),
  });

  // BOMs limit which products can be produced. Warehouses populate the source.
  const { data: boms = [] } = useQuery({
    queryKey: ['boms'],
    queryFn: () => manufacturingService.listBOMs(),
  });
  const { data: productResp } = useQuery({
    queryKey: ['products-for-bom'],
    queryFn: () => productsApi.list({ pageSize: 1000, isActive: 'true' }),
  });
  const { data: whResp } = useQuery({
    queryKey: ['warehouses-for-production'],
    queryFn: () => warehousesApi.list({ pageSize: 1000, isActive: true }),
  });

  const productById = useMemo(() => {
    const m = new Map<string, { id: string; name: string; sku: string }>();
    (productResp?.data ?? []).forEach((p) => m.set(p.id, p));
    return m;
  }, [productResp]);

  // Available aggregate stock per (materialId @ warehouseId), from the product list.
  const stockByKey = useMemo(() => {
    const m = new Map<string, number>();
    (productResp?.data ?? []).forEach((p) => {
      p.stock.forEach((s) => m.set(`${p.id}@${s.warehouseId}`, Number(s.qty)));
    });
    return m;
  }, [productResp]);

  // Start-confirmation flow: load full order (lines) and compare to stock.
  const [startTarget, setStartTarget] = useState<ProductionOrder | null>(null);
  const { data: startDetail } = useQuery<ProductionOrder>({
    queryKey: ['production-order-detail', startTarget?.id],
    queryFn: () => manufacturingService.getOrder(startTarget!.id),
    enabled: !!startTarget,
  });

  const startWarnings: StockWarning[] = useMemo(() => {
    if (!startDetail) return [];
    return startDetail.lines.map((l) => {
      const required = Number(l.plannedQty);
      const available = stockByKey.get(`${l.materialId}@${startDetail.warehouseId}`) ?? 0;
      return {
        materialId: l.materialId,
        materialName: l.material?.name ?? l.materialId,
        required,
        available,
        unitLabel: 'units',
        sufficient: available >= required,
      };
    });
  }, [startDetail, stockByKey]);

  const hasShortage = startWarnings.some((w) => !w.sufficient);

  // Only products that have a BOM can be produced.
  const producibleProducts = useMemo(
    () => boms.map((b) => ({ id: b.productId, name: b.product.name, sku: b.product.sku })),
    [boms],
  );
  const warehouses = whResp?.items ?? [];

  const createMutation = useMutation({
    mutationFn: (dto: CreateProductionOrderDto) => manufacturingService.createOrder(dto),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      qc.invalidateQueries({ queryKey: ['production-stats'] });
      setShowForm(false);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      setError(msg ?? 'Failed to create order');
    },
  });

  const actionMutation = useMutation({
    mutationFn: ({ id, action }: { id: string; action: 'start' | 'complete' | 'cancel' }) => {
      if (action === 'start') return manufacturingService.startOrder(id);
      if (action === 'complete') return manufacturingService.completeOrder(id);
      return manufacturingService.cancelOrder(id);
    },
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['production-orders'] });
      qc.invalidateQueries({ queryKey: ['production-stats'] });
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { error?: string } } })?.response?.data?.error;
      alert(msg ?? 'Action failed');
    },
  });

  const openNew = () => {
    setForm({ productId: '', warehouseId: warehouses[0]?.id ?? '', quantity: 1, notes: '' });
    setError(null);
    setShowForm(true);
  };

  const submit = () => {
    setError(null);
    if (!form.productId) return setError('Select a product to produce');
    if (!form.warehouseId) return setError('Select a warehouse');
    if (form.quantity <= 0) return setError('Quantity must be greater than zero');
    createMutation.mutate({
      productId: form.productId,
      warehouseId: form.warehouseId,
      quantity: form.quantity,
      notes: form.notes.trim() || null,
    });
  };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Factory className="w-5 h-5 text-indigo-600" /> Production Orders
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">Manufacture finished goods from your BOMs</p>
        </div>
        <button onClick={openNew}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition">
          <Plus className="w-4 h-4" /> New Order
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-medium"><Clock className="w-4 h-4" /> Pending</div>
            <p className="text-2xl font-bold text-amber-600 mt-1">{stats.pending}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-medium"><Loader2 className="w-4 h-4" /> In Progress</div>
            <p className="text-2xl font-bold text-blue-600 mt-1">{stats.inProgress}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-medium"><CheckCircle className="w-4 h-4" /> Completed</div>
            <p className="text-2xl font-bold text-green-600 mt-1">{stats.completed}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-medium"><DollarSign className="w-4 h-4" /> Produced Value</div>
            <p className="text-2xl font-bold text-slate-800 mt-1">{money(stats.completedCostCents)}</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by number or product…"
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_OPTIONS.map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                status === s ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}>
              {s === 'ALL' ? 'All' : STATUS_LABEL[s]}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl border border-slate-200 overflow-hidden">
        {isLoading ? (
          <div className="flex items-center justify-center gap-2 py-12 text-slate-400 text-sm">
            <RefreshCw className="w-4 h-4 animate-spin" /> Loading…
          </div>
        ) : orders.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <Factory className="w-10 h-10 mx-auto text-slate-200 mb-2" />
            <p className="text-sm">No production orders found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Number</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Product</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Warehouse</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500">Qty</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500">Status</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">Material Cost</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Created</th>
                <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {orders.map((o) => (
                <tr key={o.id} className="hover:bg-slate-50">
                  <td className="px-4 py-3 font-mono font-semibold text-indigo-600">{o.number}</td>
                  <td className="px-4 py-3 text-slate-700">{o.product?.name ?? productById.get(o.productId)?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500">{o.warehouse?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-center text-slate-600">{Number(o.quantity)}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[o.status]}`}>
                      {STATUS_LABEL[o.status]}
                    </span>
                  </td>
                  <td className="px-4 py-3 text-right font-semibold text-slate-800">{money(o.totalCostCents)}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{new Date(o.createdAt).toLocaleDateString('en-GB')}</td>
                  <td className="px-4 py-3 text-right">
                    <div className="flex items-center justify-end gap-1">
                      {o.status === 'PENDING' && (
                        <button onClick={() => setStartTarget(o)}
                          className="flex items-center gap-1 px-2 py-1 text-xs font-semibold text-blue-600 hover:bg-blue-50 rounded">
                          <Play className="w-3.5 h-3.5" /> Start
                        </button>
                      )}
                      {o.status === 'IN_PROGRESS' && (
                        <button onClick={() => actionMutation.mutate({ id: o.id, action: 'complete' })}
                          className="flex items-center gap-1 px-2 py-1 text-xs font-semibold text-green-600 hover:bg-green-50 rounded">
                          <CheckCircle className="w-3.5 h-3.5" /> Complete
                        </button>
                      )}
                      {(o.status === 'PENDING' || o.status === 'IN_PROGRESS') && (
                        <button onClick={() => { if (confirm(`Cancel order ${o.number}?`)) actionMutation.mutate({ id: o.id, action: 'cancel' }); }}
                          className="flex items-center gap-1 px-2 py-1 text-xs font-semibold text-slate-500 hover:bg-slate-100 rounded">
                          <Ban className="w-3.5 h-3.5" /> Cancel
                        </button>
                      )}
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
          <div className="bg-white rounded-xl w-full max-w-md">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="font-bold text-slate-800">New Production Order</h2>
              <button onClick={() => setShowForm(false)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              {error && (
                <div className="bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">{error}</div>
              )}
              {producibleProducts.length === 0 && (
                <div className="bg-amber-50 border border-amber-200 text-amber-700 text-sm px-3 py-2 rounded-lg">
                  No products have a BOM yet. Create a BOM first.
                </div>
              )}
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Product to Produce</label>
                <select value={form.productId}
                  onChange={(e) => setForm((f) => ({ ...f, productId: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                  <option value="">Select product…</option>
                  {producibleProducts.map((p) => (
                    <option key={p.id} value={p.id}>{p.name} ({p.sku})</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Warehouse</label>
                <select value={form.warehouseId}
                  onChange={(e) => setForm((f) => ({ ...f, warehouseId: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm">
                  <option value="">Select warehouse…</option>
                  {warehouses.map((w) => (
                    <option key={w.id} value={w.id}>{w.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Quantity to Produce</label>
                <input type="number" min={0} step="any" value={form.quantity}
                  onChange={(e) => setForm((f) => ({ ...f, quantity: parseFloat(e.target.value) || 0 }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm" />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-500 mb-1">Notes</label>
                <textarea value={form.notes} rows={2}
                  onChange={(e) => setForm((f) => ({ ...f, notes: e.target.value }))}
                  className="w-full px-3 py-2 border border-slate-200 rounded-lg text-sm resize-none" />
              </div>
              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setShowForm(false)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm font-semibold hover:bg-slate-50">
                  Cancel
                </button>
                <button onClick={submit} disabled={createMutation.isPending || producibleProducts.length === 0}
                  className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-50">
                  {createMutation.isPending ? 'Creating…' : 'Create Order'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Start-confirmation modal — stock check preview */}
      {startTarget && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-xl w-full max-w-lg">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100">
              <h2 className="font-bold text-slate-800 flex items-center gap-2">
                <Play className="w-4 h-4 text-blue-600" /> Start Order {startTarget.number}
              </h2>
              <button onClick={() => setStartTarget(null)} className="p-1 text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="p-6 space-y-4">
              <p className="text-sm text-slate-500">
                Starting this order will consume the following materials from{' '}
                <span className="font-semibold text-slate-700">{startTarget.warehouse?.name ?? 'the warehouse'}</span>.
              </p>

              {!startDetail ? (
                <div className="flex items-center justify-center gap-2 py-6 text-slate-400 text-sm">
                  <RefreshCw className="w-4 h-4 animate-spin" /> Checking stock…
                </div>
              ) : (
                <>
                  {hasShortage && (
                    <div className="flex items-start gap-2 bg-red-50 border border-red-200 text-red-700 text-sm px-3 py-2 rounded-lg">
                      <AlertTriangle className="w-4 h-4 mt-0.5 shrink-0" />
                      <span>Insufficient stock for one or more materials. Starting will fail until stock is available.</span>
                    </div>
                  )}
                  <div className="border border-slate-200 rounded-lg overflow-hidden">
                    <table className="w-full text-sm">
                      <thead className="bg-slate-50">
                        <tr>
                          <th className="px-3 py-2 text-left text-xs font-semibold text-slate-500">Material</th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Required</th>
                          <th className="px-3 py-2 text-right text-xs font-semibold text-slate-500">Available</th>
                          <th className="px-3 py-2 text-center text-xs font-semibold text-slate-500">Status</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100">
                        {startWarnings.map((w) => (
                          <tr key={w.materialId}>
                            <td className="px-3 py-2 text-slate-700">{w.materialName}</td>
                            <td className="px-3 py-2 text-right text-slate-600">{w.required.toFixed(2)}</td>
                            <td className={`px-3 py-2 text-right font-medium ${w.sufficient ? 'text-slate-600' : 'text-red-600'}`}>
                              {w.available.toFixed(2)}
                            </td>
                            <td className="px-3 py-2 text-center">
                              <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${
                                w.sufficient ? 'bg-green-100 text-green-700' : 'bg-red-100 text-red-700'
                              }`}>
                                {w.sufficient ? 'OK' : 'Short'}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </>
              )}

              <div className="flex justify-end gap-2 pt-2">
                <button onClick={() => setStartTarget(null)}
                  className="px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm font-semibold hover:bg-slate-50">
                  Cancel
                </button>
                <button
                  onClick={() => {
                    actionMutation.mutate({ id: startTarget.id, action: 'start' });
                    setStartTarget(null);
                  }}
                  disabled={!startDetail || actionMutation.isPending}
                  className="px-4 py-2 bg-blue-600 text-white rounded-lg text-sm font-semibold hover:bg-blue-700 disabled:opacity-50">
                  {hasShortage ? 'Start Anyway' : 'Confirm & Start'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
