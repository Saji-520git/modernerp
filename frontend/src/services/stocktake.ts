import { api } from './api';

export type StockTakeStatus = 'DRAFT' | 'COMPLETED' | 'CANCELLED';

export interface StockUnitRef {
  id: string; shortCode: string; name: string; allowDecimal: boolean; type: string;
}

export interface StockTakeLine {
  id: string;
  productId: string;
  systemQty: string;              // Prisma Decimal → string (BASE units)
  countedQty: string | null;      // count as entered, in countUnit
  countUnitId: string | null;
  appliedQty: string | null;      // posted adjustment (BASE units)
  unitCostCents: number;
  note: string | null;
  product: {
    id: string; name: string; sku: string;
    baseUnitId: string | null; unitId: string;
    unit?:     StockUnitRef | null;
    baseUnit?: StockUnitRef | null;
    unitConversions?: Array<{
      conversionQty: string | number;
      fromUnit: StockUnitRef;
      toUnit: { id: string };
    }>;
  };
}

export interface StockTake {
  id: string;
  number: string;
  warehouseId: string;
  warehouse: { id: string; name: string; code: string };
  status: StockTakeStatus;
  note: string | null;
  completedAt: string | null;
  createdAt: string;
  lines?: StockTakeLine[];
  _count?: { lines: number };
}

export interface CreateStockTakeBody {
  warehouseId: string;
  categoryId?: string | null;
  note?: string | null;
}

export interface SaveCountLine {
  lineId: string;
  countedQty: number | null;
  countUnitId?: string | null;  // unit the count was entered in (null = base)
  note?: string | null;
}

export const stockTakeApi = {
  list: (): Promise<StockTake[]> =>
    api.get('/stock-takes').then((r) => r.data),
  getById: (id: string): Promise<StockTake> =>
    api.get(`/stock-takes/${id}`).then((r) => r.data),
  create: (body: CreateStockTakeBody): Promise<StockTake> =>
    api.post('/stock-takes', body).then((r) => r.data),
  saveCounts: (id: string, lines: SaveCountLine[]): Promise<StockTake> =>
    api.patch(`/stock-takes/${id}/counts`, { lines }).then((r) => r.data),
  confirm: (id: string): Promise<StockTake> =>
    api.post(`/stock-takes/${id}/confirm`).then((r) => r.data),
  cancel: (id: string): Promise<{ success: boolean }> =>
    api.post(`/stock-takes/${id}/cancel`).then((r) => r.data),
};

export const STOCKTAKE_STATUS_COLORS: Record<StockTakeStatus, string> = {
  DRAFT:     'bg-amber-100 text-amber-700',
  COMPLETED: 'bg-green-100 text-green-700',
  CANCELLED: 'bg-slate-100 text-slate-500',
};
