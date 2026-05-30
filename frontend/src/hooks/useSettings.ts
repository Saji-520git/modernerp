import { useQuery } from '@tanstack/react-query';
import { settingsApi } from '../services/settings';

export function useSettings() {
  const { data: settings } = useQuery({
    queryKey: ['app-settings'],
    queryFn:  settingsApi.get,
    staleTime: 5 * 60_000,
  });

  const sym = settings?.currencySymbol ?? 'Rs.';
  const pos = settings?.currencyPosition ?? 'before';

  const formatMoney = (cents: number): string => {
    const amount = (cents / 100).toLocaleString('en-US', {
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    });
    return pos === 'before' ? `${sym} ${amount}` : `${amount} ${sym}`;
  };

  const formatMoneyShort = (cents: number): string => {
    const n = cents / 100;
    let fmt: string;
    if (n >= 1_000_000) fmt = `${(n / 1_000_000).toFixed(1)}M`;
    else if (n >= 1_000) fmt = `${(n / 1_000).toFixed(1)}K`;
    else                 fmt = n.toFixed(0);
    return pos === 'before' ? `${sym} ${fmt}` : `${fmt} ${sym}`;
  };

  return {
    settings,
    formatMoney,
    formatMoneyShort,
    currencySymbol: sym,
    businessName:   settings?.businessName ?? 'BROcode ERP',
  };
}
