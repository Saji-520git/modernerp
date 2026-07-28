import { api } from './api';

export interface DataSummary {
  products: number;
  activeProducts: number;
  suppliers: number;
  customers: number;
  sales: number;
  purchases: number;
  stockMovements: number;
  saleReturns: number;
  purchaseReturns: number;
  supplierPayments: number;
  customerPayments: number;
  expenses: number;
  quotations: number;
}

export type ClearableEntity = 'product' | 'supplier' | 'customer';

export interface ClearReport {
  requested: number;
  removed: number;      // hard-deleted (no history)
  softDeleted: number;  // hidden (had history — records preserved)
  blocked: { id: string; reason: string }[];
}

export type ResetPreset = 'transactions' | 'keepProducts' | 'full';

export interface ResetPreview {
  preset: ResetPreset;
  willClear: {
    transactions: { sales: number; purchases: number; payments: number; stockMovements: number; expenses: number; quotations: number };
    contacts: { customers: number; suppliers: number } | null;
    products: { products: number } | null;
    users: { nonSuperUsers: number } | null;
  };
  keeps: { superAdmin: boolean; settings: boolean; warehouses: boolean; products: boolean; contacts: boolean };
}

export const dataManagementApi = {
  summary: () => api.get<DataSummary>('/data-management/summary').then((r) => r.data),
  clearEntities: (type: ClearableEntity, ids: string[]) =>
    api.post<ClearReport>('/data-management/clear-entities', { type, ids }).then((r) => r.data),
  resetPreview: (preset: ResetPreset) =>
    api.get<ResetPreview>('/data-management/reset/preview', { params: { preset } }).then((r) => r.data),
  resetExecute: (preset: ResetPreset, password: string, confirm: string) =>
    api.post<{ success: boolean; preset: ResetPreset }>('/data-management/reset/execute', { preset, password, confirm }).then((r) => r.data),
  restorePreview: (backup: unknown) =>
    api.post<{ exportedAt: string | null; counts: Record<string, number> }>('/data-management/restore/preview', { backup }).then((r) => r.data),
  restoreExecute: (backup: unknown, password: string, confirm: string) =>
    api.post<{ success: boolean; counts: Record<string, number> }>('/data-management/restore/execute', { backup, password, confirm }).then((r) => r.data),
  downloadBackup: async () => {
    const res = await api.get('/data-management/backup', { responseType: 'blob' });
    const url = URL.createObjectURL(res.data as Blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `brocode-backup-${new Date().toISOString().slice(0, 10)}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },
};
