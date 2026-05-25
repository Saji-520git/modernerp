import { api } from './api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface SaleCustomer {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

export interface SaleProduct {
  id: string;
  name: string;
  sku: string;
  priceCents: number;
  taxPercent: number;
  stockQty: number;
  unit: { shortCode: string };
}

export type SaleStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
export type PaymentMethod = 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'QR_PAY' | 'CREDIT' | 'CHEQUE';
export type SalePaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';

export interface SaleLine {
  id: string;
  productId: string;
  qty: number;
  unitPriceCents: number;
  taxPercent: number;
  discountCents: number;
  lineTotalCents: number;
  product: {
    id: string;
    name: string;
    sku: string;
    unit?: { shortCode: string };
  };
}

export interface Sale {
  id: string;
  number: string;
  isPos: boolean;
  status: SaleStatus;
  date: string;
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
  paidCents: number;
  paymentStatus: SalePaymentStatus;
  paymentMethod: PaymentMethod;
  note: string | null;
  customer: { id: string; name: string; phone?: string | null } | null;
  warehouse: { id: string; name: string; code: string };
  createdBy: { id: string; fullName: string };
  lines?: SaleLine[];
  customerPayments?: import('./customerPayments').CustomerPayment[];
  _count?: { lines: number };
  createdAt: string;
}

export interface SaleListResponse {
  total: number;
  page: number;
  pageSize: number;
  data: Sale[];
}

export interface SaleLineInput {
  productId: string;
  qty: number;
  unitPriceCents: number;
  taxPercent: number;
  discountCents: number;
}

export interface CreateSalePayload {
  customerId?: string;
  warehouseId: string;
  date?: string;
  note?: string;
  lines: SaleLineInput[];
}

export interface RecordPaymentPayload {
  paidCents: number;
  paymentMethod: PaymentMethod;
}

export interface PaymentRecord {
  id: string;
  saleId: string | null;
  purchaseId: string | null;
  amountCents: number;
  method: PaymentMethod;
  date: string;
  note: string | null;
  createdAt: string;
  createdBy: { fullName: string };
}

// ─── Returns types ────────────────────────────────────────────────────────────

export interface SaleReturnLine {
  id: string;
  productId: string;
  qty: number;
  unitPriceCents: number;
  lineTotalCents: number;
  product: { id: string; name: string; sku: string; unit?: { shortCode: string } };
}

export interface SaleReturn {
  id: string;
  number: string;
  saleId: string;
  sale: { id: string; number: string; customer: { name: string } | null };
  warehouseId: string;
  warehouse: { id: string; name: string; code: string };
  reason: string | null;
  totalCents: number;
  createdBy: { id: string; fullName: string };
  lines?: SaleReturnLine[];
  _count?: { lines: number };
  createdAt: string;
}

export interface ReturnListResponse {
  total: number;
  page: number;
  pageSize: number;
  data: SaleReturn[];
}

export interface SaleForReturn extends Sale {
  lines: (SaleLine & {
    alreadyReturnedQty: number;
    availableToReturn: number;
  })[];
}

export interface CreateReturnPayload {
  saleId: string;
  reason?: string;
  lines: {
    productId: string;
    qty: number;
    unitPriceCents: number;
    lineTotalCents: number;
  }[];
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const salesApi = {
  listCustomers: (): Promise<SaleCustomer[]> =>
    api.get('/sales/customers').then((r) => r.data),

  listProducts: (warehouseId?: string): Promise<SaleProduct[]> =>
    api.get('/sales/products', { params: { warehouseId } }).then((r) => r.data),

  listSales: (params?: {
    search?: string;
    status?: SaleStatus;
    paymentMethod?: string;
    customerId?: string;
    warehouseId?: string;
    from?: string;
    to?: string;
    includePos?: 'true' | 'false';
    page?: number;
    pageSize?: number;
  }): Promise<SaleListResponse> =>
    api.get('/sales', { params }).then((r) => r.data),

  getSale: (id: string): Promise<Sale> =>
    api.get(`/sales/${id}`).then((r) => r.data),

  createSale: (payload: CreateSalePayload): Promise<Sale> =>
    api.post('/sales', payload).then((r) => r.data),

  updateSale: (id: string, payload: Partial<CreateSalePayload>): Promise<Sale> =>
    api.patch(`/sales/${id}`, payload).then((r) => r.data),

  deleteSale: (id: string): Promise<{ success: boolean }> =>
    api.delete(`/sales/${id}`).then((r) => r.data),

  confirmSale: (id: string): Promise<Sale> =>
    api.patch(`/sales/${id}/confirm`).then((r) => r.data),

  cancelSale: (id: string): Promise<Sale> =>
    api.patch(`/sales/${id}/cancel`).then((r) => r.data),

  recordPayment: (id: string, payload: RecordPaymentPayload): Promise<Sale> =>
    api.patch(`/sales/${id}/pay`, payload).then((r) => r.data),

  recordPaymentNew: (id: string, payload: { amountCents: number; paymentMethod: PaymentMethod; note?: string }): Promise<Sale> =>
    api.post(`/sales/${id}/payments`, { ...payload, paidCents: payload.amountCents, method: payload.paymentMethod }).then((r) => r.data),

  listPayments: (id: string): Promise<PaymentRecord[]> =>
    api.get(`/sales/${id}/payments`).then((r) => r.data),

  // Returns
  listReturns: (params?: {
    search?: string;
    saleId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<ReturnListResponse> =>
    api.get('/sales/returns/list', { params }).then((r) => r.data),

  getReturn: (id: string): Promise<SaleReturn> =>
    api.get(`/sales/returns/${id}`).then((r) => r.data),

  getSaleForReturn: (saleId: string): Promise<SaleForReturn> =>
    api.get(`/sales/returns/for-sale/${saleId}`).then((r) => r.data),

  createReturn: (payload: CreateReturnPayload): Promise<SaleReturn> =>
    api.post('/sales/returns', payload).then((r) => r.data),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatCents(cents: number): string {
  return `Rs. ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const STATUS_LABELS: Record<SaleStatus, string> = {
  DRAFT: 'Draft',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
};

export const STATUS_COLORS: Record<SaleStatus, string> = {
  DRAFT: 'bg-yellow-100 text-yellow-700',
  CONFIRMED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};

export const PAYMENT_LABELS: Record<PaymentMethod, string> = {
  CASH:          'Cash',
  CARD:          'Card',
  BANK_TRANSFER: 'Bank Transfer',
  QR_PAY:        'QR Pay',
  CREDIT:        'Credit',
  CHEQUE:        'Cheque',
};
