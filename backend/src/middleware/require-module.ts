import type { RequestHandler } from 'express';
import { prisma } from '../config/prisma.js';
import { HttpError } from './error-handler.js';
import { isModuleEnabled, type ModuleKey } from '../config/modules.js';
import { SETTINGS_ID } from '../modules/settings/settings.service.js';

/**
 * Route guard: 403 unless the given optional module is enabled in AppSettings.
 * Applied on a feature's routers so a disabled module is enforced server-side,
 * not just hidden in the UI. Async-safe (catches and forwards errors — Express 4
 * does not propagate async throws on its own).
 */
export const requireModule = (key: ModuleKey): RequestHandler =>
  async (req, _res, next) => {
    try {
      // Super-admin bypasses module gates — they configure every area per client.
      if (req.auth?.role === 'SUPER_ADMIN' || req.auth?.permissions?.includes('manage_modules')) {
        return next();
      }
      const settings = await prisma.appSettings.findUnique({
        where: { id: SETTINGS_ID },
        select: { moduleFlags: true },
      });
      if (!isModuleEnabled(settings?.moduleFlags, key)) {
        throw new HttpError(403, `Module '${key}' is disabled`);
      }
      next();
    } catch (err) {
      next(err);
    }
  };
