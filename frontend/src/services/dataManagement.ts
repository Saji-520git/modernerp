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

export const dataManagementApi = {
  summary: () => api.get<DataSummary>('/data-management/summary').then((r) => r.data),
  clearEntities: (type: ClearableEntity, ids: string[]) =>
    api.post<ClearReport>('/data-management/clear-entities', { type, ids }).then((r) => r.data),
};
