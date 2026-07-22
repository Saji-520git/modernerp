import { z } from 'zod';

export const updateLoyaltyConfigSchema = z.object({
  isEnabled:       z.boolean().optional(),
  pointsPerAmount: z.number().int().min(1).optional(),
  amountPerPoint:  z.number().int().min(1).optional(),
  minRedeemPoints: z.number().int().min(0).optional(),
  pointValueCents: z.number().int().min(1).optional(),
  expiryDays:      z.number().int().min(1).nullable().optional(),
});

export const adjustPointsSchema = z.object({
  points: z.number().int().refine((n) => n !== 0, 'Points cannot be zero'),
  note:   z.string().max(300).optional(),
});

export type UpdateLoyaltyConfigInput = z.infer<typeof updateLoyaltyConfigSchema>;
export type AdjustPointsInput = z.infer<typeof adjustPointsSchema>;
