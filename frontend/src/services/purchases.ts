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
  defaultSupplierId?: string | null;
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

export type PurchaseStatus        = 'DRAFT' | 'CONFIRMED' | 'CANCELLED';
export type PurchasePaymentStatus = 'UNPAID' | 'PARTIAL' | 'PAID';
export type DeliveryStatus        = 'PENDING' | 'PARTIAL' | 'DELIVERED' | 'CLOSED_SHORT';

export interface PurchaseLine {
  id: string;
  productId: string;
  qty: number;
  receivedQty: number;
  unitCostCents: number;
  taxPercent: number;
  lineTotalCents: number;
  expiryDate?: string | null;
  product: {
    id: string;
    name: string;
    sku: string;
    isBatchTracked: boolean;
    unit?: { shortCode: string };
  };
  // Purchased unit for this line (null when the line was entered in the base unit)
  unit?: { id: string; name: string; shortCode: string } | null;
}

export interface PurchaseReceiptLine {
  id:             string;
  purchaseLineId: string;
  productId:      string;
  qty:            number;
  unitCostCents:  number;         // actual cost at receipt — G2
  damagedQty:     number;         // damaged qty (not stocked) — G2
  damagedAccepted:      boolean;       // accepted (paid) vs rejected (unpaid) — G3
  damagedUnitCostCents: number | null; // negotiated damaged cost when accepted — G3
  damagedSellingPriceCents: number | null; // selling price of the accepted damaged batch
  note:           string | null;  // per-line receiving note — G2
  batchNumber:    string | null;
  expiryDate:     string | null;
  product:        { id: string; name: string; sku: string };
  purchaseLine:   { id: string; qty: number; receivedQty: number };
}

export interface PurchaseReceipt {
  id:            string;
  receiptNumber: string;
  purchaseId:    string;
  warehouseId:   string;
  notes:         string | null;
  receivedBy:    { id: string; fullName: string };
  lines:         PurchaseReceiptLine[];
  createdAt:     string;
}

export interface SupplierPayment {
  id:            string;
  paymentNumber: string;
  purchaseId:    string;
  supplierId:    string;
  amountCents:   number;
  paymentMethod: string;
  paymentType?:  string;   // "PAYMENT" | "CREDIT_RECEIVED"
  referenceNo:   string | null;
  bankName:      string | null;
  paymentDate:   string;
  notes:         string | null;
  isActive:      boolean;
  createdAt:     string;
  supplier:      { id: string; name: string };
  createdByUser: { id: string; fullName: string };
}

export interface Purchase {
  id: string;
  number: string;
  status: PurchaseStatus;
  paymentStatus: PurchasePaymentStatus;
  deliveryStatus: DeliveryStatus;
  closedShortAt: string | null;
  closedShortReason: string | null;
  closedShortBy?: { id: string; fullName: string } | null;
  sourceType: string | null;
  paidCents: number;
  date: string;
  subtotalCents: number;
  taxCents: number;
  totalCents: number;          // ordered value (PO commitment)
  receivedValueCents: number;  // delivered value — the supplier payable
  note: string | null;
  supplier: { id: string; name: string };
  warehouse: { id: string; name: string; code: string };
  createdBy: { id: string; fullName: string };
  lines?: PurchaseLine[];
  receipts?: PurchaseReceipt[];
  supplierPayments?: SupplierPayment[];
  // Confirmed purchase returns (Option B) — subtract from displayed balance, never from totalCents.
  purchaseReturns?: { totalCents: number }[];
  _count?: { lines: number };
  createdAt: string;
}

export interface CreateReceiptLineInput {
  purchaseLineId: string;
  qty:            number;       // good qty received (enters stock)
  unitCostCents?: number;       // actual cost per purchase unit at receipt — G2
  sellingPriceCents?: number;   // selling price for this batch; defaults to the product's current price
  damagedQty?:    number;       // damaged qty (recorded, not stocked) — G2
  damagedAccepted?:     boolean; // accept damaged (pay) vs reject (unpaid, default) — G3
  damagedUnitCostCents?: number; // negotiated cost per damaged unit when accepted — G3
  damagedSellingPriceCents?: number; // selling price for the accepted damaged batch
  note?:          string;       // per-line receiving note — G2
  batchNumber?:   string;
  expiryDate?:    string;
}

export interface CreateReceiptPayload {
  lines: CreateReceiptLineInput[];
  notes?: string;
}

export interface FromAlertsItem {
  productId:     string;
  qty:           number;
  unitCostCents?: number;
}

export interface FromAlertsPayload {
  warehouseId: string;
  supplierId:  string;
  items:       FromAlertsItem[];
  note?:       string;
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
    from?: string;
    to?: string;
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

  // receiveMode: 'FULL' (default) confirms + receives all stock now; 'AWAIT_GRN'
  // confirms the order only (stock enters later via GRN).
  confirmPurchase: (id: string, receiveMode: 'FULL' | 'AWAIT_GRN' = 'FULL'): Promise<Purchase> =>
    api.patch(`/purchases/${id}/confirm`, { receiveMode }).then((r) => r.data),

  cancelPurchase: (id: string): Promise<Purchase> =>
    api.patch(`/purchases/${id}/cancel`).then((r) => r.data),

  // Finish a partially-delivered order, accepting the shortfall.
  closeShortPurchase: (id: string, reason?: string): Promise<Purchase> =>
    api.patch(`/purchases/${id}/close-short`, { reason }).then((r) => r.data),

  deletePurchase: (id: string): Promise<{ success: boolean }> =>
    api.delete(`/purchases/${id}`).then((r) => r.data),

  // Legacy supplier-payment API methods removed — use supplierPaymentsApi
  // (services/supplierPayments.ts) which is the sole payment path.

  // ── GRN Receipts ──────────────────────────────────────────────────────────
  listReceipts: (purchaseId: string): Promise<PurchaseReceipt[]> =>
    api.get(`/purchases/${purchaseId}/receipts`).then((r) => r.data),

  createReceipt: (purchaseId: string, payload: CreateReceiptPayload): Promise<PurchaseReceipt> =>
    api.post(`/purchases/${purchaseId}/receipts`, payload).then((r) => r.data),

  getReceipt: (receiptId: string): Promise<PurchaseReceipt> =>
    api.get(`/purchases/receipts/${receiptId}`).then((r) => r.data),

  fromAlerts: (payload: FromAlertsPayload): Promise<Purchase> =>
    api.post('/purchases/from-alerts', payload).then((r) => r.data),
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

export const DELIVERY_LABELS: Record<DeliveryStatus, string> = {
  PENDING:   'Pending',
  PARTIAL:   'Partial',
  DELIVERED: 'Delivered',
  CLOSED_SHORT: 'Closed Short',
};

export const DELIVERY_COLORS: Record<DeliveryStatus, string> = {
  PENDING:   'bg-slate-100 text-slate-500',
  PARTIAL:   'bg-amber-100 text-amber-700',
  DELIVERED: 'bg-emerald-100 text-emerald-700',
  CLOSED_SHORT: 'bg-slate-200 text-slate-700',
};
