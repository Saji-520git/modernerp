import { z } from 'zod';

export const unitTypeValues = ['COUNT', 'WEIGHT', 'VOLUME', 'LENGTH', 'OTHER'] as const;

export const createUnitSchema = z.object({
  name:         z.string().min(1, 'Name is required').max(100),
  shortCode:    z.string().min(1, 'Short code is required').max(10),
  type:         z.enum(unitTypeValues).default('COUNT'),
  allowDecimal: z.boolean().default(false),
  isActive:     z.boolean().default(true),
});

export const updateUnitSchema = createUnitSchema.partial();

export const listUnitsSchema = z.object({
  search:   z.string().optional(),
  type:     z.enum(unitTypeValues).optional(),
  isActive: z.enum(['true', 'false', 'all']).optional().default('all'),
  page:     z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export type CreateUnitInput = z.infer<typeof createUnitSchema>;
export type UpdateUnitInput = z.infer<typeof updateUnitSchema>;
export type ListUnitsInput  = z.infer<typeof listUnitsSchema>;
