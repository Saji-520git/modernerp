import { useState, useEffect } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Save, Star } from 'lucide-react';
import { crmService } from '../../services/crmService';
import type { UpdateLoyaltyConfigDto } from '../../types/crm';

function NumberField({ label, value, onChange, hint, min = 1 }: {
  label: string; value: string; onChange: (v: string) => void; hint?: string; min?: number;
}) {
  return (
    <div>
      <label className="block text-sm font-medium text-slate-700 mb-1">{label}</label>
      <input
        type="number"
        min={min}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="w-full border border-slate-200 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-200"
      />
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

export default function LoyaltySettingsPage() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [error, setError] = useState('');
  const [saved, setSaved] = useState(false);

  const { data: config, isLoading } = useQuery({ queryKey: ['crm', 'loyalty-config'], queryFn: crmService.getLoyaltyConfig });

  const [isEnabled, setIsEnabled]             = useState(true);
  const [amountPerPoint, setAmountPerPoint]   = useState('100');
  const [pointValueCents, setPointValueCents] = useState('100');
  const [minRedeemPoints, setMinRedeemPoints] = useState('100');

  useEffect(() => {
    if (config) {
      setIsEnabled(config.isEnabled);
      setAmountPerPoint(String(config.amountPerPoint));
      setPointValueCents(String(config.pointValueCents));
      setMinRedeemPoints(String(config.minRedeemPoints));
    }
  }, [config]);

  const mutation = useMutation({
    mutationFn: (body: UpdateLoyaltyConfigDto) => crmService.updateLoyaltyConfig(body),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['crm', 'loyalty-config'] });
      setError('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
    },
    onError: (err: unknown) => {
      const msg = (err as { response?: { data?: { message?: string } } })?.response?.data?.message;
      setError(msg ?? 'Failed to save settings');
    },
  });

  const save = () => {
    const apc = parseInt(amountPerPoint, 10);
    const pvc = parseInt(pointValueCents, 10);
    const mrp = parseInt(minRedeemPoints, 10);
    if (!Number.isInteger(apc) || apc <= 0) { setError('Spend per point must be greater than 0'); return; }
    if (!Number.isInteger(pvc) || pvc <= 0) { setError('Point value must be greater than 0'); return; }
    if (!Number.isInteger(mrp) || mrp < 0) { setError('Minimum to redeem cannot be negative'); return; }
    mutation.mutate({ isEnabled, amountPerPoint: apc, pointValueCents: pvc, minRedeemPoints: mrp });
  };

  if (isLoading) return <div className="text-center py-16 text-slate-400">Loading…</div>;

  return (
    <div className="p-6 max-w-2xl">
      <button onClick={() => navigate('/crm')}
        className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 mb-4 transition-colors">
        <ArrowLeft size={14} /> Customer Intelligence
      </button>

      <div className="flex items-center gap-2 mb-1">
        <Star size={22} className="text-indigo-600" />
        <h1 className="text-2xl font-bold text-slate-800">Loyalty Settings</h1>
      </div>
      <p className="text-sm text-slate-500 mb-6">Configure how customers earn and redeem loyalty points.</p>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 space-y-5">
        {/* Enable toggle */}
        <label className="flex items-center justify-between cursor-pointer">
          <div>
            <p className="text-sm font-medium text-slate-700">Loyalty Program</p>
            <p className="text-xs text-slate-400">When off, no new points are earned (existing balances are kept).</p>
          </div>
          <button
            type="button"
            onClick={() => setIsEnabled((v) => !v)}
            className={`relative w-11 h-6 rounded-full transition-colors ${isEnabled ? 'bg-indigo-600' : 'bg-slate-300'}`}
          >
            <span className={`absolute top-0.5 left-0.5 w-5 h-5 bg-white rounded-full transition-transform ${isEnabled ? 'translate-x-5' : ''}`} />
          </button>
        </label>

        <div className="border-t border-slate-100" />

        <NumberField
          label="Spend per point earned (cents)"
          value={amountPerPoint}
          onChange={setAmountPerPoint}
          hint="e.g. 100 = a customer earns 1 point per Rs. 1.00 spent."
        />
        <NumberField
          label="Cash value of 1 point (cents)"
          value={pointValueCents}
          onChange={setPointValueCents}
          hint="e.g. 100 = each point is worth Rs. 1.00 at redemption."
        />
        <NumberField
          label="Minimum points to redeem"
          value={minRedeemPoints}
          onChange={setMinRedeemPoints}
          min={0}
          hint="Customers must hold at least this many points before they can redeem."
        />

        {error && <p className="text-sm text-red-600">{error}</p>}
        {saved && <p className="text-sm text-emerald-600">Settings saved.</p>}

        <div className="flex justify-end">
          <button
            onClick={save}
            disabled={mutation.isPending}
            className="flex items-center gap-1.5 px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors"
          >
            <Save size={14} /> Save Settings
          </button>
        </div>
      </div>
    </div>
  );
}
