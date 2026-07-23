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
import { SUPER_ADMIN_PERMISSIONS } from '../../config/permissions.js';

// Only a super-admin may grant the super-admin-only permissions (manage_modules,
// clear_data). The role enum already excludes SUPER_ADMIN, so role-level
// escalation is blocked at validation; this closes the custom-permission path.
function isSuperAdmin(auth?: { role?: string; permissions?: string[] }): boolean {
  return auth?.role === 'SUPER_ADMIN' || !!auth?.permissions?.includes('manage_modules');
}
function guardModuleGrant(auth: { role?: string; permissions?: string[] } | undefined, permissions?: readonly string[] | null): void {
  if (permissions && permissions.some((p) => (SUPER_ADMIN_PERMISSIONS as readonly string[]).includes(p)) && !isSuperAdmin(auth)) {
    throw new HttpError(403, 'Only a super-admin can grant super-admin permissions');
  }
}
// A super-admin account may only be modified by another super-admin — prevents a
// client admin from demoting/deactivating/altering the vendor super-admin.
async function guardProtectedTarget(auth: { role?: string; permissions?: string[] } | undefined, targetId: string): Promise<void> {
  const target = await usersService.getOne(targetId);
  if (target.role === 'SUPER_ADMIN' && !isSuperAdmin(auth)) {
    throw new HttpError(403, 'Only a super-admin can modify a super-admin account');
  }
}

export const stats: RequestHandler = async (req, res) => {
  res.json(await usersService.stats(isSuperAdmin(req.auth)));
};

export const list: RequestHandler = async (req, res) => {
  const input = listUsersSchema.parse(req.query);
  res.json(await usersService.list(input, isSuperAdmin(req.auth)));
};

export const getOne: RequestHandler = async (req, res) => {
  res.json(await usersService.getOne(req.params.id, isSuperAdmin(req.auth)));
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
  await guardProtectedTarget(req.auth, req.params.id);
  res.json(await usersService.update(req.params.id, input, req.auth.userId));
};

export const changePassword: RequestHandler = async (req, res) => {
  const input = changePasswordSchema.parse(req.body);
  await guardProtectedTarget(req.auth, req.params.id);
  res.json(await usersService.changePassword(req.params.id, input));
};

export const toggleActive: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  await guardProtectedTarget(req.auth, req.params.id);
  res.json(await usersService.toggleActive(req.params.id, req.auth.userId));
};

export const updatePermissions: RequestHandler = async (req, res) => {
  const input = updatePermissionsSchema.parse(req.body);
  guardModuleGrant(req.auth, input.permissions);
  await guardProtectedTarget(req.auth, req.params.id);
  res.json(await usersService.updatePermissions(req.params.id, input));
};
