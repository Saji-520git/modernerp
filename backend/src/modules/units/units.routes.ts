import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { unitsController } from './units.controller.js';

export const router: Router = Router();

router.get(  '/',    requireAuth, unitsController.list);
router.get(  '/:id', requireAuth, unitsController.getById);
router.post( '/',    requireAuth, requirePermission('manage_settings'), unitsController.create);
router.patch('/:id', requireAuth, requirePermission('manage_settings'), unitsController.update);
router.delete('/:id', requireAuth, requirePermission('manage_settings'), unitsController.softDelete);
