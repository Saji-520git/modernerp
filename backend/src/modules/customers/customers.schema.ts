import { z } from 'zod';

export const customerBodySchema = z.object({
  name:              z.string().min(1, 'Name is required').max(200),
  // Phone is REQUIRED for registered customers (walk-in POS sales use
  // Sale.customerId=null and never hit this schema). The Prisma column stays
  // String? so pre-existing records with NULL phones remain readable.
  phone:             z.string().trim().min(7, 'Phone is required').max(20)
                       .regex(/^[+\d][\d\s\-]*$/, 'Invalid phone'),
  // Accept: valid email string | empty string | null | undefined — all stored as null
  email:             z.preprocess(
    (v) => (v === '' || v === null || v === undefined ? null : v),
    z.string().email('Invalid email format').nullable(),
  ),
  address:           z.string().max(500).optional().nullable(),
  // Credit fields
  creditEnabled:     z.boolean().default(false),
  creditLimitCents:  z.number().int().min(0).default(0),
  creditAlertPct:    z.number().int().min(1).max(100).default(80),
  creditSettleDays:  z.number().int().min(1).max(365).optional().nullable(),
  // Owed before this system went live. Never negative — prepaid credit has its
  // own field and ledger, and letting this go below zero would give one idea
  // two contradictory homes.
  openingBalanceCents: z.number().int().min(0).default(0),
  openingBalanceAsOf:  z.string().datetime().optional().nullable(),
});

export const listCustomersSchema = z.object({
  search: z.string().optional(),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
  isActive: z.enum(['true', 'false', 'all']).optional().default('all'),
});

export type CustomerBodyInput = z.infer<typeof customerBodySchema>;
export type ListCustomersInput = z.infer<typeof listCustomersSchema>;
