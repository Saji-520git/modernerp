import { z } from 'zod';

// ─── Line item ────────────────────────────────────────────────────────────────

export const saleLineInputSchema = z.object({
  productId: z.string().cuid('Invalid product'),
  qty: z.number().positive('Quantity must be greater than 0'),
  unitPriceCents: z.number().int().nonnegative('Price cannot be negative'),
  taxPercent: z.number().min(0).max(100).default(0),
  discountCents: z.number().int().nonnegative().default(0),
});

// ─── Create invoice ───────────────────────────────────────────────────────────

export const createSaleSchema = z.object({
  customerId: z.string().cuid().optional(),
  warehouseId: z.string().cuid('Invalid warehouse'),
  date: z.string().datetime().optional(),
  note: z.string().max(500).optional(),
  lines: z.array(saleLineInputSchema).min(1, 'At least one line item is required'),
});

// ─── List invoices ────────────────────────────────────────────────────────────

export const listSalesSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['DRAFT', 'CONFIRMED', 'CANCELLED']).optional(),
  paymentMethod: z.string().optional(),
  customerId: z.string().optional(),
  warehouseId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  includePos: z.enum(['true', 'false']).optional().default('true'),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(200).default(25),
});

// ─── Update invoice (DRAFT only) ─────────────────────────────────────────────

export const updateSaleSchema = z.object({
  customerId:   z.string().cuid().optional().nullable(),
  warehouseId:  z.string().cuid().optional(),
  date:         z.string().datetime().optional(),
  note:         z.string().max(500).optional().nullable(),
  discountCents:z.number().int().nonnegative().optional(),
  lines:        z.array(saleLineInputSchema).min(1).optional(),
});

// ─── Record payment ───────────────────────────────────────────────────────────

export const recordPaymentSchema = z.object({
  paidCents: z.number().int().nonnegative(),
  paymentMethod: z.enum(['CASH', 'CARD', 'BANK_TRANSFER', 'QR_PAY', 'CREDIT']),
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type CreateSaleInput     = z.infer<typeof createSaleSchema>;
export type UpdateSaleInput     = z.infer<typeof updateSaleSchema>;
export type ListSalesInput      = z.infer<typeof listSalesSchema>;
export type RecordPaymentInput  = z.infer<typeof recordPaymentSchema>;
