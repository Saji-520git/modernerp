import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { asyncHandler as h } from '../../middleware/async-handler.js';
import { auditController } from './audit.controller.js';

export const router: Router = Router();

// Read-only, and gated on manage_users — seeing who did what is an
// administrative power, not a reporting one. There is deliberately no POST,
// PATCH or DELETE here: a trail that can be written to or edited through the
// API answers no question worth asking.
router.get('/',                       requireAuth, requirePermission('manage_users'), h(auditController.list));
router.get('/facets',                 requireAuth, requirePermission('manage_users'), h(auditController.facets));
router.get('/:entity/:entityId',      requireAuth, requirePermission('manage_users'), h(auditController.forEntity));
