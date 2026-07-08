import { api } from './api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: string;
  creditBalanceCents: number;
  _count?: { purchases: number };
}

export interface Customer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
  address: string | null;
  isActive: boolean;
  createdAt: string;
  // Credit fields
  creditEnabled: boolean;
  creditLimitCents: number;
  creditAlertPct: number;
  creditSettleDays: number | null;
  creditBalanceCents: number;
  _count?: { sales: number };
}

/** Extended customer returned by GET /customers/:id — includes aggregates */
export interface CustomerDetail extends Customer {
  _count: { sales: number; customerPayments: number };
  totalSalesAmount: number;
  totalPaid: number;
  outstandingBalance: number;
  lastPurchaseDate: string | null;
  creditUsedCents: number;
  updatedAt: string;
}

/** Extended supplier returned by GET /suppliers/:id — includes aggregates */
export interface SupplierDetail extends Supplier {
  _count: { purchases: number };
  totalPurchaseAmount: number;
  totalPaid: number;
  outstandingBalance: number;
  lastOrderDate: string | null;
  totalReturns: number;
}

export interface ContactListResponse<T> {
  total: number;
  page: number;
  pageSize: number;
  data: T[];
}

export interface ContactBody {
  name: string;
  phone?: string;
  email?: string;
  address?: string;
}

export interface CustomerBody extends ContactBody {
  creditEnabled?: boolean;
  creditLimitCents?: number;
  creditAlertPct?: number;
  creditSettleDays?: number | null;
}

// ─── Suppliers API ────────────────────────────────────────────────────────────

export const suppliersApi = {
  list: (params?: { search?: string; page?: number; pageSize?: number }): Promise<ContactListResponse<Supplier>> =>
    api.get('/suppliers', { params }).then((r) => r.data),

  create: (body: ContactBody): Promise<Supplier> =>
    api.post('/suppliers', body).then((r) => r.data),

  update: (id: string, body: ContactBody): Promise<Supplier> =>
    api.put(`/suppliers/${id}`, body).then((r) => r.data),

  getOne: (id: string): Promise<SupplierDetail> =>
    api.get(`/suppliers/${id}`).then((r) => r.data),

  toggleActive: (id: string): Promise<Supplier> =>
    api.patch(`/suppliers/${id}/toggle-active`).then((r) => r.data),

  // Smart delete: hard-delete when the supplier has no purchase history,
  // otherwise soft-delete (isActive:false). Always resolves on success.
  remove: (id: string): Promise<{ success: boolean }> =>
    api.delete(`/suppliers/${id}`).then((r) => r.data),
};

// ─── Customers API ────────────────────────────────────────────────────────────

export const customersApi = {
  list: (params?: { search?: string; page?: number; pageSize?: number }): Promise<ContactListResponse<Customer>> =>
    api.get('/customers', { params }).then((r) => r.data),

  getOne: (id: string): Promise<CustomerDetail> =>
    api.get(`/customers/${id}`).then((r) => r.data),

  create: (body: CustomerBody): Promise<Customer> =>
    api.post('/customers', body).then((r) => r.data),

  update: (id: string, body: CustomerBody): Promise<Customer> =>
    api.put(`/customers/${id}`, body).then((r) => r.data),

  toggleActive: (id: string): Promise<Customer> =>
    api.patch(`/customers/${id}/toggle-active`).then((r) => r.data),

  // Smart delete: hard-delete when the customer has no sales history,
  // otherwise soft-delete (isActive:false). Always resolves on success.
  remove: (id: string): Promise<{ success: boolean }> =>
    api.delete(`/customers/${id}`).then((r) => r.data),
};
