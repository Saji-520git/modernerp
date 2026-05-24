import { z } from 'zod';
import { ALL_PERMISSIONS } from '../../config/permissions.js';

// ─── Password rules (shared) ──────────────────────────────────────────────────

const passwordSchema = z
  .string()
  .min(8, 'Password must be at least 8 characters')
  .regex(/[a-zA-Z]/, 'Password must contain at least one letter')
  .regex(/[0-9]/, 'Password must contain at least one number');

// ─── Permissions array (optional) ────────────────────────────────────────────

const permissionsSchema = z
  .array(z.enum(ALL_PERMISSIONS))
  .optional()
  .nullable();

// ─── Create user ──────────────────────────────────────────────────────────────

export const createUserSchema = z.object({
  fullName: z.string().min(2, 'Full name must be at least 2 characters').max(100),
  email: z.string().email('Invalid email address').toLowerCase(),
  password: passwordSchema,
  role: z.enum(['ADMIN', 'MANAGER', 'CASHIER', 'STAFF']),
  permissions: permissionsSchema,
});

// ─── Update user (no password change here) ────────────────────────────────────

export const updateUserSchema = z.object({
  fullName: z.string().min(2).max(100),
  email: z.string().email('Invalid email address').toLowerCase(),
  role: z.enum(['ADMIN', 'MANAGER', 'CASHIER', 'STAFF']),
  permissions: permissionsSchema,
});

// ─── Update permissions only ──────────────────────────────────────────────────

export const updatePermissionsSchema = z.object({
  // null = revert to role defaults; array = custom overrides
  permissions: z.array(z.enum(ALL_PERMISSIONS)).nullable(),
});

// ─── Change password ──────────────────────────────────────────────────────────

export const changePasswordSchema = z.object({
  newPassword: passwordSchema,
});

// ─── List users ───────────────────────────────────────────────────────────────

export const listUsersSchema = z.object({
  search: z.string().optional(),
  role: z.enum(['ADMIN', 'MANAGER', 'CASHIER', 'STAFF']).optional(),
  isActive: z
    .string()
    .optional()
    .transform((v) => (v === 'true' ? true : v === 'false' ? false : undefined)),
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(20),
});

// ─── Types ────────────────────────────────────────────────────────────────────

export type CreateUserInput = z.infer<typeof createUserSchema>;
export type UpdateUserInput = z.infer<typeof updateUserSchema>;
export type ChangePasswordInput = z.infer<typeof changePasswordSchema>;
export type ListUsersInput = z.infer<typeof listUsersSchema>;
export type UpdatePermissionsInput = z.infer<typeof updatePermissionsSchema>;
