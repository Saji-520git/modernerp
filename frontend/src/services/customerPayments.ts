import { api } from './api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CustomerPayment {
  id:            string;
  paymentNumber: string;
  saleId:        string;
  customerId:    string | null;
  amountCents:   number;
  paymentMethod: string;
  referenceNo:   string | null;
  bankName:      string | null;
  paymentDate:   string;
  notes:         string | null;
  createdBy:     string;
  createdByUser: { id: string; fullName: string };
  isActive:      boolean;
  createdAt:     string;
  updatedAt:     string;
}

export interface CreateCustomerPaymentInput {
  saleId:        string;
  amountCents:   number;
  paymentMethod: string;
  referenceNo?:  string;
  bankName?:     string;
  paymentDate:   string;
  notes?:        string;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const customerPaymentsApi = {
  create: (data: CreateCustomerPaymentInput): Promise<CustomerPayment> =>
    api.post('/customer-payments', data).then((r) => r.data),

  listBySale: (saleId: string): Promise<CustomerPayment[]> =>
    api.get(`/customer-payments/sale/${saleId}`).then((r) => r.data),

  listByCustomer: (customerId: string): Promise<CustomerPayment[]> =>
    api.get(`/customer-payments/customer/${customerId}`).then((r) => r.data),

  void: (id: string): Promise<CustomerPayment> =>
    api.delete(`/customer-payments/${id}`).then((r) => r.data),
};
