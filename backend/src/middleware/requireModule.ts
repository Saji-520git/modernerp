import type { Request, Response, NextFunction } from 'express';
import { configService } from '../modules/config/config.service.js';

/**
 * Protects API routes behind a module flag. If the named module is disabled, the
 * request is rejected with 403 MODULE_DISABLED. If the config cannot be read, it
 * fails open (allows the request) so a config outage never locks the whole API.
 *
 * Dual-mode: when a tenant is attached to the request (cloud/SaaS) its module
 * flags are used; otherwise it falls back to the singleton ClientConfig
 * (single-client / Electron) — unchanged behaviour.
 */
export function requireModule(moduleName: string) {
  return async (req: Request, res: Response, next: NextFunction) => {
    try {
      const modules = await configService.getModules(req.tenant ?? null);
      if (!(modules as Record<string, boolean>)[moduleName]) {
        return res.status(403).json({
          success: false,
          error:   'Module not enabled',
          code:    'MODULE_DISABLED',
          module:  moduleName,
        });
      }
      next();
    } catch {
      next(); // fail open — if config unreadable, allow
    }
  };
}
