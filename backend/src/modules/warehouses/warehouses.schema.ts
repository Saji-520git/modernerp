import { z } from 'zod';

export const CreateWarehouseSchema = z.object({
  name:      z.string().min(1).max(100),
  code:      z.string().min(1).max(20)
              .regex(/^[A-Z0-9_-]+$/, 'Code must be uppercase letters, numbers, _ or -'),
  address:   z.string().max(500).optional().nullable(),
  city:      z.string().max(100).optional().nullable(),
  phone:     z.string().max(50).optional().nullable(),
  email:     z.string().email().optional().nullable(),
  managerId: z.string().optional().nullable(),
  type:      z.enum(['MAIN', 'BRANCH', 'STORE', 'TRANSIT', 'VIRTUAL']).default('BRANCH'),
  isDefault: z.boolean().default(false),
  notes:     z.string().max(1000).optional().nullable(),
});

export const UpdateWarehouseSchema = CreateWarehouseSchema.partial();

export const ListWarehousesSchema = z.object({
  page:     z.coerce.number().default(1),
  pageSize: z.coerce.number().default(20),
  search:   z.string().optional(),
  type:     z.string().optional(),
  isActive: z.coerce.boolean().optional(),
});

export type CreateWarehouseInput = z.infer<typeof CreateWarehouseSchema>;
export type UpdateWarehouseInput = z.infer<typeof UpdateWarehouseSchema>;
export type ListWarehousesInput  = z.infer<typeof ListWarehousesSchema>;
