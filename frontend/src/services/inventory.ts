import { api } from './api';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExpiryStatus = 'none' | 'ok' | 'expiring' | 'has_expired_batch';

export interface BatchDetail {
  id: string;
  qty: number;
  unitCostCents: number;         // this batch's own cost per base unit — cost visibility
  batchNumber: string | null;
  expiryDate: string | null;
  receivedAt: string;
  status: 'expired' | 'expiring_soon' | 'ok' | 'no_expiry';
}

export interface StockRow {
  id: string;
  qty: number;
  /** Units sold that stock could not cover (allowNegativeStock). 0 normally. */
  shortfallQty: number;
  /** qty − shortfallQty — what the shelf actually owes. Negative when oversold. */
  effectiveQty: number;
  isOversold: boolean;
  isLowStock: boolean;
  // Batch expiry fields (populated from getBatchSummary)
  sellableQty:      number;
  expiredQty:       number;
  expiringSoonQty:  number;
  nearestExpiry:    string | null;
  expiryStatus:     ExpiryStatus;
  // Valuation fields
  stockValueCents:  number;
  product: {
    id: string;
    name: string;
    sku: string;
    costCents: number;
    reorderLevel: number;
    reorderQty: number;
    baseUnitId: string | null;
    unit: { id: string; shortCode: string; allowDecimal: boolean };
    baseUnit: { id: string; shortCode: string; allowDecimal: boolean } | null;
    unitConversions: Array<{
      fromUnitId: string;
      toUnitId: string;
      conversionQty: number;
      fromUnit: { id: string; shortCode: string; allowDecimal: boolean };
    }>;
    category: { name: string } | null;
  };
  warehouse: { id: string; name: string; code: string };
}

export interface StockListResponse {
  total: number;
  page: number;
  pageSize: number;
  totalStockValueCents: number;
  data: StockRow[];
}

export interface Warehouse {
  id:        string;
  name:      string;
  code:      string;
  city:      string | null;
  type:      string;
  isDefault: boolean;
  isActive:  boolean;
}

export interface AdjustmentPayload {
  productId: string;
  warehouseId: string;
  unitId?: string;
  qty: number;
  reason: string;
}

export interface TransferPayload {
  productId: string;
  fromWarehouseId: string;
  toWarehouseId: string;
  qty: number;
  note?: string;
}

export type MovementType =
  | 'PURCHASE_IN'
  | 'SALE_OUT'
  | 'ADJUSTMENT'
  | 'TRANSFER_IN'
  | 'TRANSFER_OUT'
  | 'RETURN_IN'
  | 'RETURN_OUT'
  | 'WRITE_OFF';

export interface WriteOffPayload {
  batchId:    string;
  warehouseId: string;
  qty:        number;
  reason:     string;
}

export interface WriteOffResult {
  batchId:     string;
  productId:   string;
  warehouseId: string;
  qty:         number;
  lossCents:   number;
  expense:     { id: string; amount: number; reference: string };
  reason:      string;
}

export interface Movement {
  id: string;
  type: MovementType;
  qty: number;
  refType: string | null;
  refId: string | null;
  note: string | null;
  createdAt: string;
  product: { id: string; name: string; sku: string };
  warehouse: { id: string; name: string; code: string };
}

export interface MovementsResponse {
  total: number;
  page: number;
  pageSize: number;
  data: Movement[];
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const inventoryApi = {
  listStock: (params?: {
    search?: string;
    productId?: string;
    warehouseId?: string;
    lowStockOnly?: boolean;
    outStockOnly?: boolean;
    page?: number;
    pageSize?: number;
  }): Promise<StockListResponse> =>
    api.get('/inventory/stock', { params }).then((r) => r.data),

  getLowStock: (): Promise<StockRow[]> =>
    api.get('/inventory/low-stock').then((r) => r.data),

  listExpiring: (): Promise<Array<{ product: { id: string; name: string; sku: string }; warehouse: { id: string; name: string }; totalQty: number; sellableQty: number; expiredQty: number; expiringSoonQty: number; nearestExpiry: string | null; expiryStatus: ExpiryStatus }>> =>
    api.get('/inventory/expiring').then((r) => r.data),

  getBatchDetail: (productId: string, warehouseId: string): Promise<BatchDetail[]> =>
    api.get(`/inventory/batches/${productId}/${warehouseId}`).then((r) => r.data),

  getWarehouses: (): Promise<Warehouse[]> =>
    api.get('/inventory/warehouses').then((r) => r.data),

  createAdjustment: (payload: AdjustmentPayload) =>
    api.post('/inventory/adjustments', payload).then((r) => r.data),

  createTransfer: (payload: TransferPayload) =>
    api.post('/inventory/transfers', payload).then((r) => r.data),

  writeOff: (payload: WriteOffPayload): Promise<WriteOffResult> =>
    api.post('/inventory/write-off', payload).then((r) => r.data),

  listMovements: (params?: {
    productId?: string;
    warehouseId?: string;
    type?: MovementType;
    from?: string;
    to?: string;
    page?: number;
    pageSize?: number;
  }): Promise<MovementsResponse> =>
    api.get('/inventory/movements', { params }).then((r) => r.data),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const MOVEMENT_LABELS: Record<MovementType, string> = {
  PURCHASE_IN:  'Purchase In',
  SALE_OUT:     'Sale Out',
  ADJUSTMENT:   'Adjustment',
  TRANSFER_IN:  'Transfer In',
  TRANSFER_OUT: 'Transfer Out',
  RETURN_IN:    'Return In',
  RETURN_OUT:   'Return Out',
  WRITE_OFF:    'Write-Off',
};

export const MOVEMENT_COLORS: Record<MovementType, string> = {
  PURCHASE_IN:  'bg-green-100 text-green-700',
  SALE_OUT:     'bg-blue-100 text-blue-700',
  ADJUSTMENT:   'bg-yellow-100 text-yellow-700',
  TRANSFER_IN:  'bg-purple-100 text-purple-700',
  TRANSFER_OUT: 'bg-orange-100 text-orange-700',
  RETURN_IN:    'bg-teal-100 text-teal-700',
  RETURN_OUT:   'bg-red-100 text-red-700',
  WRITE_OFF:    'bg-red-100 text-red-800',
};

// ─── Movement sign ────────────────────────────────────────────────────────────
//
// The backend stores StockMovement.qty signed by direction (+in / -out) and
// enforces it centrally in recordStockMovement. This derives the sign from the
// type anyway, as defence-in-depth: it keeps rows written before that fix (where
// non-POS SALE_OUT and RETURN_OUT were stored positive) rendering correctly on
// any database that has not had the backfill migration applied.
//
// Idempotent — correctly-signed rows pass through unchanged.
const MOVEMENT_OUT_TYPES: MovementType[] = ['SALE_OUT', 'RETURN_OUT', 'TRANSFER_OUT', 'WRITE_OFF'];
const MOVEMENT_IN_TYPES:  MovementType[] = ['PURCHASE_IN', 'RETURN_IN', 'TRANSFER_IN'];

export function signedMovementQty(type: MovementType, qty: number): number {
  if (MOVEMENT_OUT_TYPES.includes(type)) return -Math.abs(qty);
  if (MOVEMENT_IN_TYPES.includes(type))  return  Math.abs(qty);
  return qty; // ADJUSTMENT (and any unknown) — carries its own signed delta
}
