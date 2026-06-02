import type { RequestHandler } from 'express';
import jwt from 'jsonwebtoken';
import { asyncHandler } from '../../middleware/async-handler.js';
import { env } from '../../config/env.js';
import { resolvePermissions } from '../../config/permissions.js';
import { tenantService } from './tenant.service.js';
import {
  registerTenantSchema,
  updateTenantSchema,
  updateTenantModulesSchema,
} from './tenant.schema.js';

/** Sign a tenant-scoped access token (carries tenantId for tenantMiddleware). */
function signTenantToken(userId: string, role: string, tenantId: string): string {
  const permissions = resolvePermissions(role as 'ADMIN', null);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return jwt.sign({ userId, role, permissions, tenantId }, env.JWT_ACCESS_SECRET, {
    expiresIn: env.JWT_ACCESS_EXPIRES_IN as any,
  });
}

// ─── Public ─────────────────────────────────────────────────────────────────

export const registerTenant: RequestHandler = asyncHandler(async (req, res) => {
  const input = registerTenantSchema.parse(req.body);
  const { tenant, user } = await tenantService.createTenant(input);
  const token = signTenantToken(user.id, user.role, tenant.id);
  res.status(201).json({
    success: true,
    data: { tenant, token },
    message: 'Tenant registered',
  });
});

// ─── Super-admin ──────────────────────────────────────────────────────────────

export const listTenants: RequestHandler = asyncHandler(async (_req, res) => {
  const tenants = await tenantService.getAllTenants();
  res.json({ success: true, data: tenants, message: 'ok' });
});

export const getTenant: RequestHandler = asyncHandler(async (req, res) => {
  const tenant = await tenantService.getTenantById(req.params.id);
  res.json({ success: true, data: tenant, message: 'ok' });
});

export const updateTenant: RequestHandler = asyncHandler(async (req, res) => {
  const input = updateTenantSchema.parse(req.body);
  const tenant = await tenantService.updateTenant(req.params.id, input);
  res.json({ success: true, data: tenant, message: 'Tenant updated' });
});

export const deactivateTenant: RequestHandler = asyncHandler(async (req, res) => {
  const tenant = await tenantService.deactivateTenant(req.params.id);
  res.json({ success: true, data: tenant, message: 'Tenant deactivated' });
});

export const updateTenantModules: RequestHandler = asyncHandler(async (req, res) => {
  const { modules } = updateTenantModulesSchema.parse(req.body);
  const tenant = await tenantService.updateTenant(req.params.id, { modules });
  res.json({ success: true, data: tenant, message: 'Tenant modules updated' });
});
