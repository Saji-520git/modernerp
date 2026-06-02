import type { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';
import type { Tenant } from '@prisma/client';
import { prisma } from '../config/prisma.js';
import { env } from '../config/env.js';
import { logger } from '../config/logger.js';
import type { AuthPayload } from './auth.js';

// Attach the resolved tenant (or null) to the Express request.
declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      tenant?: Tenant | null;
    }
  }
}

/**
 * Identifies the tenant on every request and supports BOTH delivery modes:
 *
 *   MODE 1 — Single client (Electron / current): no tenantId in the token.
 *            req.tenant is set to null and module flags fall back to ClientConfig.
 *            Behaviour is identical to before — zero breaking change.
 *
 *   MODE 2 — Cloud / SaaS: tenantId present in the JWT. The tenant is loaded,
 *            validated (must exist and be active), and attached to the request.
 *
 * This runs in the global chain before the route routers (which apply their own
 * requireAuth). Because req.auth is only populated inside those routers, we read
 * tenantId from req.auth when available and otherwise best-effort decode the
 * Bearer token here. It never throws — on any failure it falls open (req.tenant
 * = null, single-client mode) so a transient error can't lock the whole API.
 */
export async function tenantMiddleware(req: Request, res: Response, next: NextFunction) {
  try {
    let tenantId: string | null = req.auth?.tenantId ?? null;

    // No req.auth yet (global placement) — peek at the Bearer token if present.
    if (!tenantId) {
      const header = req.headers.authorization;
      if (header?.startsWith('Bearer ')) {
        try {
          const payload = jwt.verify(header.slice(7), env.JWT_ACCESS_SECRET) as AuthPayload;
          tenantId = payload.tenantId ?? null;
        } catch {
          // Invalid/expired token — let requireAuth handle rejection downstream.
          tenantId = null;
        }
      }
    }

    if (!tenantId) {
      // Single-client mode — skip tenant resolution.
      req.tenant = null;
      return next();
    }

    const tenant = await prisma.tenant.findUnique({ where: { id: tenantId } });

    if (!tenant || !tenant.isActive) {
      return res.status(403).json({
        success: false,
        error: 'Tenant not found or inactive',
        code: 'TENANT_INACTIVE',
      });
    }

    req.tenant = tenant;
    next();
  } catch (err) {
    logger.error(err, 'tenantMiddleware failed — falling open to single-client mode');
    req.tenant = null;
    next(); // fail open for safety
  }
}
