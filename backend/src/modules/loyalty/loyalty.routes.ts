import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { requireModule } from '../../middleware/require-module.js';
import { asyncHandler as h } from '../../middleware/async-handler.js';
import { loyaltyController } from './loyalty.controller.js';

export const router: Router = Router();

// Gated: 403 unless the 'loyalty' module is enabled.
router.use(requireAuth, requireModule('loyalty'));

router.get('/config',                     requirePermission('view_settings'),   h(loyaltyController.getConfig));
router.patch('/config',                   requirePermission('manage_settings'), h(loyaltyController.updateConfig));
router.get('/customers/:customerId',      requirePermission('view_contacts'),   h(loyaltyController.getCustomer));
router.post('/customers/:customerId/adjust', requirePermission('manage_credit'), h(loyaltyController.adjust));
