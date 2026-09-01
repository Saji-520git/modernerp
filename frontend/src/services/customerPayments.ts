import { api } from './api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CustomerPayment {
  id:            string;
  paymentNumber: string;
  saleId:        string;
  customerId:    string | null;
  amountCents:   number;
  paymentMethod: string;
  paymentType:   string;   // "PAYMENT" | "CREDIT_APPLIED"
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
  /** Hold anything above the outstanding balance as credit on the account. */
  keepChangeOnAccount?: boolean;
}

export interface LumpSumCustomerPaymentInput {
  customerId:    string;
  amountCents:   number;
  paymentMethod: string;
  referenceNo?:  string;
  bankName?:     string;
  paymentDate:   string;
  notes?:        string;
}

export interface LumpSumAllocation {
  saleId:        string;
  saleNumber:    string;
  paymentNumber: string;
  appliedCents:  number;
}

export interface LumpSumCustomerPaymentResult {
  allocationGroupId: string;
  allocations:       LumpSumAllocation[];
  appliedCents:      number;
  creditAddedCents:  number;
}

export interface ApplyCreditCustomerInput {
  customerId:  string;
  amountCents: number;
  paymentDate: string;
  notes?:      string;
}

export interface ApplyCreditCustomerResult {
  allocationGroupId:    string;
  allocations:          LumpSumAllocation[];
  appliedCents:         number;
  creditRemainingCents: number;
}

export interface CustomerCreditLedgerEntry {
  id:                string;
  customerId:        string;
  amountCents:       number;   // signed: + added, - consumed
  reason:            string;
  allocationGroupId: string | null;
  refType:           string | null;
  refId:             string | null;
  notes:             string | null;
  createdBy:         string;
  createdByUser:     { id: string; fullName: string };
  createdAt:         string;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const customerPaymentsApi = {
  create: (data: CreateCustomerPaymentInput): Promise<CustomerPayment> =>
    api.post('/customer-payments', data).then((r) => r.data),

  createLumpSum: (data: LumpSumCustomerPaymentInput): Promise<LumpSumCustomerPaymentResult> =>
    api.post('/customer-payments/lump-sum', data).then((r) => r.data),

  applyCredit: (data: ApplyCreditCustomerInput): Promise<ApplyCreditCustomerResult> =>
    api.post('/customer-payments/apply-credit', data).then((r) => r.data),

  listBySale: (saleId: string): Promise<CustomerPayment[]> =>
    api.get(`/customer-payments/sale/${saleId}`).then((r) => r.data),

  listByCustomer: (customerId: string): Promise<CustomerPayment[]> =>
    api.get(`/customer-payments/customer/${customerId}`).then((r) => r.data),

  creditLedger: (customerId: string): Promise<CustomerCreditLedgerEntry[]> =>
    api.get(`/customer-payments/credit-ledger/${customerId}`).then((r) => r.data),

  void: (id: string): Promise<CustomerPayment> =>
    api.delete(`/customer-payments/${id}`).then((r) => r.data),
};
