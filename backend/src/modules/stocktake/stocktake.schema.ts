import { z } from 'zod';

export const createStockTakeSchema = z.object({
  warehouseId: z.string().cuid(),
  categoryId:  z.string().cuid().nullable().optional(), // optional scope filter
  note:        z.string().max(500).nullable().optional(),
});

export const saveCountsSchema = z.object({
  lines: z.array(z.object({
    lineId:     z.string(),
    countedQty: z.number().min(0).nullable(),  // null = not counted yet
    note:       z.string().max(300).nullable().optional(),
  })).min(1),
});

export type CreateStockTakeInput = z.infer<typeof createStockTakeSchema>;
export type SaveCountsInput = z.infer<typeof saveCountsSchema>;
