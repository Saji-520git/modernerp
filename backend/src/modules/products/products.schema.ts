import { z } from 'zod';

export const listProductsSchema = z.object({
  search:     z.string().optional(),
  categoryId: z.string().optional(),
  brandId:    z.string().optional(),
  isActive:   z.enum(['true', 'false', 'all']).optional().default('true'),
  page:       z.coerce.number().int().min(1).default(1),
  pageSize:   z.coerce.number().int().min(1).max(100).default(20),
});

export const createProductSchema = z.object({
  name:         z.string().min(1, 'Name is required'),
  sku:          z.string().optional(),
  barcode:      z.string().optional().nullable(),
  description:  z.string().optional().nullable(),
  categoryId:   z.string().optional().nullable(),
  brandId:      z.string().optional().nullable(),
  unitId:       z.string().min(1, 'Unit is required'),
  // Unit conversion fields (optional — if not set, all default to unitId)
  baseUnitId:     z.string().optional().nullable(),
  purchaseUnitId: z.string().optional().nullable(),
  salesUnitId:    z.string().optional().nullable(),
  costCents:    z.number().int().min(0).default(0),
  priceCents:   z.number().int().min(0).default(0),
  taxPercent:   z.number().min(0).max(100).default(0),
  reorderLevel:    z.number().int().min(0).default(0),
  reorderQty:      z.number().int().min(0).default(0),
  isActive:        z.boolean().default(true),
  imageUrl:        z.string().optional().nullable(),
  expiryDate:      z.coerce.date().optional().nullable(),
  expiryAlertDays: z.number().int().min(1).max(365).default(30),
});

export const updateProductSchema = createProductSchema.partial();

export type ListProductsInput  = z.infer<typeof listProductsSchema>;
export type CreateProductInput = z.infer<typeof createProductSchema>;
export type UpdateProductInput = z.infer<typeof updateProductSchema>;
