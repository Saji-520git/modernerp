import { z } from 'zod';

// Module flags arrive as a partial map of name → boolean. The service filters to
// known keys, so accepting a string→boolean record here is safe and forward-proof.
export const updateModulesSchema = z.object({
  modules: z.record(z.string(), z.boolean()),
});

export const updateClientSchema = z.object({
  clientName:   z.string().min(1).max(120).optional(),
  businessType: z.string().min(1).max(60).optional(),
});

export const applyTemplateSchema = z.object({
  template: z.enum(['grocery', 'hardware', 'bakery', 'repairs', 'clothing', 'general']),
});

export type UpdateModulesInput = z.infer<typeof updateModulesSchema>;
export type UpdateClientInput  = z.infer<typeof updateClientSchema>;
export type ApplyTemplateInput = z.infer<typeof applyTemplateSchema>;
