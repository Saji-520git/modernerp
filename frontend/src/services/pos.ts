import { api } from './api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface Warehouse {
  id: string;
  name: string;
  code: string;
  isDefault: boolean;   // drives the POS's initial warehouse and the ★ marker
}

export interface PosUnitConversion {
  id:            string;
  fromUnitId:    string;
  toUnitId:      string;
  conversionQty: number;
  priceCents:    number | null;
  discountType:  string | null;
  discountValue: number | null;
  fromUnit:      { id: string; name: string; shortCode: string; allowDecimal: boolean };
  toUnit:        { id: string; name: string; shortCode: string };
}

export interface PosProduct {
  id: string;
  sku: string;
  barcode: string | null;
  name: string;
  categoryId: string | null;
  priceCents: number;
  costCents: number;
  defaultDiscountCents: number;
  serviceChargeCents: number;
  serviceChargeLabel: string | null;
  serviceChargeMode?: string;
  receiptName: string | null;
  taxPercent: number;
  imageUrl: string | null;
  expiryDate: string | null;
  expiryAlertDays: number;
  isBatchTracked: boolean;
  unitId:        string;
  baseUnitId:    string | null;
  purchaseUnitId:string | null;
  salesUnitId:   string | null;
  unit:       { id: string; shortCode: string; name: string; allowDecimal: boolean };
  baseUnit:   { id: string; shortCode: string; name: string; allowDecimal: boolean } | null;
  salesUnit:  { id: string; shortCode: string; name: string; allowDecimal: boolean } | null;
  unitConversions: PosUnitConversion[];
  stock: Array<{ qty: string }>;
  batchSummary: {
    sellableQty:     number;
    expiredQty:      number;
    expiringSoonQty: number;
    nearestExpiry:   string | null;
    expiryStatus:    'none' | 'ok' | 'expiring' | 'has_expired_batch';
    batchCount:      number;   // open batches — 2+ means the cashier gets to pick
  } | null;
}

export interface ProductsResponse {
  total: number;
  page: number;
  pageSize: number;
  data: PosProduct[];
}

export interface CheckoutLine {
  productId:      string;
  qty:            number;
  unitPriceCents?: number; // price override — requires adjust_sale_price permission
  unitId?:        string;  // unit used for this line; if omitted, uses base unit
  discountCents?: number;  // per-line discount amount in cents
  batchId?:       string;  // manually-picked StockBatch (multi-batch products)
}

// ─── Batch picker (multi-batch products) ───────────────────────────────────────

export interface ProductBatch {
  id:                string;
  qty:               number;
  unitCostCents:     number;
  sellingPriceCents: number;
  supplierId:        string | null;
  supplierName:      string | null;
  isDamaged:         boolean;         // accepted-damaged stock, sold at a reduced price
  batchNumber:       string | null;
  expiryDate:        string | null;
  receivedAt:        string;
  status:            'expired' | 'expiring_soon' | 'ok' | 'no_expiry';
}

export type AllPaymentMethods = 'CASH' | 'CARD' | 'BANK_TRANSFER' | 'QR_PAY' | 'CREDIT';

export interface CheckoutPayload {
  warehouseId: string;
  customerId?: string;
  paymentMethod: AllPaymentMethods;
  cartDiscountCents?: number;    // cart-level discount amount in cents
  cartDiscountPercent?: number;  // cart-level discount percent (0–100)
  cashAmountCents?: number;      // split payment: cash portion paid now (remainder = credit/outstanding)
  note?: string;
  items: CheckoutLine[];
  draftId?: string; // delete this draft after checkout
  isStaffSale?: boolean; // tag sale as staff purchase (requires staffSalesEnabled setting)
  redeemPoints?: number; // loyalty points to redeem (module-gated)
}

export interface ReceiptLine {
  product: { id: string; name: string; sku: string; receiptName?: string | null };
  qty: number;
  unitPriceCents: number;
  taxPercent: number;
  discountCents: number;  // per-line discount (0 if none)
  lineTotalCents: number;
  unitShortCode?: string;
}

export interface AppliedPromotion { promotionId: string; label: string; discountCents: number; }
export interface LoyaltyResult { earned: number; redeemed: number; }

export interface Receipt {
  id: string;
  number: string;
  date: string;
  cashier: string;
  customer: { id: string; name: string; phone: string | null } | null;
  paymentMethod: string;
  isCreditSale: boolean;
  isStaffSale: boolean;
  warehouseName: string;
  lines: ReceiptLine[];
  subtotalCents: number;
  taxCents: number;
  discountCents: number;
  totalCents: number;
  paidCents: number;
  promotions?: AppliedPromotion[];  // applied promos (display only)
  loyalty?: LoyaltyResult;          // points earned/redeemed (display only)
}

export interface PosSale {
  id: string;
  number: string;
  date: string;
  totalCents: number;
  paidCents: number;
  paymentMethod: string;
  customer: { name: string } | null;
  createdBy: { fullName: string };
  _count: { lines: number };
}

// ─── Draft types ──────────────────────────────────────────────────────────────

export interface PosDraftItem {
  id: string;
  productId: string;
  qty: number;
  unitPriceCents: number;
  product: {
    id: string;
    name: string;
    sku: string;
    priceCents: number;
    unit: { shortCode: string };
  };
}

export interface PosDraft {
  id: string;
  label: string | null;
  warehouseId: string;
  paymentMethod: AllPaymentMethods;
  discountCents: number;
  note: string | null;
  updatedAt: string;
  customer: { id: string; name: string } | null;
  warehouse: { id: string; name: string; code: string };
  items: PosDraftItem[];
}

export interface SaveDraftPayload {
  id?: string;
  label?: string | null;
  warehouseId: string;
  customerId?: string | null;
  paymentMethod: AllPaymentMethods;
  discountCents: number;
  note?: string | null;
  items: { productId: string; qty: number; unitPriceCents: number }[];
}

// ─── Customer credit ──────────────────────────────────────────────────────────

export interface CustomerCreditInfo {
  creditEnabled: boolean;
  balance: number;
  limit: number;
  available: number; // -1 = unlimited
  alertPct: number;
  settleDays?: number | null;
  isNearLimit: boolean;
  isOverLimit: boolean;
}

// ─── Shift types ──────────────────────────────────────────────────────────────

export interface PosShift {
  id: string;
  openedAt: string;
  openingCashCents: number;
  status: 'OPEN' | 'CLOSED';
}

// ─── API calls ────────────────────────────────────────────────────────────────

export const posApi = {
  getWarehouses: (): Promise<Warehouse[]> =>
    api.get('/pos/warehouses').then((r) => r.data),

  searchProducts: (params: {
    search?: string;
    warehouseId?: string;
    categoryId?: string;
    brandId?: string;
    page?: number;
    pageSize?: number;
  }): Promise<ProductsResponse> =>
    api.get('/pos/products', { params }).then((r) => r.data),

  getProductBatches: (productId: string, warehouseId: string): Promise<ProductBatch[]> =>
    api.get(`/pos/products/${productId}/batches`, { params: { warehouseId } }).then((r) => r.data),

  checkout: (payload: CheckoutPayload): Promise<{ receipt: Receipt; warnings?: string[]; promotions?: AppliedPromotion[]; loyalty?: LoyaltyResult }> =>
    // Longer timeout than the global default: the bundled offline PostgreSQL
    // can be slow to respond on a cold-start. Only the checkout POST is raised.
    api.post('/pos/checkout', payload, { timeout: 60000 }).then((r) => r.data),

  getReceipt: (id: string): Promise<Receipt> =>
    api.get(`/pos/receipt/${id}`).then((r) => r.data),

  listSales: (params?: {
    page?: number;
    pageSize?: number;
    search?: string;
    from?: string;
    to?: string;
  }): Promise<{ total: number; page: number; pageSize: number; data: PosSale[] }> =>
    api.get('/pos/sales', { params }).then((r) => r.data),

  // ── Drafts ──
  listDrafts: (): Promise<PosDraft[]> =>
    api.get('/pos/drafts').then((r) => r.data),

  saveDraft: (payload: SaveDraftPayload): Promise<PosDraft> =>
    api.post('/pos/drafts', payload).then((r) => r.data),

  deleteDraft: (id: string): Promise<{ success: boolean }> =>
    api.delete(`/pos/drafts/${id}`).then((r) => r.data),

  // Fill in a sale price the catalogue never had. Rejected server-side if the
  // product already has one — this is not a price override.
  setProductPrice: (productId: string, priceCents: number): Promise<{ id: string; name: string; priceCents: number }> =>
    api.patch(`/pos/products/${productId}/price`, { priceCents }).then((r) => r.data),

  // ── Customer credit ──
  getCustomerCredit: (customerId: string): Promise<CustomerCreditInfo> =>
    api.get(`/pos/customer-credit/${customerId}`).then((r) => r.data),

  // Shift calls live in services/shifts.ts — they need a warehouseId, which the
  // helpers that used to sit here never sent.
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Format integer cents as a currency string, e.g. 1050 → "$10.50" */
export function formatCents(cents: number): string {
  return `Rs. ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/** Returns days until expiry, or null if no expiry date */
export function daysUntilExpiry(expiryDate: string | null): number | null {
  if (!expiryDate) return null;
  const now = new Date();
  const exp = new Date(expiryDate);
  return Math.ceil((exp.getTime() - now.getTime()) / (1000 * 60 * 60 * 24));
}
