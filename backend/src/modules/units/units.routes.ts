import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { asyncHandler as h } from '../../middleware/async-handler.js';
import { unitsController } from './units.controller.js';

export const router: Router = Router();

router.get(  '/',    requireAuth, h(unitsController.list));
router.get(  '/:id', requireAuth, h(unitsController.getById));
router.post( '/',    requireAuth, requirePermission('manage_settings'), h(unitsController.create));
router.patch('/:id', requireAuth, requirePermission('manage_settings'), h(unitsController.update));
router.delete('/:id', requireAuth, requirePermission('manage_settings'), h(unitsController.softDelete));
