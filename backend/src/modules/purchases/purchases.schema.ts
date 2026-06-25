import { z } from 'zod';

// ─── Line item ────────────────────────────────────────────────────────────────

export const purchaseLineInputSchema = z.object({
  productId:    z.string().cuid('Invalid product'),
  qty:          z.number().min(0.0001, 'Quantity must be greater than 0'),
  unitCostCents:z.number().int().nonnegative('Cost cannot be negative'),
  taxPercent:   z.number().min(0).max(100).default(0),
  unitId:       z.string().optional(),  // if set, qty is in this unit; backend converts to base
  expiryDate:   z.string().datetime().optional().nullable(), // batch expiry date
});

// ─── Create PO ────────────────────────────────────────────────────────────────

export const createPurchaseSchema = z.object({
  supplierId: z.string().cuid('Invalid supplier'),
  warehouseId: z.string().cuid('Invalid warehouse'),
  date: z.string().datetime().optional(),
  note: z.string().max(500).optional(),
  lines: z
    .array(purchaseLineInputSchema)
    .min(1, 'At least one line item is required'),
});

// ─── List POs ─────────────────────────────────────────────────────────────────

export const listPurchasesSchema = z.object({
  search: z.string().optional(),
  status: z.enum(['DRAFT', 'CONFIRMED', 'CANCELLED']).optional(),
  supplierId: z.string().optional(),
  from: z.string().optional(),
  to: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

// ─── Update PO (DRAFT only) ───────────────────────────────────────────────────

export const updatePurchaseSchema = z.object({
  supplierId:  z.string().cuid().optional(),
  warehouseId: z.string().cuid().optional(),
  date:        z.string().datetime().optional(),
  note:        z.string().max(500).optional().nullable(),
  lines:       z.array(purchaseLineInputSchema).min(1).optional(),
});

// ─── From alerts (auto-PO) ────────────────────────────────────────────────────

export const fromAlertsSchema = z.object({
  warehouseId: z.string().min(1, 'Warehouse is required'),
  supplierId:  z.string().min(1, 'Supplier is required'),
  items: z.array(z.object({
    productId:     z.string().min(1),
    qty:           z.number().min(0.0001, 'Quantity must be greater than 0'),
    unitCostCents: z.number().int().min(0).optional(),
  })).min(1, 'Select at least one product'),
  note: z.string().max(500).optional(),
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type CreatePurchaseInput = z.infer<typeof createPurchaseSchema>;
export type UpdatePurchaseInput = z.infer<typeof updatePurchaseSchema>;
export type ListPurchasesInput  = z.infer<typeof listPurchasesSchema>;
export type FromAlertsInput     = z.infer<typeof fromAlertsSchema>;
