import { z } from 'zod';

const lineSchema = z.object({
  productId: z.string().min(1).optional().nullable(),
  description: z.string().min(1, 'Description is required'),
  qty: z.number().positive('Quantity must be greater than 0'),
  unitLabel: z.string().min(1).default('pcs'),
  unitPriceCents: z.number().int().min(0),
  discountCents: z.number().int().min(0).optional(),
  sortOrder: z.number().int().min(0).optional(),
});

export const createQuotationSchema = z.object({
  customerId: z.string().min(1).optional().nullable(),
  title: z.string().max(200).optional().nullable(),
  validUntil: z.string().datetime().optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
  termsConditions: z.string().max(4000).optional().nullable(),
  lines: z.array(lineSchema).min(1, 'A quotation needs at least one line'),
});

export const updateQuotationSchema = z.object({
  title: z.string().max(200).optional().nullable(),
  validUntil: z.string().datetime().optional().nullable(),
  note: z.string().max(2000).optional().nullable(),
  termsConditions: z.string().max(4000).optional().nullable(),
  lines: z.array(lineSchema).min(1).optional(),
});

export const quotationStatusSchema = z.object({
  status: z.enum(['DRAFT', 'SENT', 'ACCEPTED', 'REJECTED', 'EXPIRED', 'CONVERTED']),
});

export type CreateQuotationBody = z.infer<typeof createQuotationSchema>;
export type UpdateQuotationBody = z.infer<typeof updateQuotationSchema>;
