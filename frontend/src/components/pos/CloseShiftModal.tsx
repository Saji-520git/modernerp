import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, X } from 'lucide-react';
import { shiftsApi, formatShiftDuration, type PosShift } from '../../services/shifts';

function formatMoney(cents: number): string {
  return `Rs. ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface Props {
  shift:          PosShift;
  onClose:        () => void;
  onShiftClosed:  () => void;
}

export default function CloseShiftModal({ shift, onClose, onShiftClosed }: Props) {
  const [actualCash, setActualCash] = useState('');
  const [note, setNote]             = useState('');
  const [error, setError]           = useState<string | null>(null);
  const qc = useQueryClient();

  const actualCents    = Math.round((parseFloat(actualCash) || 0) * 100);
  const expectedCents  = shift.openingCashCents + shift.cashSalesCents;
  const varianceCents  = actualCash !== '' ? actualCents - expectedCents : null;

  const mutation = useMutation({
    mutationFn: () =>
      shiftsApi.close({
        shiftId:      shift.id,
        closingCash:  parseFloat(actualCash) || 0,
        note:         note.trim() || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ['current-shift'] });
      qc.invalidateQueries({ queryKey: ['shifts'] });
      onShiftClosed();
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message ?? 'Failed to close shift. Please try again.');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  };

  const varColor =
    varianceCents === null ? ''
    : varianceCents >= 0   ? 'text-emerald-600'
    : 'text-red-600';

  const varLabel =
    varianceCents === null ? '—'
    : varianceCents === 0  ? '✓ Cash balanced'
    : varianceCents > 0    ? `▲ ${formatMoney(varianceCents)} over`
    : `▼ ${formatMoney(Math.abs(varianceCents))} short`;

  const openedTime  = new Date(shift.openedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  const duration    = formatShiftDuration(shift.openedAt, null);

  const payRows = [
    { label: 'Cash sales',    value: shift.cashSalesCents },
    { label: 'Card sales',    value: shift.cardSalesCents },
    { label: 'QR Pay',        value: shift.qrPayCents },
    { label: 'Bank Transfer', value: shift.bankTransferCents },
    { label: 'Credit sales',  value: shift.creditSalesCents },
  ];

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Close Shift</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Started {openedTime} · {duration} · {shift.saleCount} sale{shift.saleCount !== 1 ? 's' : ''}
            </p>
          </div>
          <button onClick={onClose} className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500">
            <X size={16} />
          </button>
        </div>

        <form onSubmit={handleSubmit} className="p-6 space-y-5">
          {/* Section 1 — Shift Summary */}
          <div className="bg-slate-50 rounded-xl p-4 space-y-1.5 text-sm">
            <div className="flex justify-between">
              <span className="text-slate-500">Total Sales</span>
              <span className="font-semibold text-slate-800">{formatMoney(shift.totalSalesCents)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Transactions</span>
              <span className="font-semibold text-slate-800">{shift.saleCount}</span>
            </div>
          </div>

          {/* Section 2 — Sales by payment method */}
          <div>
            <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2">
              Sales Breakdown
            </p>
            <div className="border border-slate-200 rounded-xl overflow-hidden">
              {payRows.map((row) => (
                <div key={row.label} className="flex justify-between px-4 py-2.5 text-sm border-b border-slate-100 last:border-0">
                  <span className="text-slate-600">{row.label}</span>
                  <span className="font-medium text-slate-800">{formatMoney(row.value)}</span>
                </div>
              ))}
              <div className="flex justify-between px-4 py-2.5 bg-slate-50 text-sm font-semibold">
                <span className="text-slate-700">Total Sales</span>
                <span className="text-slate-800">{formatMoney(shift.totalSalesCents)}</span>
              </div>
            </div>
          </div>

          {/* Expected cash */}
          <div className="bg-indigo-50 border border-indigo-100 rounded-xl px-4 py-3 text-sm space-y-1">
            <p className="text-xs font-semibold text-indigo-700 uppercase tracking-wide mb-2">
              Expected Cash in Drawer
            </p>
            <div className="flex justify-between text-slate-600">
              <span>Opening Float</span>
              <span>{formatMoney(shift.openingCashCents)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>+ Cash Sales</span>
              <span>{formatMoney(shift.cashSalesCents)}</span>
            </div>
            <div className="flex justify-between font-bold text-slate-800 border-t border-indigo-200 pt-1.5 mt-1">
              <span>Expected</span>
              <span>{formatMoney(expectedCents)}</span>
            </div>
          </div>

          {/* Section 3 — Actual cash input */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
              Actual Cash Counted (Rs.)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={actualCash}
              onChange={(e) => setActualCash(e.target.value)}
              onFocus={(e) => e.target.select()}
              placeholder="0.00"
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-right font-mono text-lg"
              autoFocus
            />
            {/* Live variance preview */}
            {actualCash !== '' && (
              <p className={`mt-1.5 text-sm font-semibold ${varColor}`}>{varLabel}</p>
            )}
          </div>

          {/* Note */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
              Note (optional)
            </label>
            <textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder="Add a note about this shift…"
              className="w-full px-3 py-2 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 resize-none"
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Actions */}
          <div className="flex gap-3 pt-1">
            <button
              type="button"
              onClick={onClose}
              className="flex-1 py-2.5 rounded-xl border border-slate-200 text-sm font-medium text-slate-600 hover:bg-slate-50 transition"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={mutation.isPending || actualCash === ''}
              className="flex-1 py-2.5 rounded-xl bg-red-600 hover:bg-red-700 text-white font-semibold text-sm transition disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {mutation.isPending ? 'Closing…' : 'Close Shift'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
