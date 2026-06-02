import { useState, useEffect } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Layers, Save } from 'lucide-react';
import { crmService } from '../../services/crmService';

/**
 * Per-product price-tier editor. Self-contained: it loads the tier list and the
 * product's existing tier prices, and saves them independently of the main
 * product form (its own Save button). Rendered only for existing products while
 * the 'crm' module is enabled. Money is handled in integer cents.
 */
export default function ProductTierPrices({ productId, defaultPriceCents }: {
  productId: string;
  defaultPriceCents: number;
}) {
  const { data: tiers } = useQuery({ queryKey: ['crm', 'tiers'], queryFn: crmService.getTiers });
  const { data: prices, refetch } = useQuery({
    queryKey: ['crm', 'product-prices', productId],
    queryFn:  () => crmService.getProductPrices(productId),
  });

  // tierId -> rupee string in the input
  const [values, setValues] = useState<Record<string, string>>({});
  const [saving, setSaving] = useState(false);
  const [error, setError]   = useState('');
  const [saved, setSaved]   = useState(false);

  useEffect(() => {
    if (prices) {
      const next: Record<string, string> = {};
      for (const p of prices) next[p.tierId] = (p.priceCents / 100).toFixed(2);
      setValues(next);
    }
  }, [prices]);

  const activeTiers = (tiers ?? []).filter((t) => t.isActive);

  const save = async () => {
    setError('');
    const payload = activeTiers
      .map((t) => ({ tierId: t.id, raw: values[t.id]?.trim() ?? '' }))
      .filter((r) => r.raw !== '')
      .map((r) => ({ tierId: r.tierId, priceCents: Math.round(parseFloat(r.raw) * 100) }));

    if (payload.some((p) => !Number.isFinite(p.priceCents) || p.priceCents <= 0)) {
      setError('Tier prices must be greater than 0.');
      return;
    }
    if (payload.length === 0) { setError('Enter at least one tier price to save.'); return; }

    setSaving(true);
    try {
      await crmService.setProductPrices(productId, payload);
      await refetch();
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    } catch (err: unknown) {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg ?? 'Failed to save tier prices');
    } finally {
      setSaving(false);
    }
  };

  if (activeTiers.length === 0) {
    return (
      <section>
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-2 flex items-center gap-1.5">
          <Layers size={12} /> Tier Pricing
        </p>
        <p className="text-xs text-slate-400">No price tiers configured. Create tiers under Customer Intelligence → Price Tiers.</p>
      </section>
    );
  }

  return (
    <section className="border border-slate-200 rounded-xl p-3 bg-slate-50/50">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide mb-1 flex items-center gap-1.5">
        <Layers size={12} /> Tier Pricing
      </p>
      <p className="text-xs text-slate-400 mb-3">
        Override the default price ({(defaultPriceCents / 100).toFixed(2)}) for customers on a tier. Blank = use default. Saved separately.
      </p>
      <div className="space-y-2">
        {activeTiers.map((t) => (
          <div key={t.id} className="flex items-center gap-3">
            <span className="text-sm text-slate-700 w-32 truncate">{t.name}</span>
            <div className="flex items-center gap-1.5 flex-1">
              <span className="text-xs text-slate-400">Rs.</span>
              <input
                type="number"
                step="0.01"
                min="0"
                value={values[t.id] ?? ''}
                onChange={(e) => setValues((v) => ({ ...v, [t.id]: e.target.value }))}
                placeholder={(defaultPriceCents / 100).toFixed(2)}
                className="w-full px-3 py-1.5 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 bg-white"
              />
            </div>
          </div>
        ))}
      </div>
      {error && <p className="text-xs text-red-600 mt-2">{error}</p>}
      {saved && <p className="text-xs text-emerald-600 mt-2">Tier prices saved.</p>}
      <div className="flex justify-end mt-3">
        <button
          type="button"
          onClick={save}
          disabled={saving}
          className="flex items-center gap-1.5 px-3 py-1.5 bg-indigo-600 text-white rounded-lg text-xs font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
        >
          <Save size={12} /> {saving ? 'Saving…' : 'Save Tier Prices'}
        </button>
      </div>
    </section>
  );
}
