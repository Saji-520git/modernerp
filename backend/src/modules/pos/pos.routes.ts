import { Router } from 'express';
import * as ctrl from './pos.controller.js';
import { requireAuth, requirePermission, requireRole } from '../../middleware/auth.js';
import { asyncHandler as h } from '../../middleware/async-handler.js';

export const router: Router = Router();

router.use(requireAuth);

router.get('/warehouses', ctrl.getWarehouses);
router.get('/products', requirePermission('view_products'), ctrl.searchProducts);
router.get('/products/:productId/batches', requirePermission('view_products'), h(ctrl.getProductBatches));
router.get('/sales', requirePermission('view_sales'), ctrl.listSales);
router.get('/receipt/:id', requirePermission('view_sales'), ctrl.getReceipt);

router.post('/checkout', requirePermission('pos_checkout'), h(ctrl.checkout));

// ── Drafts ────────────────────────────────────────────────────────────────────
router.get('/drafts',        requirePermission('pos_checkout'), ctrl.listDrafts);
router.post('/drafts',       requirePermission('pos_checkout'), h(ctrl.saveDraft));
router.delete('/drafts/:id', requirePermission('pos_checkout'), h(ctrl.deleteDraft));

// ── Customer credit ────────────────────────────────────────────────────────────
router.get('/customer-credit/:customerId', ctrl.getCustomerCredit);

// ── Shift management ──────────────────────────────────────────────────────────
router.post('/shifts/open',          h(ctrl.openShift));
router.get('/shifts/current',        ctrl.getCurrentShift);
router.post('/shifts/close',         h(ctrl.closeShift));
router.post('/shifts/:id/force-close', requireRole('ADMIN'), h(ctrl.forceCloseShift));
router.get('/shifts',                ctrl.listShifts);
router.get('/shifts/:id',            ctrl.getShift);
