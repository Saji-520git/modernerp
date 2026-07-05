import { z } from 'zod';

export const stockListSchema = z.object({
  search: z.string().optional(),
  productId: z.string().cuid().optional(),
  warehouseId: z.string().cuid().optional(),
  // z.coerce.boolean() converts string "false" → true (JS truthy).
  // Use preprocess so the string "true" → true, everything else → false.
  lowStockOnly:  z.preprocess(v => v === 'true' || v === true, z.boolean()).default(false),
  outStockOnly:  z.preprocess(v => v === 'true' || v === true, z.boolean()).default(false),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(2000).default(20),
  sort: z.enum(['name', 'qty', 'sku']).default('name'),
  order: z.enum(['asc', 'desc']).default('asc'),
});

export const adjustmentSchema = z.object({
  productId: z.string().cuid(),
  warehouseId: z.string().cuid(),
  unitId: z.string().cuid().optional(),  // NEW — optional; absent means "qty is in base unit"
  qty: z.number().refine((n) => n !== 0, { message: 'Quantity cannot be zero' }),
  reason: z.string().trim().min(3, 'Reason must be at least 3 characters').max(500),
});

export const transferSchema = z
  .object({
    productId: z.string().cuid(),
    fromWarehouseId: z.string().cuid(),
    toWarehouseId: z.string().cuid(),
    qty: z.number().min(0.0001, 'Quantity must be greater than 0'),
    note: z.string().max(500).optional(),
  })
  .refine((d) => d.fromWarehouseId !== d.toWarehouseId, {
    message: 'Source and destination warehouse must be different',
    path: ['toWarehouseId'],
  });

export const writeOffSchema = z.object({
  batchId:    z.string().cuid(),
  warehouseId: z.string().cuid(),
  qty:        z.number().min(0.0001, 'Quantity must be greater than 0'),
  reason:     z.string().trim().min(3, 'Reason must be at least 3 characters').max(500),
});

export const movementsListSchema = z.object({
  productId: z.string().cuid().optional(),
  warehouseId: z.string().cuid().optional(),
  type: z
    .enum([
      'PURCHASE_IN',
      'SALE_OUT',
      'ADJUSTMENT',
      'TRANSFER_IN',
      'TRANSFER_OUT',
      'RETURN_IN',
      'RETURN_OUT',
      'WRITE_OFF',
    ])
    .optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(2000).default(20),
});

export type StockListInput = z.infer<typeof stockListSchema>;
export type AdjustmentInput = z.infer<typeof adjustmentSchema>;
export type TransferInput = z.infer<typeof transferSchema>;
export type WriteOffInput = z.infer<typeof writeOffSchema>;
export type MovementsListInput = z.infer<typeof movementsListSchema>;
