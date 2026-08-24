import { z } from 'zod';

export const supplierBodySchema = z.object({
  name: z.string().min(1, 'Name is required').max(200),
  phone: z.string().max(50).optional(),
  email: z.string().email('Invalid email').optional().or(z.literal('')),
  address: z.string().max(500).optional(),
  // Owed before this system went live. Never negative — prepaid credit has its
  // own field and ledger, and letting this go below zero would give one idea
  // two contradictory homes.
  openingBalanceCents: z.number().int().min(0).default(0),
  openingBalanceAsOf:  z.string().datetime().optional().nullable(),
});

export const listSuppliersSchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

export type SupplierBodyInput = z.infer<typeof supplierBodySchema>;
export type ListSuppliersInput = z.infer<typeof listSuppliersSchema>;
