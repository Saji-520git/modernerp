import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { requireModule } from '../../middleware/require-module.js';
import { asyncHandler as h } from '../../middleware/async-handler.js';
import { stockTakeController } from './stocktake.controller.js';

export const router: Router = Router();

// Gated: 403 unless the 'stockTake' feature is enabled. Counting mutates stock,
// so all actions require adjust_inventory.
router.use(requireAuth, requireModule('stockTake'), requirePermission('adjust_inventory'));

router.get('/',          h(stockTakeController.list));
router.get('/:id',       h(stockTakeController.getById));
router.post('/',         h(stockTakeController.create));
router.patch('/:id/counts',  h(stockTakeController.saveCounts));
router.post('/:id/confirm',  h(stockTakeController.confirm));
router.post('/:id/cancel',   h(stockTakeController.cancel));
