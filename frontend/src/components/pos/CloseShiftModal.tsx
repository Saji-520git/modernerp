import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertCircle, X } from 'lucide-react';
import { shiftsApi, formatShiftDuration, type PosShift } from '../../services/shifts';

function formatMoney(cents: number): string {
  return `Rs. ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

interface Props {
  shift:          PosShift;
  onClose:        () => void;
  // Receives the CLOSED shift so the caller can show what was just settled —
  // expected, counted, variance — instead of a toast that vanishes.
  onShiftClosed:  (closed: PosShift) => void;
}

export default function CloseShiftModal({ shift, onClose, onShiftClosed }: Props) {
  const [actualCash, setActualCash] = useState('');
  const [note, setNote]             = useState('');
  const [error, setError]           = useState<string | null>(null);
  const qc = useQueryClient();

  // Every figure below comes from the server. This dialog used to compute
  // expected cash as `openingCashCents + shift.cashSalesCents`, which was wrong
  // twice over: it is the old formula, blind to split cash, credit settlements
  // and refunds; and the per-method columns are only written AT close, so on an
  // OPEN shift they are all zero. The cashier was shown a breakdown of zeros and
  // told to expect only the opening float, so an honest count always looked like
  // a large surplus.
  const { data: preview, isLoading: previewLoading, isError: previewError } = useQuery({
    queryKey: ['shift-preview', shift.id],
    queryFn:  () => shiftsApi.preview(shift.id),
    // The drawer is being counted right now; a stale figure is worse than none.
    staleTime: 0,
  });

  const actualCents   = Math.round((parseFloat(actualCash) || 0) * 100);
  const expectedCents = preview?.expectedCashCents ?? null;
  const varianceCents = actualCash !== '' && expectedCents !== null
    ? actualCents - expectedCents
    : null;

  const mutation = useMutation({
    mutationFn: () =>
      shiftsApi.close({
        shiftId:      shift.id,
        closingCash:  parseFloat(actualCash) || 0,
        note:         note.trim() || undefined,
      }),
    onSuccess: (closed) => {
      qc.invalidateQueries({ queryKey: ['current-shift'] });
      qc.invalidateQueries({ queryKey: ['shifts'] });
      onShiftClosed(closed);
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
    { label: 'Cash sales',    value: preview?.cashSalesCents    ?? 0 },
    { label: 'Card sales',    value: preview?.cardSalesCents    ?? 0 },
    { label: 'QR Pay',        value: preview?.qrPayCents        ?? 0 },
    { label: 'Bank Transfer', value: preview?.bankTransferCents ?? 0 },
    { label: 'Credit sales',  value: preview?.creditSalesCents  ?? 0 },
  ];

  // The movements that are not plain cash sales but still change the drawer.
  // Shown only when non-zero, so an ordinary shift's dialog stays as short as
  // it is today — but a cashier who took a split payment or gave a refund can
  // see exactly why the expected figure is what it is.
  const cashMovementRows = [
    { label: '+ Cash on split payments', value: preview?.splitCashCents       ?? 0 },
    { label: '+ Credit settled in cash', value: preview?.cashSettlementsCents ?? 0 },
    { label: '− Cash refunds paid out',  value: -(preview?.cashRefundsCents   ?? 0) },
  ].filter(r => r.value !== 0);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="text-lg font-bold text-slate-800">Close Shift</h2>
            <p className="text-xs text-slate-500 mt-0.5">
              Started {openedTime} · {duration} · {preview?.saleCount ?? shift.saleCount} sale{(preview?.saleCount ?? shift.saleCount) !== 1 ? 's' : ''}
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
              <span className="font-semibold text-slate-800">{formatMoney(preview?.totalSalesCents ?? shift.totalSalesCents)}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-slate-500">Transactions</span>
              <span className="font-semibold text-slate-800">{preview?.saleCount ?? shift.saleCount}</span>
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
                <span className="text-slate-800">{formatMoney(preview?.totalSalesCents ?? 0)}</span>
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
              <span>{formatMoney(preview?.openingCashCents ?? shift.openingCashCents)}</span>
            </div>
            <div className="flex justify-between text-slate-600">
              <span>+ Cash Sales</span>
              <span>{formatMoney(preview?.cashSalesCents ?? 0)}</span>
            </div>
            {cashMovementRows.map((row) => (
              <div key={row.label} className="flex justify-between text-slate-600">
                <span>{row.label}</span>
                <span>{formatMoney(Math.abs(row.value))}</span>
              </div>
            ))}
            <div className="flex justify-between font-bold text-slate-800 border-t border-indigo-200 pt-1.5 mt-1">
              <span>Expected</span>
              <span>
                {previewLoading ? 'Calculating…'
                  : previewError || expectedCents === null ? 'Unavailable'
                  : formatMoney(expectedCents)}
              </span>
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
              // Not while the expected figure is still resolving — closing is
              // committed and irreversible, and a cashier should see what they
              // are being measured against before they commit to a count. A
              // failed preview does NOT block: the server recomputes expected
              // cash at close regardless, and trapping the cashier would be
              // worse than closing without the on-screen figure.
              disabled={mutation.isPending || actualCash === '' || previewLoading}
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
