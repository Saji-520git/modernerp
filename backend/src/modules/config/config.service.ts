import { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';

const CONFIG_ID = 'singleton';

// ─── Default module config (used when no config exists yet) ────────────────────
// Existing modules default to true so behaviour is unchanged until a flag is
// turned off. New/future modules default to false (opt-in).
export const DEFAULT_MODULES = {
  pos:           true,
  inventory:     true,
  purchasing:    true,
  customers:     true,
  suppliers:     true,
  expenses:      true,
  reports:       true,
  warehouses:    true,
  manufacturing: false,
  hr:            false,
  multiLocation: false,
  ecommerce:     false,
  repairs:       false,
  bakery:        false,
  crm:           false,
};

export type ModuleFlags = typeof DEFAULT_MODULES;
export type ModuleKey = keyof ModuleFlags;

export type BusinessType =
  | 'grocery'
  | 'hardware'
  | 'bakery'
  | 'repairs'
  | 'clothing'
  | 'general';

const MODULE_KEYS = Object.keys(DEFAULT_MODULES) as ModuleKey[];

/** Build a full flag set with only the listed modules enabled. */
function template(enabled: ModuleKey[]): ModuleFlags {
  const flags = Object.fromEntries(MODULE_KEYS.map((k) => [k, false])) as ModuleFlags;
  for (const key of enabled) flags[key] = true;
  return flags;
}

const TEMPLATES: Record<BusinessType, ModuleFlags> = {
  grocery:  template(['pos', 'inventory', 'purchasing', 'customers', 'suppliers', 'expenses', 'reports', 'warehouses']),
  hardware: template(['pos', 'inventory', 'purchasing', 'customers', 'suppliers', 'expenses', 'reports', 'warehouses']),
  bakery:   template(['pos', 'inventory', 'purchasing', 'customers', 'suppliers', 'expenses', 'reports', 'warehouses', 'manufacturing']),
  repairs:  template(['pos', 'inventory', 'customers', 'expenses', 'reports', 'repairs']),
  clothing: template(['pos', 'inventory', 'purchasing', 'customers', 'suppliers', 'expenses', 'reports', 'warehouses']),
  general:  template(MODULE_KEYS),
};

export const BUSINESS_TYPES = Object.keys(TEMPLATES) as BusinessType[];

export const configService = {

  /** Returns the singleton ClientConfig, creating it with defaults if absent. */
  getConfig: async () => {
    try {
      return await prisma.clientConfig.upsert({
        where:  { id: CONFIG_ID },
        update: {},
        create: {
          id:           CONFIG_ID,
          clientName:   'My Business',
          businessType: 'general',
          modules:      DEFAULT_MODULES as Prisma.InputJsonValue,
          settings:     {} as Prisma.InputJsonValue,
        },
      });
    } catch (err) {
      logger.error(err, 'configService.getConfig failed');
      throw err;
    }
  },

  /**
   * Returns the effective module flags (stored values merged over defaults).
   *
   * Dual-mode: when a `tenant` is supplied (cloud/SaaS request) its module JSON
   * is used; otherwise it falls back to the singleton ClientConfig (single-client
   * / Electron behaviour — unchanged). Passing nothing preserves the original
   * signature for all existing callers.
   */
  getModules: async (tenant?: { modules: unknown } | null): Promise<ModuleFlags> => {
    try {
      if (tenant) {
        const stored = (tenant.modules ?? {}) as Partial<ModuleFlags>;
        return { ...DEFAULT_MODULES, ...stored };
      }
      const cfg = await configService.getConfig();
      const stored = (cfg.modules ?? {}) as Partial<ModuleFlags>;
      return { ...DEFAULT_MODULES, ...stored };
    } catch (err) {
      logger.error(err, 'configService.getModules failed');
      throw err;
    }
  },

  /** Merges the given flags over existing ones, persists, returns the full set. */
  updateModules: async (modules: Partial<ModuleFlags>): Promise<ModuleFlags> => {
    try {
      const current = await configService.getModules();
      const merged: ModuleFlags = { ...current };
      for (const key of MODULE_KEYS) {
        if (typeof modules[key] === 'boolean') merged[key] = modules[key] as boolean;
      }
      await prisma.clientConfig.update({
        where: { id: CONFIG_ID },
        data:  { modules: merged as Prisma.InputJsonValue },
      });
      logger.info({ changed: Object.keys(modules) }, 'Module flags updated');
      return merged;
    } catch (err) {
      logger.error(err, 'configService.updateModules failed');
      throw err;
    }
  },

  /** Updates client name and/or business type. */
  updateClientInfo: async (data: { clientName?: string; businessType?: string }) => {
    try {
      await configService.getConfig();
      const updated = await prisma.clientConfig.update({
        where: { id: CONFIG_ID },
        data: {
          ...(data.clientName   !== undefined ? { clientName:   data.clientName }   : {}),
          ...(data.businessType !== undefined ? { businessType: data.businessType } : {}),
        },
      });
      logger.info({ clientName: data.clientName, businessType: data.businessType }, 'Client info updated');
      return updated;
    } catch (err) {
      logger.error(err, 'configService.updateClientInfo failed');
      throw err;
    }
  },

  /** Applies a preset module combination and records the business type. */
  applyTemplate: async (templateName: BusinessType) => {
    try {
      const flags = TEMPLATES[templateName];
      if (!flags) throw new HttpError(400, `Unknown template: ${templateName}`);
      await configService.getConfig();
      const updated = await prisma.clientConfig.update({
        where: { id: CONFIG_ID },
        data: {
          businessType: templateName,
          modules:      flags as Prisma.InputJsonValue,
        },
      });
      logger.info({ template: templateName }, 'Business type template applied');
      return updated;
    } catch (err) {
      logger.error(err, 'configService.applyTemplate failed');
      throw err;
    }
  },
};
