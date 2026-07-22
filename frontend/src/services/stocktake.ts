import { api } from './api';

export type StockTakeStatus = 'DRAFT' | 'COMPLETED' | 'CANCELLED';

export interface StockTakeLine {
  id: string;
  productId: string;
  systemQty: string;              // Prisma Decimal → string
  countedQty: string | null;
  appliedQty: string | null;
  unitCostCents: number;
  note: string | null;
  product: {
    id: string; name: string; sku: string;
    unit?:     { shortCode: string } | null;
    baseUnit?: { shortCode: string } | null;
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
