import { Router } from 'express';
import { asyncHandler as h } from '../../middleware/async-handler.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import * as ctrl from './reports.controller.js';

export const router: Router = Router();

router.use(requireAuth);

// Per-report, not one blanket guard.
//
// Every route below used to sit behind a single view_reports, so anyone who
// could open a sales list could also read profit, margin and debtor ageing.
// view_reports still IMPLIES all of these (see IMPLIED_BY), so nobody who had
// it loses anything — but a role can now be given the operational reports
// without the financial ones.
router.get('/sales/csv', requirePermission('reports.export'),      h(ctrl.salesCsv));   // before /sales
router.get('/sales',     requirePermission('reports.sales'),       h(ctrl.salesReport));
router.get('/purchases', requirePermission('reports.purchases'),   h(ctrl.purchasesReport));
router.get('/products',  requirePermission('reports.products'),    h(ctrl.productReport));
router.get('/customers', requirePermission('reports.customers'),   h(ctrl.customerReport));
router.get('/inventory', requirePermission('reports.inventory'),   h(ctrl.inventoryReport));
router.get('/profit-loss', requirePermission('reports.profit_loss'), h(ctrl.profitLoss));
router.get('/aging',       requirePermission('reports.aging'),       h(ctrl.aging));
router.get('/pnl',        requirePermission('reports.profit_loss'), h(ctrl.pnlComparison));
router.get('/dashboard',  requirePermission('reports.dashboard'),  h(ctrl.dashboardStats));
router.get('/today-summary', requirePermission('reports.dashboard'), h(ctrl.todaySummary));
