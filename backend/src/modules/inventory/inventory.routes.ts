import { Router } from 'express';
import * as ctrl from './inventory.controller.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';

export const router: Router = Router();

router.use(requireAuth);

router.get('/stock', requirePermission('view_inventory'), ctrl.listStock);
router.get('/low-stock', requirePermission('view_inventory'), ctrl.getLowStock);
router.get('/warehouses', ctrl.getWarehouses);   // needed by many pages — open to all auth users
router.get('/movements', requirePermission('view_inventory'), ctrl.listMovements);

router.post('/ensure-stock-records',   requirePermission('adjust_inventory'), ctrl.ensureStockRecords);
router.post('/cleanup-phantom-stock',  requirePermission('adjust_inventory'), ctrl.cleanupPhantomStock);
router.post('/adjustments', requirePermission('adjust_inventory'), ctrl.createAdjustment);
router.post('/transfers',   requirePermission('transfer_stock'),   ctrl.createTransfer);
router.post('/write-off',   requirePermission('adjust_inventory'), ctrl.writeOff);
router.get('/stock/:productId/units',                          requirePermission('view_inventory'), ctrl.getStockByUnits);
router.get('/expiring',                                        requirePermission('view_inventory'), ctrl.listExpiring);
router.get('/batches/:productId/:warehouseId',                 requirePermission('view_inventory'), ctrl.getBatchDetail);

// ── Alerts ────────────────────────────────────────────────────────────────────
router.get('/alerts',              ctrl.getAlerts);
router.get('/alerts/count',        ctrl.getAlertCount);
router.post('/alerts/read',        ctrl.markAlertsRead);
router.post('/alerts/dismiss-all', ctrl.dismissAllAlerts);
router.post('/alerts/:id/dismiss', ctrl.dismissAlert);
