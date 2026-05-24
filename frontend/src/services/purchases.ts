import { api } from './api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Supplier {
  id: string;
  name: string;
  phone: string | null;
  email: string | null;
}

export interface PurchaseProduct {
  id: string;
  name: string;
  sku: string;
  costCents: number;
  taxPercent: number;
  unitId:        string;
  baseUnitId:    string | null;
  purchaseUnitId:string | null;
  unit:         { shortCode: string };
  baseUnit:     { id: string; name: string; shortCode: string } | null;
  purchaseUnit: { id: string; name: string; shortCode: string } | null;
  unitConversions?: Array<{
    fromUnitId: string; toUnitId: string; conversionQty: number; priceCents: number | null;
    fromUnit: { id: string; name: string; shortCode: string };
    toUnit:   { id: string; name: string; shortCode: string };
  }>;
}

export type PurchaseStatus = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';

export interface PurchaseLine {
  id: string;
  productId: string;
  qty: number;
  unitCostCents: number;
  taxPercent: number;
  lineTotalCents: number;
  product: {
    id: string;
    name: string;
    sku: string;
    unit?: { shortCode: string };
  };
}

export interface Purchase {
  id: string;
  number: string;
  status: PurchaseStatus;
  date: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;
  note: string | null;
  supplier: { id: string; name: string };
  warehouse: { id: string; name: string; code: string };
  createdBy: { id: string; fullName: string };
  lines?: PurchaseLine[];
  _count?: { lines: number };
  createdAt: string;
}

export interface PurchaseListResponse {
  total: number;
  page: number;
  pageSize: number;
  data: Purchase[];
}

export interface PurchaseLineInput {
  productId:    string;
  qty:          number;
  unitCostCents:number;
  taxPercent:   number;
  unitId?:      string;  // unit used for this line; backend converts to base
}

export interface CreatePurchasePayload {
  supplierId: string;
  warehouseId: string;
  date?: string;
  note?: string;
  lines: PurchaseLineInput[];
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const purchasesApi = {
  listSuppliers: (): Promise<Supplier[]> =>
    api.get('/purchases/suppliers').then((r) => r.data),

  listProducts: (): Promise<PurchaseProduct[]> =>
    api.get('/purchases/products').then((r) => r.data),

  listPurchases: (params?: {
    search?: string;
    status?: PurchaseStatus;
    supplierId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<PurchaseListResponse> =>
    api.get('/purchases', { params }).then((r) => r.data),

  getPurchase: (id: string): Promise<Purchase> =>
    api.get(`/purchases/${id}`).then((r) => r.data),

  createPurchase: (payload: CreatePurchasePayload): Promise<Purchase> =>
    api.post('/purchases', payload).then((r) => r.data),

  updatePurchase: (id: string, payload: Partial<CreatePurchasePayload>): Promise<Purchase> =>
    api.patch(`/purchases/${id}`, payload).then((r) => r.data),

  confirmPurchase: (id: string): Promise<Purchase> =>
    api.patch(`/purchases/${id}/confirm`).then((r) => r.data),

  cancelPurchase: (id: string): Promise<Purchase> =>
    api.patch(`/purchases/${id}/cancel`).then((r) => r.data),

  deletePurchase: (id: string): Promise<{ success: boolean }> =>
    api.delete(`/purchases/${id}`).then((r) => r.data),

  recordSupplierPayment: (id: string, payload: { amountCents: number; method: string; note?: string }): Promise<Purchase> =>
    api.post(`/purchases/${id}/payments`, payload).then((r) => r.data),

  listPurchasePayments: (id: string): Promise<Array<{id: string; amountCents: number; method: string; date: string; note: string | null; createdBy: { fullName: string }}>> =>
    api.get(`/purchases/${id}/payments`).then((r) => r.data),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatCents(cents: number): string {
  return `Rs. ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export const STATUS_LABELS: Record<PurchaseStatus, string> = {
  DRAFT: 'Draft',
  CONFIRMED: 'Confirmed',
  CANCELLED: 'Cancelled',
};

export const STATUS_COLORS: Record<PurchaseStatus, string> = {
  DRAFT: 'bg-yellow-100 text-yellow-700',
  CONFIRMED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};
