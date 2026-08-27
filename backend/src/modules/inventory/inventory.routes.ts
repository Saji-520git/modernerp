import { Router } from 'express';
import { asyncHandler as h } from '../../middleware/async-handler.js';
import * as ctrl from './inventory.controller.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';

export const router: Router = Router();

router.use(requireAuth);

router.get('/stock', requirePermission('view_inventory'), h(ctrl.listStock));
router.get('/low-stock', requirePermission('view_inventory'), h(ctrl.getLowStock));
router.get('/warehouses', h(ctrl.getWarehouses));   // needed by many pages — open to all auth users
router.get('/movements', requirePermission('view_inventory'), h(ctrl.listMovements));

// One-shot maintenance — repair drifted/negative Stock.qty from batch sums.
// ADMIN-only (manage_users is the project-wide ADMIN gate). Placed before any
// /:id-style routes so there is no path collision.
router.get('/repair-stock', requirePermission('manage_users'), h(ctrl.repairStockQty));

router.post('/ensure-stock-records',   requirePermission('adjust_inventory'), h(ctrl.ensureStockRecords));
router.post('/cleanup-phantom-stock',  requirePermission('adjust_inventory'), h(ctrl.cleanupPhantomStock));
router.post('/adjustments', requirePermission('adjust_inventory'), h(ctrl.createAdjustment));
router.post('/transfers',   requirePermission('transfer_stock'),   h(ctrl.createTransfer));
router.post('/write-off',   requirePermission('adjust_inventory'), h(ctrl.writeOff));
router.get('/stock/:productId/units',                          requirePermission('view_inventory'), h(ctrl.getStockByUnits));
router.get('/expiring',                                        requirePermission('view_inventory'), h(ctrl.listExpiring));
router.get('/batches/:productId/:warehouseId',                 requirePermission('view_inventory'), h(ctrl.getBatchDetail));

// ── Alerts ────────────────────────────────────────────────────────────────────
router.get('/alerts',              h(ctrl.getAlerts));
router.get('/alerts/count',        h(ctrl.getAlertCount));
router.post('/alerts/read',        h(ctrl.markAlertsRead));
router.post('/alerts/dismiss-all', h(ctrl.dismissAllAlerts));
router.post('/alerts/:id/dismiss', h(ctrl.dismissAlert));
