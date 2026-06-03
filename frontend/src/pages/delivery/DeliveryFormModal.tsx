import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { X, Truck, AlertCircle } from 'lucide-react';
import { deliveryService } from '../../services/deliveryService';
import type { Delivery, CreateDeliveryDto, UpdateDeliveryDto } from '../../types/delivery';

export interface DeliveryPrefill {
  saleId?: string | null;
  quotationId?: string | null;
  customerId?: string | null;
  address?: string;
  contactName?: string | null;
  contactPhone?: string | null;
}

interface Props {
  /** When provided, the modal edits an existing delivery. */
  delivery?: Delivery;
  /** When creating, pre-fill linked references and contact details. */
  prefill?: DeliveryPrefill;
  onClose: () => void;
  onSaved?: (d: Delivery) => void;
}

export default function DeliveryFormModal({ delivery, prefill, onClose, onSaved }: Props) {
  const isEdit = !!delivery;
  const queryClient = useQueryClient();
  const src = delivery ?? prefill;

  const [address, setAddress] = useState(src?.address ?? '');
  const [scheduledAt, setScheduledAt] = useState(
    delivery?.scheduledAt ? delivery.scheduledAt.slice(0, 16) : '',
  );
  const [contactName, setContactName] = useState(src?.contactName ?? '');
  const [contactPhone, setContactPhone] = useState(src?.contactPhone ?? '');
  const [driverName, setDriverName] = useState(delivery?.driverName ?? '');
  const [driverPhone, setDriverPhone] = useState(delivery?.driverPhone ?? '');
  const [note, setNote] = useState(delivery?.note ?? '');
  const [error, setError] = useState('');

  const invalidate = () => {
    queryClient.invalidateQueries({ queryKey: ['deliveries'] });
    queryClient.invalidateQueries({ queryKey: ['delivery-stats'] });
  };

  const createMut = useMutation({
    mutationFn: () => {
      const payload: CreateDeliveryDto = {
        saleId: prefill?.saleId ?? null,
        quotationId: prefill?.quotationId ?? null,
        customerId: prefill?.customerId ?? null,
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        address: address.trim(),
        contactName: contactName || null,
        contactPhone: contactPhone || null,
        driverName: driverName || null,
        driverPhone: driverPhone || null,
        note: note || null,
      };
      return deliveryService.create(payload);
    },
    onSuccess: (d) => { invalidate(); onSaved?.(d); onClose(); },
    onError: (err: any) => setError(err?.response?.data?.message ?? 'Failed to create delivery'),
  });

  const updateMut = useMutation({
    mutationFn: () => {
      const payload: UpdateDeliveryDto = {
        scheduledAt: scheduledAt ? new Date(scheduledAt).toISOString() : null,
        address: address.trim(),
        contactName: contactName || null,
        contactPhone: contactPhone || null,
        driverName: driverName || null,
        driverPhone: driverPhone || null,
        note: note || null,
      };
      return deliveryService.update(delivery!.id, payload);
    },
    onSuccess: (d) => { invalidate(); onSaved?.(d); onClose(); },
    onError: (err: any) => setError(err?.response?.data?.message ?? 'Failed to update delivery'),
  });

  const mutation = isEdit ? updateMut : createMut;
  const canSubmit = address.trim().length > 0;

  return (
    <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[90vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="font-bold text-slate-800 flex items-center gap-2">
            <Truck className="w-5 h-5 text-indigo-600" />
            {isEdit ? `Edit Delivery — ${delivery!.number}` : 'New Delivery'}
          </h2>
          <button onClick={onClose} className="p-1.5 hover:bg-slate-100 rounded-lg"><X className="w-5 h-5 text-slate-500" /></button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-5 space-y-4">
          {error && (
            <div className="p-3 bg-red-50 border border-red-200 text-red-700 rounded-lg text-sm flex gap-2">
              <AlertCircle className="w-4 h-4 mt-0.5 shrink-0" />{error}
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Delivery Address *</label>
            <textarea value={address} onChange={(e) => setAddress(e.target.value)} rows={2} placeholder="Full delivery address…"
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
          </div>

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Scheduled At</label>
              <input type="datetime-local" value={scheduledAt} onChange={(e) => setScheduledAt(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Contact Name</label>
              <input value={contactName} onChange={(e) => setContactName(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Contact Phone</label>
              <input value={contactPhone} onChange={(e) => setContactPhone(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Driver Name</label>
              <input value={driverName} onChange={(e) => setDriverName(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Driver Phone</label>
              <input value={driverPhone} onChange={(e) => setDriverPhone(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Note</label>
              <input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Optional…"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400" />
            </div>
          </div>
        </div>

        <div className="px-6 py-4 border-t flex gap-3 justify-end">
          <button onClick={onClose} className="px-4 py-2 border border-slate-200 rounded-lg text-sm text-slate-600 hover:bg-slate-50">Cancel</button>
          <button onClick={() => { setError(''); mutation.mutate(); }} disabled={!canSubmit || mutation.isPending}
            className="px-6 py-2 bg-indigo-600 text-white rounded-lg text-sm font-semibold hover:bg-indigo-700 disabled:opacity-60 transition">
            {mutation.isPending ? 'Saving…' : isEdit ? 'Update Delivery' : 'Create Delivery'}
          </button>
        </div>
      </div>
    </div>
  );
}
