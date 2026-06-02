import { Router } from 'express';
import { createRequire } from 'module';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';

// Read the app version from package.json without an ESM JSON import assertion.
// Resolves relative to this module: src/modules/health → backend/package.json in
// dev, dist/modules/health → /app/package.json in the built image.
const require = createRequire(import.meta.url);
let appVersion = 'unknown';
try {
  appVersion = (require('../../../package.json') as { version?: string }).version ?? 'unknown';
} catch {
  appVersion = 'unknown';
}

export const router: Router = Router();

/**
 * Liveness probe — is the process up and serving HTTP? Cheap, no I/O. Used by
 * container orchestrators / load balancers to decide if the process is alive.
 */
router.get('/health', (_req, res) => {
  res.json({
    status:  'ok',
    uptime:  process.uptime(),
    version: appVersion,
    ts:      Date.now(),
  });
});

/**
 * Readiness probe — can the app actually serve requests (DB reachable)? Returns
 * 503 when the database check fails so a degraded instance is pulled from
 * rotation without being killed.
 */
router.get('/health/ready', async (_req, res) => {
  try {
    await prisma.$queryRaw`SELECT 1`;
    res.json({
      status:   'ready',
      database: 'connected',
      uptime:   process.uptime(),
      version:  appVersion,
      ts:       Date.now(),
    });
  } catch (err) {
    logger.error(err, 'health/ready database check failed');
    res.status(503).json({
      status:   'degraded',
      database: 'unavailable',
      uptime:   process.uptime(),
      version:  appVersion,
      ts:       Date.now(),
    });
  }
});
