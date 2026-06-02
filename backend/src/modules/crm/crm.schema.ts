import { z } from 'zod';

// ─── Loyalty ──────────────────────────────────────────────────────────────────

export const updateLoyaltyConfigSchema = z.object({
  isEnabled:       z.boolean().optional(),
  pointsPerAmount: z.number().int().positive().optional(),
  amountPerPoint:  z.number().int().positive().optional(),
  minRedeemPoints: z.number().int().min(0).optional(),
  pointValueCents: z.number().int().positive().optional(),
  expiryDays:      z.number().int().positive().nullable().optional(),
});

export const adjustPointsSchema = z.object({
  points: z.number().int().refine((n) => n !== 0, 'Adjustment cannot be zero'),
  note:   z.string().min(1).max(500),
});

// ─── Price tiers ────────────────────────────────────────────────────────────

export const createTierSchema = z.object({
  name:        z.string().min(1).max(100),
  description: z.string().max(500).nullable().optional(),
  isDefault:   z.boolean().optional(),
  sortOrder:   z.number().int().optional(),
});

export const updateTierSchema = z.object({
  name:        z.string().min(1).max(100).optional(),
  description: z.string().max(500).nullable().optional(),
  isDefault:   z.boolean().optional(),
  isActive:    z.boolean().optional(),
  sortOrder:   z.number().int().optional(),
});

export const setProductPricesSchema = z.object({
  prices: z.array(
    z.object({
      tierId:     z.string().min(1),
      priceCents: z.number().int().positive(),
    }),
  ).min(1),
});

export const setCustomerTierSchema = z.object({
  tierId: z.string().min(1).nullable(),
});

// ─── Interactions ───────────────────────────────────────────────────────────

export const addInteractionSchema = z.object({
  customerId: z.string().min(1),
  type:       z.enum(['NOTE', 'CALL', 'VISIT', 'PAYMENT_REMINDER', 'OTHER']),
  note:       z.string().min(1).max(2000),
  followUpAt: z.coerce.date().nullable().optional(),
});

export type UpdateLoyaltyConfigBody = z.infer<typeof updateLoyaltyConfigSchema>;
export type AdjustPointsBody = z.infer<typeof adjustPointsSchema>;
export type CreateTierBody = z.infer<typeof createTierSchema>;
export type UpdateTierBody = z.infer<typeof updateTierSchema>;
export type SetProductPricesBody = z.infer<typeof setProductPricesSchema>;
export type SetCustomerTierBody = z.infer<typeof setCustomerTierSchema>;
export type AddInteractionBody = z.infer<typeof addInteractionSchema>;
