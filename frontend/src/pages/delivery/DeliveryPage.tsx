import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  Plus, Search, Truck, Clock, CheckCircle, TrendingUp, RefreshCw,
  X, Edit, AlertCircle, MapPin, Phone, User,
} from 'lucide-react';
import { deliveryService } from '../../services/deliveryService';
import DeliveryFormModal from './DeliveryFormModal';
import {
  DELIVERY_STATUS_COLORS, type Delivery, type DeliveryStatus, type DeliveryStats,
} from '../../types/delivery';

const STATUS_OPTIONS: (DeliveryStatus | 'ALL')[] = [
  'ALL', 'PENDING', 'ASSIGNED', 'OUT_FOR_DELIVERY', 'DELIVERED', 'FAILED', 'CANCELLED',
];

const NEXT_STATUSES: Record<DeliveryStatus, DeliveryStatus[]> = {
  PENDING:          ['ASSIGNED', 'CANCELLED'],
  ASSIGNED:         ['OUT_FOR_DELIVERY', 'CANCELLED'],
  OUT_FOR_DELIVERY: ['DELIVERED', 'FAILED'],
  DELIVERED:        [],
  FAILED:           [],
  CANCELLED:        [],
};

const LOCKED: DeliveryStatus[] = ['DELIVERED', 'FAILED', 'CANCELLED'];

const statusLabel = (s: string) =>
  s.split('_').map((w) => w.charAt(0) + w.slice(1).toLowerCase()).join(' ');

// ─── Detail / status modal ──────────────────────────────────────────────────

function DeliveryDetailModal({ deliveryId, onClose, onEdit }: {
  deliveryId: string; onClose: () => void; onEdit: (d: Delivery) => void;
}) {
  const queryClient = useQueryClient();
  const [error, setError] = useState<string | null>(null);

  const { data: d, isLoading } = useQuery<Delivery>({
    queryKey: ['delivery', deliveryId],
    queryFn: () => deliveryService.get(deliveryId),
  });

  const statusMut = useMutation({
    mutationFn: (status: DeliveryStatus) => deliveryService.setStatus(deliveryId, status),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['delivery', deliveryId] });
      queryClient.invalidateQueries({ queryKey: ['deliveries'] });
      queryClient.invalidateQueries({ queryKey: ['delivery-stats'] });
    },
    onError: (err: any) => { setError(err?.response?.data?.message ?? 'Action failed'); setTimeout(() => setError(null), 4000); },
  });

  if (isLoading || !d) {
    return (
      <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
        <div className="bg-white rounded-xl p-8"><div className="w-6 h-6 border-2 border-indigo-200 border-t-indigo-600 rounded-full animate-spin mx-auto" /></div>
      </div>
    );
  }

  const nexts = NEXT_STATUSES[d.status];
  const locked = LOCKED.includes(d.status);

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <div className="flex items-center gap-3">
            <div className="p-2 rounded-lg bg-indigo-50"><Truck className="w-4 h-4 text-indigo-600" /></div>
            <div>
              <h2 className="font-bold text-slate-800">{d.number}</h2>
              <p className="text-xs text-slate-400">{new Date(d.createdAt).toLocaleDateString('en-GB')}</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <span className={`text-xs font-semibold px-2.5 py-1 rounded-full ${DELIVERY_STATUS_COLORS[d.status]}`}>{statusLabel(d.status)}</span>
            <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-500" /></button>
          </div>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4 text-sm">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}
            </div>
          )}

          <div className="flex items-start gap-2 text-slate-700">
            <MapPin className="w-4 h-4 mt-0.5 text-slate-400 shrink-0" />
            <span className="whitespace-pre-wrap">{d.address}</span>
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div><p className="text-xs text-slate-400 mb-0.5">Customer</p><p className="font-medium text-slate-800">{d.customer?.name ?? '—'}</p></div>
            <div><p className="text-xs text-slate-400 mb-0.5">Scheduled</p><p className="font-medium text-slate-800">{d.scheduledAt ? new Date(d.scheduledAt).toLocaleString('en-GB') : '—'}</p></div>
            <div className="flex items-center gap-1.5"><User className="w-3.5 h-3.5 text-slate-400" /><span>{d.contactName ?? '—'}</span></div>
            <div className="flex items-center gap-1.5"><Phone className="w-3.5 h-3.5 text-slate-400" /><span>{d.contactPhone ?? '—'}</span></div>
            <div><p className="text-xs text-slate-400 mb-0.5">Driver</p><p className="font-medium text-slate-800">{d.driverName ?? '—'}{d.driverPhone ? ` · ${d.driverPhone}` : ''}</p></div>
            <div><p className="text-xs text-slate-400 mb-0.5">Delivered At</p><p className="font-medium text-slate-800">{d.deliveredAt ? new Date(d.deliveredAt).toLocaleString('en-GB') : '—'}</p></div>
          </div>

          {(d.sale || d.quotation) && (
            <div className="flex gap-4 text-xs text-slate-500">
              {d.sale && <span>Sale: <strong className="text-slate-700">{d.sale.number}</strong></span>}
              {d.quotation && <span>Quote: <strong className="text-slate-700">{d.quotation.number}</strong></span>}
            </div>
          )}

          {d.note && <div><p className="text-xs text-slate-400 mb-0.5">Note</p><p className="text-slate-700">{d.note}</p></div>}
        </div>

        <div className="px-6 py-4 border-t flex flex-wrap gap-2">
          {!locked && (
            <button onClick={() => onEdit(d)}
              className="flex items-center gap-1.5 px-4 py-2 border border-slate-200 text-slate-600 rounded-lg text-sm hover:bg-slate-50 transition">
              <Edit className="w-4 h-4" /> Edit
            </button>
          )}
          {nexts.map((s) => (
            <button key={s} onClick={() => statusMut.mutate(s)} disabled={statusMut.isPending}
              className={`flex items-center gap-1.5 px-4 py-2 rounded-lg text-sm font-semibold transition disabled:opacity-60 ${
                s === 'DELIVERED' ? 'bg-green-600 text-white hover:bg-green-700'
                : s === 'FAILED' || s === 'CANCELLED' ? 'border border-red-200 text-red-600 hover:bg-red-50'
                : 'bg-indigo-600 text-white hover:bg-indigo-700'
              }`}>
              {statusLabel(s)}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── Main page ───────────────────────────────────────────────────────────────

export default function DeliveryPage() {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<DeliveryStatus | 'ALL'>('ALL');
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Delivery | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const { data: stats } = useQuery<DeliveryStats>({
    queryKey: ['delivery-stats'],
    queryFn: () => deliveryService.stats(),
  });

  const { data: deliveries = [], isLoading } = useQuery<Delivery[]>({
    queryKey: ['deliveries', status, search],
    queryFn: () => deliveryService.list({
      status: status === 'ALL' ? undefined : status,
      search: search || undefined,
    }),
  });

  const openCreate = () => { setEditing(null); setShowForm(true); };
  const openEdit = (d: Delivery) => { setSelectedId(null); setEditing(d); setShowForm(true); };

  return (
    <div className="p-6 space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-slate-800 flex items-center gap-2">
            <Truck className="w-5 h-5 text-indigo-600" /> Deliveries
          </h1>
          <p className="text-sm text-slate-400 mt-0.5">Track and dispatch customer deliveries</p>
        </div>
        <button onClick={openCreate}
          className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 transition">
          <Plus className="w-4 h-4" /> New Delivery
        </button>
      </div>

      {/* Stats */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-medium"><Clock className="w-4 h-4" /> Pending Today</div>
            <p className="text-2xl font-bold text-slate-800 mt-1">{stats.today.pending}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-medium"><Truck className="w-4 h-4" /> Out for Delivery</div>
            <p className="text-2xl font-bold text-amber-600 mt-1">{stats.today.outForDelivery}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-medium"><CheckCircle className="w-4 h-4" /> Delivered (Week)</div>
            <p className="text-2xl font-bold text-green-600 mt-1">{stats.thisWeek.delivered}</p>
          </div>
          <div className="bg-white rounded-xl border border-slate-200 p-4">
            <div className="flex items-center gap-2 text-slate-400 text-xs font-medium"><TrendingUp className="w-4 h-4" /> On-Time Rate</div>
            <p className="text-2xl font-bold text-indigo-600 mt-1">{stats.onTimeRate}%</p>
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="flex items-center gap-3 flex-wrap">
        <div className="relative flex-1 min-w-[220px]">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input value={search} onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by number, address or customer…"
            className="w-full pl-9 pr-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
        </div>
        <div className="flex gap-1.5 flex-wrap">
          {STATUS_OPTIONS.map((s) => (
            <button key={s} onClick={() => setStatus(s)}
              className={`px-3 py-1.5 rounded-lg text-xs font-medium border transition ${
                status === s ? 'bg-indigo-600 border-indigo-600 text-white' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
              }`}>
              {s === 'ALL' ? 'All' : statusLabel(s)}
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
        ) : deliveries.length === 0 ? (
          <div className="text-center py-12 text-slate-400">
            <Truck className="w-10 h-10 mx-auto text-slate-200 mb-2" />
            <p className="text-sm">No deliveries found</p>
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-slate-50">
              <tr>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Number</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Customer</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Address</th>
                <th className="px-4 py-3 text-center text-xs font-semibold text-slate-500">Status</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Driver</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500">Scheduled</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {deliveries.map((d) => (
                <tr key={d.id} onClick={() => setSelectedId(d.id)} className="hover:bg-slate-50 cursor-pointer">
                  <td className="px-4 py-3 font-mono font-semibold text-indigo-600">{d.number}</td>
                  <td className="px-4 py-3 text-slate-700">{d.customer?.name ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-500 max-w-[220px] truncate">{d.address}</td>
                  <td className="px-4 py-3 text-center">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${DELIVERY_STATUS_COLORS[d.status]}`}>{statusLabel(d.status)}</span>
                  </td>
                  <td className="px-4 py-3 text-slate-500">{d.driverName ?? '—'}</td>
                  <td className="px-4 py-3 text-slate-400 text-xs">{d.scheduledAt ? new Date(d.scheduledAt).toLocaleDateString('en-GB') : '—'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {selectedId && (
        <DeliveryDetailModal deliveryId={selectedId} onClose={() => setSelectedId(null)} onEdit={openEdit} />
      )}
      {showForm && (
        <DeliveryFormModal
          delivery={editing ?? undefined}
          onClose={() => { setShowForm(false); setEditing(null); }}
        />
      )}
    </div>
  );
}
