import { z } from 'zod';
import { localDayEnd } from '../../utils/local-date.js';

const lineSchema = z.object({
  productId:      z.string().nullable().optional(),  // null = free-text line
  description:    z.string().min(1).max(300),
  qty:            z.number().positive(),
  unitLabel:      z.string().min(1).max(30).default('pcs'),
  unitPriceCents: z.number().int().min(0),
  discountCents:  z.number().int().min(0).default(0),
});

export const createQuotationSchema = z.object({
  customerId:      z.string().nullable().optional(),
  title:           z.string().max(200).nullable().optional(),
  // Valid THROUGH that day on the shop's clock, not until 05:30 that morning.
  validUntil:      z.union([z.string(), z.date()]).nullable().optional()
                     .transform((v) => (v == null ? v : localDayEnd(typeof v === 'string' ? v : v.toISOString()))),
  discountCents:   z.number().int().min(0).default(0),   // quote-level discount
  taxCents:        z.number().int().min(0).default(0),   // quote-level tax
  note:            z.string().max(1000).nullable().optional(),
  termsConditions: z.string().max(2000).nullable().optional(),
  lines:           z.array(lineSchema).min(1, 'Add at least one line'),
});

export const updateQuotationSchema = createQuotationSchema;

export const setStatusSchema = z.object({
  status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED']),
});

export const convertSchema = z.object({
  warehouseId: z.string(),
});

export type CreateQuotationInput = z.infer<typeof createQuotationSchema>;
export type UpdateQuotationInput = z.infer<typeof updateQuotationSchema>;
export type SetStatusInput = z.infer<typeof setStatusSchema>;
export type ConvertInput = z.infer<typeof convertSchema>;
