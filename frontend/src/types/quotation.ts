// Quotation module shared types. Dates are ISO strings. Money is integer cents.

export type QuotationStatus =
  | 'DRAFT'
  | 'SENT'
  | 'ACCEPTED'
  | 'REJECTED'
  | 'EXPIRED'
  | 'CONVERTED';

// Tailwind class hints for status badges.
export const QUOTATION_STATUS_COLORS: Record<QuotationStatus, string> = {
  DRAFT:     'bg-gray-100 text-gray-700',
  SENT:      'bg-blue-100 text-blue-700',
  ACCEPTED:  'bg-green-100 text-green-700',
  REJECTED:  'bg-red-100 text-red-700',
  EXPIRED:   'bg-amber-100 text-amber-700',
  CONVERTED: 'bg-purple-100 text-purple-700',
};

export interface QuotationLine {
  id: string;
  quotationId: string;
  productId: string | null;
  description: string;
  qty: number;
  unitLabel: string;
  unitPriceCents: number;
  discountCents: number;
  totalCents: number;
  sortOrder: number;
  product?: { id: string; name: string } | null;
  createdAt: string;
  updatedAt: string;
}

export interface Quotation {
  id: string;
  number: string;
  customerId: string | null;
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
  createdById: string;
  deletedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Relations (present depending on endpoint)
  customer?: { id: string; name: string; phone: string | null } | null;
  lines?: QuotationLine[];
  deliveries?: { id: string; number: string; status: string }[];
  createdBy?: { fullName: string } | null;
  convertedToSale?: { id: string; number: string } | null;
  _count?: { lines: number };
}

export interface QuotationLineInput {
  productId?: string | null;
  description: string;
  qty: number;
  unitLabel?: string;
  unitPriceCents: number;
  discountCents?: number;
  sortOrder?: number;
}

export interface CreateQuotationDto {
  customerId?: string | null;
  title?: string | null;
  validUntil?: string | null;
  note?: string | null;
  termsConditions?: string | null;
  lines: QuotationLineInput[];
}

export interface UpdateQuotationDto {
  title?: string | null;
  validUntil?: string | null;
  note?: string | null;
  termsConditions?: string | null;
  lines?: QuotationLineInput[];
}

export interface QuotationStats {
  totalThisMonth: number;
  byStatus: Record<QuotationStatus, number>;
  conversionRate: number;
  totalValueAcceptedCents: number;
}

export interface QuotationFilters {
  customerId?: string;
  status?: string;
  search?: string;
  from?: string;
  to?: string;
}
