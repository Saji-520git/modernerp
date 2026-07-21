import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { requireModule } from '../../middleware/require-module.js';
import { asyncHandler as h } from '../../middleware/async-handler.js';
import { promotionsController } from './promotions.controller.js';

export const router: Router = Router();

// Whole module is gated: 403 unless the 'promotions' feature is enabled.
router.use(requireAuth, requireModule('promotions'));

// Read + preview — any authenticated user (cashiers preview at POS).
router.get('/', h(promotionsController.list));
router.get('/:id', h(promotionsController.getById));
router.post('/preview', h(promotionsController.preview));

// Manage — requires manage_settings.
router.post('/',      requirePermission('manage_settings'), h(promotionsController.create));
router.patch('/:id',  requirePermission('manage_settings'), h(promotionsController.update));
router.delete('/:id', requirePermission('manage_settings'), h(promotionsController.remove));
