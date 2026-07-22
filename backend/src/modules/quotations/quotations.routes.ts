import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { requireModule } from '../../middleware/require-module.js';
import { asyncHandler as h } from '../../middleware/async-handler.js';
import { quotationsController } from './quotations.controller.js';

export const router: Router = Router();

// Gated: 403 unless the 'quotations' module is enabled.
router.use(requireAuth, requireModule('quotations'));

router.get('/',    requirePermission('view_sales'), h(quotationsController.list));
router.get('/:id', requirePermission('view_sales'), h(quotationsController.getById));

router.post('/',            requirePermission('create_sales'), h(quotationsController.create));
router.patch('/:id',        requirePermission('create_sales'), h(quotationsController.update));
router.patch('/:id/status', requirePermission('create_sales'), h(quotationsController.setStatus));
router.post('/:id/convert', requirePermission('create_sales'), h(quotationsController.convert));
router.delete('/:id',       requirePermission('create_sales'), h(quotationsController.remove));
