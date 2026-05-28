import React, { createContext, useContext } from 'react';
import { useQuery } from '@tanstack/react-query';
import { settingsApi, type AppSettings } from '../services/settings';

interface SettingsContextValue {
  settings:          AppSettings | undefined;
  isLoading:         boolean;
  formatMoney:       (cents: number) => string;
  formatMoneyShort:  (cents: number) => string;
  currencySymbol:    string;
  businessName:      string;
  receiptLanguage:   string;
  receiptPaperWidth: string;
}

const defaultFormat = (cents: number) =>
  `Rs. ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

const defaultShort = (cents: number) => {
  const n = cents / 100;
  if (n >= 1_000_000) return `Rs. ${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 1_000)     return `Rs. ${(n / 1_000).toFixed(1)}K`;
  return `Rs. ${n.toFixed(0)}`;
};

const SettingsContext = createContext<SettingsContextValue>({
  settings:          undefined,
  isLoading:         true,
  formatMoney:       defaultFormat,
  formatMoneyShort:  defaultShort,
  currencySymbol:    'Rs.',
  businessName:      'Brocode ERP',
  receiptLanguage:   'en',
  receiptPaperWidth: '80mm',
});

export function SettingsProvider({ children }: { children: React.ReactNode }) {
  const { data: settings, isLoading } = useQuery({
    queryKey: ['app-settings'],
    queryFn:  settingsApi.get,
    staleTime: 5 * 60_000,
    // Don't block the whole app if settings fail — fallback to defaults
    retry: 1,
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

  return (
    <SettingsContext.Provider value={{
      settings,
      isLoading,
      formatMoney,
      formatMoneyShort,
      currencySymbol:    sym,
      businessName:      settings?.businessName      ?? 'Brocode ERP',
      receiptLanguage:   settings?.receiptLanguage   ?? 'en',
      receiptPaperWidth: settings?.receiptPaperWidth ?? '80mm',
    }}>
      {children}
    </SettingsContext.Provider>
  );
}

export const useAppSettings = () => useContext(SettingsContext);
