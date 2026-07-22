import type { RequestHandler } from 'express';
import { usersService } from './users.service.js';
import {
  createUserSchema,
  updateUserSchema,
  changePasswordSchema,
  listUsersSchema,
  updatePermissionsSchema,
} from './users.schema.js';
import { HttpError } from '../../middleware/error-handler.js';

// Only a super-admin may grant the super-admin-only 'manage_modules' permission.
// (The role enum already excludes SUPER_ADMIN, so role-level escalation is blocked
// at validation; this closes the custom-permission path.)
function isSuperAdmin(auth?: { role?: string; permissions?: string[] }): boolean {
  return auth?.role === 'SUPER_ADMIN' || !!auth?.permissions?.includes('manage_modules');
}
function guardModuleGrant(auth: { role?: string; permissions?: string[] } | undefined, permissions?: readonly string[] | null): void {
  if (permissions && permissions.includes('manage_modules') && !isSuperAdmin(auth)) {
    throw new HttpError(403, 'Only a super-admin can grant module management');
  }
}

export const stats: RequestHandler = async (_req, res) => {
  res.json(await usersService.stats());
};

export const list: RequestHandler = async (req, res) => {
  const input = listUsersSchema.parse(req.query);
  res.json(await usersService.list(input));
};

export const getOne: RequestHandler = async (req, res) => {
  res.json(await usersService.getOne(req.params.id));
};

export const create: RequestHandler = async (req, res) => {
  const input = createUserSchema.parse(req.body);
  guardModuleGrant(req.auth, input.permissions);
  res.status(201).json(await usersService.create(input));
};

export const update: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const input = updateUserSchema.parse(req.body);
  guardModuleGrant(req.auth, input.permissions);
  res.json(await usersService.update(req.params.id, input, req.auth.userId));
};

export const changePassword: RequestHandler = async (req, res) => {
  const input = changePasswordSchema.parse(req.body);
  res.json(await usersService.changePassword(req.params.id, input));
};

export const toggleActive: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  res.json(await usersService.toggleActive(req.params.id, req.auth.userId));
};

export const updatePermissions: RequestHandler = async (req, res) => {
  const input = updatePermissionsSchema.parse(req.body);
  guardModuleGrant(req.auth, input.permissions);
  res.json(await usersService.updatePermissions(req.params.id, input));
};
