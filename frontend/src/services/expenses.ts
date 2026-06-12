import { api } from './api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExpensePaymentMethod = 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'QR_PAY' | 'CREDIT';

export interface ExpenseCategory {
  id:            string;
  name:          string;
  color:         string;
  isActive:      boolean;
  monthlyBudget: number | null;
  _count?:       { expenses: number };
}

export interface Expense {
  id:            string;
  categoryId:    string;
  category:      { id: string; name: string; color: string };
  amount:        number;  // cents
  description:   string;
  date:          string;
  paymentMethod: ExpensePaymentMethod;
  reference:     string | null;
  isRecurring:   boolean;
  recurringDay:  number | null;
  createdById:   string;
  createdBy:     { id: string; fullName: string };
  createdAt:     string;
  // Recurring-due enrichment fields (from getRecurringDue)
  isDue?:              boolean;
  recordedThisMonth?:  boolean;
}

export interface ExpenseListResponse {
  total:    number;
  page:     number;
  pageSize: number;
  data:     Expense[];
}

export interface MonthlySummary {
  month:           string;
  totalCents:      number;
  prevTotalCents:  number;
  changePct:       number | null;
  count:           number;
  overBudgetCount: number;
  byCategory: {
    id:          string;
    name:        string;
    color:       string;
    totalCents:  number;
    budget:      number | null;
    overBudget:  boolean;
  }[];
}

export interface CreateExpensePayload {
  categoryId:    string;
  amount:        number;
  description:   string;
  date:          string;
  paymentMethod: ExpensePaymentMethod;
  reference?:    string | null;
  isRecurring?:  boolean;
  recurringDay?: number | null;
}

// ─── API ─────────────────────────────────────────────────────────────────────

export const expensesApi = {
  listCategories: (): Promise<ExpenseCategory[]> =>
    api.get('/expenses/categories').then(r => r.data),

  createCategory: (payload: { name: string; color: string; monthlyBudget?: number | null }): Promise<ExpenseCategory> =>
    api.post('/expenses/categories', payload).then(r => r.data),

  updateCategory: (id: string, payload: { name?: string; color?: string; monthlyBudget?: number | null }): Promise<ExpenseCategory> =>
    api.patch(`/expenses/categories/${id}`, payload).then(r => r.data),

  deleteCategory: (id: string): Promise<{ success: boolean }> =>
    api.delete(`/expenses/categories/${id}`).then(r => r.data),

  listExpenses: (params?: {
    categoryId?:  string;
    from?:        string;
    to?:          string;
    search?:      string;
    isRecurring?: boolean;
    page?:        number;
    pageSize?:    number;
  }): Promise<ExpenseListResponse> =>
    api.get('/expenses', { params }).then(r => r.data),

  getRecurringDue: (): Promise<Expense[]> =>
    api.get('/expenses/recurring').then(r => r.data),

  deleteRecurringTemplate: (id: string): Promise<{ success: boolean; deletedOccurrences: number }> =>
    api.delete(`/expenses/recurring/${id}`).then(r => r.data),

  createExpense: (payload: CreateExpensePayload): Promise<Expense> =>
    api.post('/expenses', payload).then(r => r.data),

  updateExpense: (id: string, payload: Partial<CreateExpensePayload>): Promise<Expense> =>
    api.patch(`/expenses/${id}`, payload).then(r => r.data),

  deleteExpense: (id: string): Promise<{ success: boolean; warning: string | null }> =>
    api.delete(`/expenses/${id}`).then(r => r.data),

  getMonthlySummary: (params?: { year?: number; month?: number }): Promise<MonthlySummary> =>
    api.get('/expenses/summary', { params }).then(r => r.data),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

export function formatCents(cents: number): string {
  return `Rs. ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const PAYMENT_LABELS: Record<ExpensePaymentMethod, string> = {
  CASH:          'Cash',
  CARD:          'Card',
  BANK_TRANSFER: 'Bank Transfer',
  QR_PAY:        'QR Pay',
  CREDIT:        'Credit',
};

export const PRESET_COLORS = [
  '#3b82f6', '#10b981', '#f59e0b', '#ef4444', '#8b5cf6', '#6366f1',
  '#ec4899', '#14b8a6', '#f97316', '#64748b',
];
