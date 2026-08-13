import { useEffect, useRef } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { posApi, type ProductBatch } from '../../services/pos';
import { useAppSettings } from '../../context/SettingsContext';

interface BatchPickerModalProps {
  productId:   string;
  warehouseId: string;
  productName: string;
  qtyNeeded:   number;
  // The product's own price, used to display a batch that has none recorded
  // (0). Keeps the price shown here equal to the price actually charged.
  fallbackPriceCents?: number;
  // Base units of each batch ALREADY sitting in the cart, keyed by batch id.
  // Subtracted from what the picker offers, so a batch of 5 with 2 already
  // taken shows 3 — the cashier sees what is still addable, not the shelf qty.
  alreadyInCart?: Record<string, number>;
  // null = no batch rows exist (legacy pre-batch-tracking stock) — proceed
  // with the product's own defaults, same as before this feature existed.
  onSelect:    (batch: ProductBatch | null) => void;
  onClose:     () => void;
}

// Shared by POS and Sales Invoice — mount this whenever a batch-tracked
// product is added; it decides for itself whether a picker is even needed.
// 0 or 1 batch → resolves silently, no UI shown. 2+ batches → shows a picker
// so the cashier/clerk can choose which lot to sell from (own cost, selling
// price, supplier).
export default function BatchPickerModal({
  productId, warehouseId, productName, qtyNeeded, fallbackPriceCents, alreadyInCart, onSelect, onClose,
}: BatchPickerModalProps) {
  const { formatMoney } = useAppSettings();

  const { data: batches, isLoading } = useQuery({
    queryKey: ['product-batches', productId, warehouseId],
    queryFn:  () => posApi.getProductBatches(productId, warehouseId),
  });

  // Auto-resolve once: 0 batches → no batch info (null); exactly 1 → use it
  // directly. Only 2+ batches renders a visible picker. The ref guards
  // against onSelect firing twice under React StrictMode's double-effect.
  const resolvedRef = useRef(false);
  useEffect(() => {
    if (!batches || resolvedRef.current) return;
    if (batches.length === 0) {
      resolvedRef.current = true;
      onSelect(null);
    } else if (batches.length === 1) {
      resolvedRef.current = true;
      onSelect(batches[0]);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [batches]);

  if (isLoading || !batches || batches.length <= 1) return null;

  return (
    <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
      <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl flex flex-col max-h-[85vh]">
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
          <div>
            <h2 className="font-bold text-slate-800">Select Batch</h2>
            <p className="text-xs text-slate-400">{productName} · qty {qtyNeeded}</p>
          </div>
          <button onClick={onClose} className="p-2 hover:bg-slate-100 rounded-lg">
            <X className="w-5 h-5 text-slate-500" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-6 py-4">
          {isLoading ? (
            <p className="text-sm text-slate-400 text-center py-8">Loading batches…</p>
          ) : !batches || batches.length === 0 ? (
            <p className="text-sm text-slate-400 text-center py-8">No batches available.</p>
          ) : (
            <div className="space-y-2">
              {batches.map((b) => {
                // What is still addable: the batch's stock minus whatever this
                // sale has already taken from it. A batch fully consumed by the
                // cart is shown as such rather than offering stock twice.
                const taken     = alreadyInCart?.[b.id] ?? 0;
                const remaining = Math.max(0, b.qty - taken);
                const insufficient = remaining < qtyNeeded;
                return (
                  <button
                    key={b.id}
                    type="button"
                    disabled={insufficient}
                    onClick={() => onSelect(b)}
                    className={`w-full text-left border rounded-xl p-3 transition ${
                      insufficient
                        ? 'opacity-40 cursor-not-allowed border-slate-100'
                        : 'border-slate-200 hover:border-indigo-400 hover:bg-indigo-50/40'
                    }`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <div className="flex items-center gap-2 min-w-0">
                        <span className="font-mono text-xs text-slate-500 truncate">{b.batchNumber ?? '—'}</span>
                        {b.status === 'expired' && (
                          <span className="text-[10px] font-bold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full shrink-0">EXPIRED</span>
                        )}
                        {b.status === 'expiring_soon' && (
                          <span className="text-[10px] font-bold bg-amber-100 text-amber-700 px-1.5 py-0.5 rounded-full shrink-0">EXPIRING SOON</span>
                        )}
                        {b.isDamaged && (
                          <span className="text-[10px] font-bold bg-orange-100 text-orange-700 px-1.5 py-0.5 rounded-full shrink-0">DAMAGED</span>
                        )}
                        {taken > 0 && (
                          <span className="text-[10px] font-bold bg-indigo-100 text-indigo-700 px-1.5 py-0.5 rounded-full shrink-0">
                            {taken} IN CART
                          </span>
                        )}
                      </div>
                      <span className={`text-xs font-semibold shrink-0 ${insufficient ? 'text-red-500' : 'text-slate-600'}`}>
                        Qty {remaining}{taken > 0 ? ` of ${b.qty}` : ''}
                      </span>
                    </div>
                    <div className="mt-1.5 grid grid-cols-3 gap-2 text-xs">
                      <div>
                        <p className="text-slate-400">Cost</p>
                        <p className="font-semibold text-slate-700">{formatMoney(b.unitCostCents)}</p>
                      </div>
                      <div>
                        <p className="text-slate-400">Selling Price</p>
                        <p className="font-semibold text-indigo-700">
                          {formatMoney(b.sellingPriceCents > 0 ? b.sellingPriceCents : (fallbackPriceCents ?? b.sellingPriceCents))}
                        </p>
                      </div>
                      <div className="min-w-0">
                        <p className="text-slate-400">Supplier</p>
                        <p className="font-semibold text-slate-700 truncate">{b.supplierName ?? '—'}</p>
                      </div>
                    </div>
                    {b.expiryDate && (
                      <p className="mt-1 text-[10px] text-slate-400">
                        Expires {new Date(b.expiryDate).toLocaleDateString()}
                      </p>
                    )}
                    {insufficient && (
                      <p className="mt-1 text-[10px] text-red-500 font-medium">
                        {taken > 0 ? 'All of this batch is already in the cart' : 'Not enough stock in this batch'}
                      </p>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-6 py-3 border-t border-slate-100 flex justify-end">
          <button onClick={onClose} className="px-4 py-2 border border-slate-200 text-sm text-slate-600 rounded-lg hover:bg-slate-50">
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
