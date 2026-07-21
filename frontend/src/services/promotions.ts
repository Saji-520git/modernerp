import { api } from './api';

export type PromotionType  = 'PERCENT_OFF' | 'AMOUNT_OFF';
export type PromotionScope = 'ALL' | 'CATEGORY' | 'BRAND' | 'PRODUCT';

export interface Promotion {
  id: string;
  name: string;
  description: string | null;
  type: PromotionType;
  scope: PromotionScope;
  scopeCategoryId: string | null;
  scopeBrandId: string | null;
  scopeProductId: string | null;
  value: number;                 // percent (0-100) or cents
  minQty: string | number | null; // Prisma Decimal → string
  minCartCents: number | null;
  startsAt: string | null;
  endsAt: string | null;
  priority: number;
  stackable: boolean;
  maxDiscountCents: number | null;
  active: boolean;
  usageLimit: number | null;
  timesUsed: number;
  createdAt: string;
  updatedAt: string;
}

export interface PromotionInput {
  name: string;
  description?: string | null;
  type: PromotionType;
  scope: PromotionScope;
  scopeCategoryId?: string | null;
  scopeBrandId?: string | null;
  scopeProductId?: string | null;
  value: number;
  minQty?: number | null;
  minCartCents?: number | null;
  startsAt?: string | null;
  endsAt?: string | null;
  priority?: number;
  stackable?: boolean;
  maxDiscountCents?: number | null;
  active?: boolean;
  usageLimit?: number | null;
}

export interface AppliedPromo { promotionId: string; label: string; discountCents: number; }

export interface PromoPreviewResult {
  lineDiscounts: Record<string, number>;
  applied: AppliedPromo[];
  totalDiscountCents: number;
}

export interface PreviewItem {
  lineKey: string;
  productId: string;
  qty: number;
  lineAfterManualCents: number;
}

export const promotionsApi = {
  list: (): Promise<Promotion[]> =>
    api.get('/promotions').then((r) => r.data),
  create: (body: PromotionInput): Promise<Promotion> =>
    api.post('/promotions', body).then((r) => r.data),
  update: (id: string, body: Partial<PromotionInput>): Promise<Promotion> =>
    api.patch(`/promotions/${id}`, body).then((r) => r.data),
  remove: (id: string): Promise<{ success: boolean; deactivated: boolean }> =>
    api.delete(`/promotions/${id}`).then((r) => r.data),
  preview: (items: PreviewItem[]): Promise<PromoPreviewResult> =>
    api.post('/promotions/preview', { items }).then((r) => r.data),
};

export const PROMO_TYPE_LABEL: Record<PromotionType, string> = {
  PERCENT_OFF: '% off',
  AMOUNT_OFF:  'Amount off',
};

export const PROMO_SCOPE_LABEL: Record<PromotionScope, string> = {
  ALL:      'Whole cart',
  CATEGORY: 'Category',
  BRAND:    'Brand',
  PRODUCT:  'Product',
};
