import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { ShoppingCart, AlertCircle } from 'lucide-react';
import { shiftsApi, type PosShift } from '../../services/shifts';

interface Props {
  warehouseId:   string;
  warehouseName: string;
  onShiftOpened: (shift: PosShift) => void;
}

export default function OpenShiftModal({ warehouseId, warehouseName, onShiftOpened }: Props) {
  const [openingCash, setOpeningCash] = useState('0');
  const [error, setError]             = useState<string | null>(null);
  const qc = useQueryClient();

  const mutation = useMutation({
    mutationFn: () =>
      shiftsApi.open({ warehouseId, openingCash: parseFloat(openingCash) || 0 }),
    onSuccess: (shift) => {
      qc.invalidateQueries({ queryKey: ['current-shift', warehouseId] });
      onShiftOpened(shift);
    },
    onError: (err: any) => {
      setError(err?.response?.data?.message ?? 'Failed to open shift. Please try again.');
    },
  });

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    mutation.mutate();
  };

  return (
    // Full-screen overlay — cannot be dismissed
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/80 backdrop-blur-sm">
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm mx-4 p-8">
        {/* Logo / Icon */}
        <div className="flex flex-col items-center mb-6">
          <div className="w-14 h-14 bg-indigo-100 rounded-2xl flex items-center justify-center mb-3">
            <ShoppingCart size={26} className="text-indigo-600" />
          </div>
          <h2 className="text-xl font-bold text-slate-800">Open New Shift</h2>
          <p className="text-sm text-slate-500 mt-1 text-center">
            Enter your opening cash float to begin
          </p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-5">
          {/* Warehouse (read-only) */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
              Warehouse
            </label>
            <div className="px-3 py-2.5 rounded-lg bg-slate-50 border border-slate-200 text-sm text-slate-700 font-medium">
              {warehouseName}
            </div>
          </div>

          {/* Opening Cash Float */}
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
              Opening Cash Float (Rs.)
            </label>
            <input
              type="number"
              min="0"
              step="0.01"
              value={openingCash}
              onChange={(e) => setOpeningCash(e.target.value)}
              onFocus={(e) => e.target.select()}
              className="w-full px-3 py-2.5 rounded-lg border border-slate-200 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-500 text-right font-mono text-lg"
              autoFocus
            />
          </div>

          {/* Error */}
          {error && (
            <div className="flex items-start gap-2 text-red-600 bg-red-50 border border-red-200 rounded-lg px-3 py-2.5 text-sm">
              <AlertCircle size={15} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          {/* Submit */}
          <button
            type="submit"
            disabled={mutation.isPending}
            className="w-full py-3 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white font-semibold text-sm transition disabled:opacity-60 disabled:cursor-not-allowed"
          >
            {mutation.isPending ? 'Opening shift…' : 'Open Shift →'}
          </button>
        </form>
      </div>
    </div>
  );
}
