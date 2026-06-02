import { z } from 'zod';
import { PLANS } from './tenant.service.js';

// Slug: lowercase letters, digits and hyphens only (server also re-slugifies).
const slugField = z
  .string()
  .min(2)
  .max(50)
  .regex(/^[a-z0-9-]+$/, 'Slug may contain only lowercase letters, digits and hyphens');

const planField = z.enum(PLANS as [string, ...string[]]);

export const registerTenantSchema = z.object({
  name:          z.string().min(2).max(100),
  slug:          slugField.optional(),
  plan:          planField.optional(),
  adminEmail:    z.string().email(),
  adminPassword: z.string().min(8).max(100),
  adminName:     z.string().min(2).max(100),
});

export const updateTenantSchema = z.object({
  name:     z.string().min(2).max(100).optional(),
  plan:     planField.optional(),
  isActive: z.boolean().optional(),
  maxUsers: z.number().int().min(1).max(100000).optional(),
  modules:  z.record(z.boolean()).optional(),
  settings: z.record(z.unknown()).optional(),
});

export const updateTenantModulesSchema = z.object({
  modules: z.record(z.boolean()),
});

export type RegisterTenantInput = z.infer<typeof registerTenantSchema>;
export type UpdateTenantInput = z.infer<typeof updateTenantSchema>;
