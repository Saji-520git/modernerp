import { api } from './api';

export type QuotationStatus = 'DRAFT' | 'SENT' | 'ACCEPTED' | 'REJECTED' | 'EXPIRED' | 'CONVERTED';

export interface QuotationLine {
  id: string;
  productId: string | null;
  description: string;
  qty: number;
  unitLabel: string;
  unitPriceCents: number;
  discountCents: number;
  totalCents: number;
  sortOrder: number;
}

export interface Quotation {
  id: string;
  number: string;
  customerId: string | null;
  customer?: { id: string; name: string; phone?: string | null; email?: string | null; address?: string | null } | null;
  title: string | null;
  status: QuotationStatus;
  validUntil: string | null;
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
  note: string | null;
  termsConditions: string | null;
  convertedToSaleId: string | null;
  convertedAt: string | null;
  createdAt: string;
  lines: QuotationLine[];
  _count?: { lines: number };
}

export interface QuotationLineInput {
  productId?: string | null;
  description: string;
  qty: number;
  unitLabel: string;
  unitPriceCents: number;
  discountCents: number;
}

export interface QuotationInput {
  customerId?: string | null;
  title?: string | null;
  validUntil?: string | null;
  discountCents: number;
  taxCents: number;
  note?: string | null;
  termsConditions?: string | null;
  lines: QuotationLineInput[];
}

export const quotationsApi = {
  list: (): Promise<Quotation[]> => api.get('/quotations').then((r) => r.data),
  get: (id: string): Promise<Quotation> => api.get(`/quotations/${id}`).then((r) => r.data),
  create: (body: QuotationInput): Promise<Quotation> => api.post('/quotations', body).then((r) => r.data),
  update: (id: string, body: QuotationInput): Promise<Quotation> => api.patch(`/quotations/${id}`, body).then((r) => r.data),
  setStatus: (id: string, status: QuotationStatus): Promise<Quotation> => api.patch(`/quotations/${id}/status`, { status }).then((r) => r.data),
  remove: (id: string): Promise<{ success: boolean }> => api.delete(`/quotations/${id}`).then((r) => r.data),
  convert: (id: string, warehouseId: string): Promise<{ saleId: string; saleNumber: string }> =>
    api.post(`/quotations/${id}/convert`, { warehouseId }).then((r) => r.data),
};

export const QUOTATION_STATUS_COLORS: Record<QuotationStatus, string> = {
  DRAFT:     'bg-slate-100 text-slate-600',
  SENT:      'bg-blue-100 text-blue-700',
  ACCEPTED:  'bg-green-100 text-green-700',
  REJECTED:  'bg-red-100 text-red-700',
  EXPIRED:   'bg-amber-100 text-amber-700',
  CONVERTED: 'bg-indigo-100 text-indigo-700',
};
