import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { requireAuth } from '../../middleware/auth.js';
import { requireSuperAdmin } from '../../middleware/requireSuperAdmin.js';
import {
  registerTenant,
  listTenants,
  getTenant,
  updateTenant,
  deactivateTenant,
  updateTenantModules,
} from './tenant.controller.js';

export const router: Router = Router();

// ─── Public ─────────────────────────────────────────────────────────────────
// Tenant self-service signup. Heavily rate limited (5 / hour / IP) to prevent
// abuse — every request creates a Tenant + ADMIN user.
const registerLimiter = rateLimit({
  windowMs: 60 * 60_000, // 1 hour
  max: 5,
  message: { success: false, error: 'Too many registration attempts, please try again later.', code: 'TOO_MANY_REQUESTS' },
  standardHeaders: true,
  legacyHeaders: false,
});

router.post('/register', registerLimiter, registerTenant);

// ─── Super-admin (BROcode Solutions staff) only ────────────────────────────────
router.get('/',                requireAuth, requireSuperAdmin, listTenants);
router.get('/:id',             requireAuth, requireSuperAdmin, getTenant);
router.put('/:id',             requireAuth, requireSuperAdmin, updateTenant);
router.post('/:id/deactivate', requireAuth, requireSuperAdmin, deactivateTenant);
router.post('/:id/modules',    requireAuth, requireSuperAdmin, updateTenantModules);
