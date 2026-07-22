import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { Gift, Check, AlertCircle } from 'lucide-react';
import { loyaltyApi, type LoyaltyConfig } from '../../services/loyalty';
import { useAppSettings } from '../../context/SettingsContext';
import { useAuthStore } from '../../store/authStore';

const rs = (cents: number) => (cents / 100).toString();
const toCents = (v: string) => Math.round(parseFloat(v || '0') * 100);

export default function LoyaltyPage() {
  const qc = useQueryClient();
  const { formatMoney } = useAppSettings();
  const { user } = useAuthStore();
  const canEdit = !!user?.permissions?.includes('manage_settings');

  const { data: cfg, isLoading } = useQuery({ queryKey: ['loyalty-config'], queryFn: loyaltyApi.getConfig });

  const [f, setF] = useState({ isEnabled: true, earnPerRs: '1', pointValueRs: '1', minRedeem: '100', expiryDays: '' });
  const [success, setSuccess] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (cfg) setF({
      isEnabled: cfg.isEnabled,
      earnPerRs: rs(cfg.pointsPerAmount),
      pointValueRs: rs(cfg.pointValueCents),
      minRedeem: String(cfg.minRedeemPoints),
      expiryDays: cfg.expiryDays != null ? String(cfg.expiryDays) : '',
    });
  }, [cfg]);

  const save = useMutation({
    mutationFn: (body: Partial<LoyaltyConfig>) => loyaltyApi.updateConfig(body),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ['loyalty-config'] }); setSuccess(true); setTimeout(() => setSuccess(false), 3000); },
    onError: (e: unknown) => setError((e as { response?: { data?: { message?: string } } })?.response?.data?.message ?? 'Save failed'),
  });

  const handleSave = () => {
    setError(null);
    save.mutate({
      isEnabled: f.isEnabled,
      pointsPerAmount: Math.max(1, toCents(f.earnPerRs)),
      pointValueCents: Math.max(1, toCents(f.pointValueRs)),
      minRedeemPoints: Math.max(0, parseInt(f.minRedeem || '0')),
      expiryDays: f.expiryDays ? parseInt(f.expiryDays) : null,
    });
  };

  // Live example
  const spendCents = 500000; // Rs.5,000
  const earnPerCents = Math.max(1, toCents(f.earnPerRs));
  const exampleEarned = Math.floor(spendCents / earnPerCents);
  const examplePointValue = Math.max(1, toCents(f.pointValueRs));

  const inp = 'w-full px-3 py-2 border border-slate-200 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200 disabled:bg-slate-50';
  const lbl = 'block text-xs font-medium text-slate-600 mb-1';

  if (isLoading) return <div className="p-6"><p className="text-slate-400">Loading…</p></div>;

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <div className="flex items-center gap-3 mb-6">
        <div className="w-10 h-10 rounded-xl bg-indigo-100 text-indigo-600 flex items-center justify-center"><Gift size={20} /></div>
        <div>
          <h1 className="text-xl font-bold text-slate-800">Loyalty Points</h1>
          <p className="text-sm text-slate-500">Reward customers for repeat purchases. Points earn at checkout and redeem as a discount.</p>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5">
        {error && <div className="flex items-start gap-2 bg-red-50 border border-red-200 rounded-lg p-3 text-sm text-red-700"><AlertCircle size={16} className="mt-0.5" />{error}</div>}
        {success && <div className="flex items-center gap-2 bg-green-50 border border-green-200 rounded-lg p-3 text-sm text-green-700"><Check size={16} /> Saved</div>}

        <div className="flex items-center justify-between py-1">
          <div>
            <p className="text-sm font-medium text-slate-700">Enable loyalty</p>
            <p className="text-xs text-slate-400">When off, no points are earned or redeemable.</p>
          </div>
          <button type="button" disabled={!canEdit} onClick={() => setF((p) => ({ ...p, isEnabled: !p.isEnabled }))}
            className={`relative inline-flex h-5 w-9 items-center rounded-full transition-colors ${f.isEnabled ? 'bg-indigo-600' : 'bg-slate-200'} ${!canEdit ? 'opacity-50' : ''}`}>
            <span className={`inline-block h-3.5 w-3.5 transform rounded-full bg-white shadow transition-transform ${f.isEnabled ? 'translate-x-4' : 'translate-x-1'}`} />
          </button>
        </div>

        <div className="grid grid-cols-2 gap-4 border-t border-slate-100 pt-4">
          <div>
            <label className={lbl}>Earn 1 point per (Rs. spent)</label>
            <input disabled={!canEdit} className={inp} type="number" min="0.01" step="0.01" value={f.earnPerRs} onChange={(e) => setF((p) => ({ ...p, earnPerRs: e.target.value }))} />
          </div>
          <div>
            <label className={lbl}>1 point is worth (Rs.)</label>
            <input disabled={!canEdit} className={inp} type="number" min="0.01" step="0.01" value={f.pointValueRs} onChange={(e) => setF((p) => ({ ...p, pointValueRs: e.target.value }))} />
          </div>
          <div>
            <label className={lbl}>Minimum points to redeem</label>
            <input disabled={!canEdit} className={inp} type="number" min="0" value={f.minRedeem} onChange={(e) => setF((p) => ({ ...p, minRedeem: e.target.value }))} />
          </div>
          <div>
            <label className={lbl}>Points expiry (days, optional)</label>
            <input disabled={!canEdit} className={inp} type="number" min="1" value={f.expiryDays} onChange={(e) => setF((p) => ({ ...p, expiryDays: e.target.value }))} placeholder="Never" />
          </div>
        </div>

        <div className="bg-indigo-50 border border-indigo-100 rounded-lg p-4 text-sm">
          <p className="font-medium text-indigo-800 mb-1">Example</p>
          <p className="text-indigo-700">
            A {formatMoney(spendCents)} purchase earns <strong>{exampleEarned.toLocaleString()} points</strong>.
            {' '}Those points are worth <strong>{formatMoney(exampleEarned * examplePointValue)}</strong> off a future purchase.
          </p>
        </div>

        {canEdit && (
          <div className="flex justify-end">
            <button onClick={handleSave} disabled={save.isPending}
              className="flex items-center gap-2 px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-lg text-sm font-medium disabled:opacity-60">
              <Check size={16} /> {save.isPending ? 'Saving…' : 'Save settings'}
            </button>
          </div>
        )}
      </div>

      <p className="text-xs text-slate-400 mt-4">Each customer's point balance and history appear on their Customer profile. Points redeem at POS when a customer is selected.</p>
    </div>
  );
}
