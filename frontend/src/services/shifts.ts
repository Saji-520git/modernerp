import { api } from './api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface PosShift {
  id: string;
  userId: string;
  user: { id: string; fullName: string };
  warehouseId: string;
  warehouse: { id: string; name: string; code: string };
  status: 'OPEN' | 'CLOSED';
  openedAt: string;
  closedAt: string | null;
  openingCashCents: number;
  closingCashCents: number | null;
  cashSalesCents: number;
  cardSalesCents: number;
  bankTransferCents: number;
  qrPayCents: number;
  creditSalesCents: number;
  totalSalesCents: number;
  saleCount: number;
  expectedCashCents: number | null;
  varianceCents: number | null;
  note: string | null;
  forceClosedBy?: { id: string; fullName: string } | null;
}

export interface ShiftWithSales extends PosShift {
  sales: {
    id: string;
    number: string;
    totalCents: number;
    paymentMethod: string;
    createdAt: string;
    customer: { name: string } | null;
  }[];
}

export interface OpenShiftPayload {
  warehouseId: string;
  openingCash: number;
}

export interface CloseShiftPayload {
  shiftId: string;
  closingCash: number;
  note?: string;
}

export interface ShiftsListResponse {
  total: number;
  page: number;
  pageSize: number;
  data: PosShift[];
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const shiftsApi = {
  open: (data: OpenShiftPayload) =>
    api.post<PosShift>('/pos/shifts/open', data).then((r) => r.data),

  current: (warehouseId: string) =>
    api.get<PosShift | null>('/pos/shifts/current', { params: { warehouseId } }).then((r) => r.data),

  close: (data: CloseShiftPayload) =>
    api.post<PosShift>('/pos/shifts/close', data).then((r) => r.data),

  forceClose: (id: string, note?: string) =>
    api.post<PosShift>(`/pos/shifts/${id}/force-close`, { note }).then((r) => r.data),

  list: (params?: {
    page?: number;
    pageSize?: number;
    warehouseId?: string;
    userId?: string;
    status?: 'OPEN' | 'CLOSED';
    from?: string;
    to?: string;
  }) =>
    api.get<ShiftsListResponse>('/pos/shifts', { params }).then((r) => r.data),

  getOne: (id: string) =>
    api.get<ShiftWithSales>(`/pos/shifts/${id}`).then((r) => r.data),
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

export function formatShiftDuration(openedAt: string, closedAt: string | null): string {
  const end = closedAt ? new Date(closedAt) : new Date();
  const ms  = end.getTime() - new Date(openedAt).getTime();
  const h   = Math.floor(ms / 3_600_000);
  const m   = Math.floor((ms % 3_600_000) / 60_000);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
