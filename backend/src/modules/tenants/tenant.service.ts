import bcrypt from 'bcryptjs';
import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';
import {
  DEFAULT_MODULES,
  configService,
  type ModuleFlags,
  type ModuleKey,
} from '../config/config.service.js';

// ─── Plan → module presets ────────────────────────────────────────────────────
// Built from the canonical module key set so a new module never silently leaks
// into an existing plan.

const ALL_KEYS = Object.keys(DEFAULT_MODULES) as ModuleKey[];

/** Build a full flag set with only the listed modules enabled. */
function preset(enabled: ModuleKey[]): ModuleFlags {
  const flags = Object.fromEntries(ALL_KEYS.map((k) => [k, false])) as ModuleFlags;
  for (const key of enabled) flags[key] = true;
  return flags;
}

const STARTER: ModuleKey[]  = ['pos', 'inventory', 'customers', 'expenses', 'reports'];
const STANDARD: ModuleKey[] = [...STARTER, 'purchasing', 'suppliers', 'warehouses'];
const BUSINESS: ModuleKey[] = [...STANDARD, 'hr', 'manufacturing'];

export const PLAN_MODULES: Record<string, ModuleFlags> = {
  starter:    preset(STARTER),
  standard:   preset(STANDARD),
  business:   preset(BUSINESS),
  enterprise: preset(ALL_KEYS),
};

export const PLANS = Object.keys(PLAN_MODULES);

/** Default max users per plan. */
const PLAN_MAX_USERS: Record<string, number> = {
  starter: 5,
  standard: 15,
  business: 50,
  enterprise: 1000,
};

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** Convert a business name to a URL-safe slug: lowercase, hyphenated, no spaces. */
export function slugify(input: string): string {
  return input
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, '-')   // non-alphanumeric → hyphen
    .replace(/^-+|-+$/g, '')        // trim leading/trailing hyphens
    .replace(/-{2,}/g, '-');        // collapse repeats
}

/** Resolve the module preset for a plan, falling back to starter. */
function modulesForPlan(plan: string): ModuleFlags {
  return PLAN_MODULES[plan] ?? PLAN_MODULES.starter;
}

// ─── DTOs ──────────────────────────────────────────────────────────────────────

export interface CreateTenantDto {
  name: string;
  slug?: string;
  plan?: string;
  adminEmail: string;
  adminPassword: string;
  adminName: string;
}

export interface UpdateTenantDto {
  name?: string;
  plan?: string;
  isActive?: boolean;
  maxUsers?: number;
  modules?: Partial<ModuleFlags>;
  settings?: Record<string, unknown>;
}

// ─── Service ────────────────────────────────────────────────────────────────────

export const tenantService = {
  /**
   * Creates a Tenant and its first admin User (linked via tenantId), applying the
   * plan's default module preset. Slug is auto-generated from the name if absent.
   * Runs in a transaction so a tenant is never left without its admin.
   */
  createTenant: async (data: CreateTenantDto) => {
    try {
      const plan = data.plan && PLAN_MODULES[data.plan] ? data.plan : 'starter';
      const slug = slugify(data.slug || data.name);
      if (!slug) throw new HttpError(400, 'A valid name or slug is required');

      const existingSlug = await prisma.tenant.findUnique({ where: { slug } });
      if (existingSlug) throw new HttpError(409, `Slug "${slug}" is already taken`);

      const existingEmail = await prisma.user.findUnique({ where: { email: data.adminEmail } });
      if (existingEmail) throw new HttpError(409, 'Admin email is already registered');

      const passwordHash = await bcrypt.hash(data.adminPassword, 12);
      const modules = modulesForPlan(plan);

      const result = await prisma.$transaction(async (tx) => {
        const tenant = await tx.tenant.create({
          data: {
            name:     data.name,
            slug,
            plan,
            maxUsers: PLAN_MAX_USERS[plan] ?? 5,
            modules:  modules as Prisma.InputJsonValue,
            settings: {} as Prisma.InputJsonValue,
          },
        });

        const user = await tx.user.create({
          data: {
            email:        data.adminEmail,
            fullName:     data.adminName,
            passwordHash,
            role:         'ADMIN',
            tenantId:     tenant.id,
          },
          select: { id: true, email: true, fullName: true, role: true, tenantId: true },
        });

        return { tenant, user };
      });

      logger.info({ tenantId: result.tenant.id, slug, plan }, 'Tenant created');
      return result;
    } catch (err) {
      if (!(err instanceof HttpError)) logger.error(err, 'tenantService.createTenant failed');
      throw err;
    }
  },

  getTenantBySlug: async (slug: string) => {
    try {
      return await prisma.tenant.findUnique({ where: { slug } });
    } catch (err) {
      logger.error(err, 'tenantService.getTenantBySlug failed');
      throw err;
    }
  },

  getTenantById: async (id: string) => {
    try {
      const tenant = await prisma.tenant.findUnique({
        where:   { id },
        include: { _count: { select: { users: true } } },
      });
      if (!tenant) throw new HttpError(404, 'Tenant not found');
      const { _count, ...rest } = tenant;
      return { ...rest, userCount: _count.users };
    } catch (err) {
      if (!(err instanceof HttpError)) logger.error(err, 'tenantService.getTenantById failed');
      throw err;
    }
  },

  updateTenant: async (id: string, data: UpdateTenantDto) => {
    try {
      const existing = await prisma.tenant.findUnique({ where: { id } });
      if (!existing) throw new HttpError(404, 'Tenant not found');

      // Merge module flags over the existing set so partial updates are safe.
      let modules: Prisma.InputJsonValue | undefined;
      if (data.modules) {
        const current = { ...DEFAULT_MODULES, ...(existing.modules as Partial<ModuleFlags>) };
        for (const key of ALL_KEYS) {
          if (typeof data.modules[key] === 'boolean') current[key] = data.modules[key] as boolean;
        }
        modules = current as Prisma.InputJsonValue;
      }

      const updated = await prisma.tenant.update({
        where: { id },
        data: {
          ...(data.name     !== undefined ? { name: data.name } : {}),
          ...(data.plan     !== undefined ? { plan: data.plan } : {}),
          ...(data.isActive !== undefined ? { isActive: data.isActive } : {}),
          ...(data.maxUsers !== undefined ? { maxUsers: data.maxUsers } : {}),
          ...(modules        !== undefined ? { modules } : {}),
          ...(data.settings !== undefined ? { settings: data.settings as Prisma.InputJsonValue } : {}),
        },
      });
      logger.info({ tenantId: id, changed: Object.keys(data) }, 'Tenant updated');
      return updated;
    } catch (err) {
      if (!(err instanceof HttpError)) logger.error(err, 'tenantService.updateTenant failed');
      throw err;
    }
  },

  getAllTenants: async () => {
    try {
      const tenants = await prisma.tenant.findMany({
        orderBy: { createdAt: 'desc' },
        include: { _count: { select: { users: true } } },
      });
      return tenants.map(({ _count, ...rest }) => ({ ...rest, userCount: _count.users }));
    } catch (err) {
      logger.error(err, 'tenantService.getAllTenants failed');
      throw err;
    }
  },

  deactivateTenant: async (id: string) => {
    try {
      const existing = await prisma.tenant.findUnique({ where: { id } });
      if (!existing) throw new HttpError(404, 'Tenant not found');
      const updated = await prisma.tenant.update({
        where: { id },
        data:  { isActive: false },
      });
      logger.info({ tenantId: id }, 'Tenant deactivated');
      return updated;
    } catch (err) {
      if (!(err instanceof HttpError)) logger.error(err, 'tenantService.deactivateTenant failed');
      throw err;
    }
  },

  /**
   * Returns the effective module flags for a tenant. Bridges single-client and
   * multi-tenant: when tenantId is null we fall back to the ClientConfig flags so
   * existing (Electron) deployments behave exactly as before.
   */
  getModulesForTenant: async (tenantId: string | null | undefined): Promise<ModuleFlags> => {
    try {
      if (!tenantId) return await configService.getModules();
      const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });
      if (!tenant) return await configService.getModules();
      const stored = (tenant.modules ?? {}) as Partial<ModuleFlags>;
      return { ...DEFAULT_MODULES, ...stored };
    } catch (err) {
      logger.error(err, 'tenantService.getModulesForTenant failed');
      // Fail safe to client config rather than locking the API.
      return await configService.getModules();
    }
  },
};
