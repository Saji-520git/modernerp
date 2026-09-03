import { z } from 'zod';
import { localDayStart, localDayEnd } from '../../utils/local-date.js';

export const createPromotionSchema = z.object({
  name:             z.string().min(1).max(200),
  description:      z.string().max(500).nullable().optional(),
  type:             z.enum(['PERCENT_OFF', 'AMOUNT_OFF']),
  scope:            z.enum(['ALL', 'CATEGORY', 'BRAND', 'PRODUCT']).default('ALL'),
  scopeCategoryId:  z.string().nullable().optional(),
  scopeBrandId:     z.string().nullable().optional(),
  scopeProductId:   z.string().nullable().optional(),
  value:            z.number().int().min(0),
  minQty:           z.number().min(0).nullable().optional(),
  minCartCents:     z.number().int().min(0).nullable().optional(),
  // A promotion runs for whole SHOP days. Coerced as a plain date these were
  // UTC midnight, so at +5:30 one advertised "until the 3rd" stopped working at
  // 05:30 that morning and lost 18 hours of its last day. A value carrying a
  // real time is passed through untouched, so a timed promotion still works.
  startsAt:         z.union([z.string(), z.date()]).nullable().optional()
                      .transform((v) => (v == null ? v : localDayStart(typeof v === 'string' ? v : v.toISOString()))),
  endsAt:           z.union([z.string(), z.date()]).nullable().optional()
                      .transform((v) => (v == null ? v : localDayEnd(typeof v === 'string' ? v : v.toISOString()))),
  priority:         z.number().int().min(0).default(0),
  stackable:        z.boolean().default(false),
  maxDiscountCents: z.number().int().min(0).nullable().optional(),
  active:           z.boolean().default(true),
  usageLimit:       z.number().int().min(1).nullable().optional(),
}).superRefine((v, ctx) => {
  if (v.type === 'PERCENT_OFF' && v.value > 100) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['value'], message: 'Percentage cannot exceed 100' });
  }
  if (v.scope === 'CATEGORY' && !v.scopeCategoryId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scopeCategoryId'], message: 'Select a category' });
  }
  if (v.scope === 'BRAND' && !v.scopeBrandId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scopeBrandId'], message: 'Select a brand' });
  }
  if (v.scope === 'PRODUCT' && !v.scopeProductId) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['scopeProductId'], message: 'Select a product' });
  }
  if (v.startsAt && v.endsAt && v.endsAt < v.startsAt) {
    ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['endsAt'], message: 'End date must be after start date' });
  }
});

export const updatePromotionSchema = createPromotionSchema.innerType().partial();

export const previewSchema = z.object({
  items: z.array(z.object({
    lineKey:              z.string().optional(),
    productId:            z.string(),
    qty:                  z.number().min(0),
    lineAfterManualCents: z.number().int().min(0),
  })).min(1),
});

export type CreatePromotionInput = z.infer<typeof createPromotionSchema>;
export type UpdatePromotionInput = z.infer<typeof updatePromotionSchema>;
export type PreviewInput = z.infer<typeof previewSchema>;
