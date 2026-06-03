import { z } from 'zod';

// ─── BOM ──────────────────────────────────────────────────────────────────────

const bomLineSchema = z.object({
  materialId: z.string().min(1, 'Material is required'),
  qty: z.number().positive('Quantity must be greater than 0'),
  wastePct: z.number().min(0).max(100).optional(),
  notes: z.string().max(500).optional().nullable(),
});

export const createBOMSchema = z.object({
  productId: z.string().min(1, 'Finished product is required'),
  name: z.string().min(1, 'Name is required').max(200),
  yieldQty: z.number().positive().optional(),
  notes: z.string().max(2000).optional().nullable(),
  lines: z.array(bomLineSchema).min(1, 'A BOM needs at least one material line'),
});

export const updateBOMSchema = z.object({
  name: z.string().min(1).max(200).optional(),
  yieldQty: z.number().positive().optional(),
  notes: z.string().max(2000).optional().nullable(),
  isActive: z.boolean().optional(),
  lines: z.array(bomLineSchema).min(1).optional(),
});

// ─── Production orders ──────────────────────────────────────────────────────────

export const createProductionOrderSchema = z.object({
  productId: z.string().min(1, 'Finished product is required'),
  warehouseId: z.string().min(1, 'Warehouse is required'),
  quantity: z.number().positive('Quantity must be greater than 0'),
  notes: z.string().max(2000).optional().nullable(),
});

export type CreateBOMBody = z.infer<typeof createBOMSchema>;
export type UpdateBOMBody = z.infer<typeof updateBOMSchema>;
export type CreateProductionOrderBody = z.infer<typeof createProductionOrderSchema>;
