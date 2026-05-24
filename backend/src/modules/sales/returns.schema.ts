import { z } from 'zod';

export const createReturnSchema = z.object({
  saleId: z.string().min(1, 'Invoice is required'),
  reason: z.string().max(500).optional(),
  lines: z
    .array(
      z.object({
        productId: z.string().min(1),
        qty: z.number().positive('Quantity must be positive'),
        unitPriceCents: z.number().int().nonnegative(),
        lineTotalCents: z.number().int().nonnegative(),
      }),
    )
    .min(1, 'At least one item is required'),
});

export const listReturnsSchema = z.object({
  search: z.string().optional(),
  saleId: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(15),
});

export type CreateReturnInput = z.infer<typeof createReturnSchema>;
export type ListReturnsInput = z.infer<typeof listReturnsSchema>;
