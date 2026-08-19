import { useEffect, useRef, useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { AlertCircle, Tag, X } from 'lucide-react';
import { posApi } from '../../services/pos';

interface Props {
  product: { id: string; name: string; sku?: string | null; unit?: { shortCode?: string | null; name?: string | null } | null };
  onCancel: () => void;
  /** Fires with the saved price so the caller can resume the sale. */
  onSaved: (priceCents: number) => void;
}

/**
 * Asked for when a product reaches the till with no sale price.
 *
 * The catalogue import brought in products without prices, and checkout resolves
 * a line straight to product.priceCents — so those would have rung up at Rs. 0
 * with nothing on screen to say so. Rather than block the sale, take the price
 * here, save it to the product, and carry on: the cashier is standing in front
 * of the customer and the shelf edge, which is exactly who knows the price.
 *
 * It fills a gap and never overrides. The server refuses a product that already
 * has a price, so this cannot be used to quietly rewrite the catalogue.
 */
export default function SetPriceModal({ product, onCancel, onSaved }: Props) {
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => { inputRef.current?.focus(); }, []);

  const save = useMutation({
    mutationFn: (priceCents: number) => posApi.setProductPrice(product.id, priceCents),
    onSuccess: (saved) => onSaved(saved.priceCents),
    onError: (e: unknown) => {
      const d = (e as { response?: { data?: { message?: string; error?: string } } })?.response?.data;
      setError(d?.message ?? d?.error ?? 'Could not save the price. Try again.');
    },
  });

  const submit = () => {
    const rupees = parseFloat(value.trim());
    if (!isFinite(rupees) || rupees <= 0) {
      setError('Enter a price greater than zero');
      inputRef.current?.focus();
      return;
    }
    setError(null);
    save.mutate(Math.round(rupees * 100));
  };

  const unitLabel = product.unit?.shortCode ?? product.unit?.name ?? 'unit';

  return (
    <div className="fixed inset-0 z-[70] flex items-center justify-center bg-slate-900/70 backdrop-blur-sm p-4"
      onClick={() => { if (!save.isPending) onCancel(); }}>
      <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
        <div className="flex items-start justify-between p-5 pb-3">
          <div className="flex items-center gap-2.5">
            <div className="w-9 h-9 rounded-lg bg-amber-100 flex items-center justify-center shrink-0">
              <Tag size={17} className="text-amber-600" />
            </div>
            <div>
              <h3 className="font-bold text-slate-800 leading-tight">No price set</h3>
              <p className="text-xs text-slate-500">This product cannot be sold until it has one.</p>
            </div>
          </div>
          <button type="button" onClick={onCancel} disabled={save.isPending}
            className="p-1.5 rounded-lg hover:bg-slate-100 text-slate-500 disabled:opacity-50">
            <X size={16} />
          </button>
        </div>

        <div className="px-5 pb-5">
          <div className="rounded-lg bg-slate-50 border border-slate-200 px-3 py-2 mb-4">
            <p className="text-sm font-semibold text-slate-800 leading-snug">{product.name}</p>
            {product.sku && <p className="text-[11px] text-slate-500 mt-0.5">{product.sku}</p>}
          </div>

          <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1">
            Selling price per {unitLabel}
          </label>
          <div className="relative">
            <span className="absolute left-3 top-1/2 -translate-y-1/2 text-sm text-slate-400">Rs.</span>
            <input
              ref={inputRef}
              type="text"
              inputMode="decimal"
              value={value}
              onChange={e => { setValue(e.target.value); setError(null); }}
              onKeyDown={e => {
                // The till is keyboard-driven: Enter commits, Esc abandons. Both
                // are stopped here so the POS hotkeys behind this dialog — which
                // would otherwise take Enter as "confirm payment" — never see them.
                if (e.key === 'Enter')  { e.preventDefault(); e.stopPropagation(); submit(); }
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); if (!save.isPending) onCancel(); }
              }}
              placeholder="0.00"
              disabled={save.isPending}
              className="w-full pl-10 pr-3 py-2.5 text-lg font-semibold border border-slate-300 rounded-lg
                         focus:outline-none focus:ring-2 focus:ring-amber-400 disabled:bg-slate-50"
            />
          </div>

          {error && (
            <div className="flex items-start gap-1.5 mt-2 text-xs text-rose-600">
              <AlertCircle size={13} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <p className="text-[11px] text-slate-400 mt-3 leading-snug">
            Saved to the product, so it is asked only once.
          </p>

          <div className="flex gap-2 mt-4">
            <button type="button" onClick={onCancel} disabled={save.isPending}
              className="flex-1 px-4 py-2.5 rounded-lg border border-slate-200 text-sm font-semibold
                         text-slate-600 hover:bg-slate-50 disabled:opacity-50">
              Cancel
            </button>
            <button type="button" onClick={submit} disabled={save.isPending || !value.trim()}
              className="flex-1 px-4 py-2.5 rounded-lg bg-amber-600 text-white text-sm font-semibold
                         hover:bg-amber-700 disabled:opacity-50">
              {save.isPending ? 'Saving…' : 'Save & add'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
