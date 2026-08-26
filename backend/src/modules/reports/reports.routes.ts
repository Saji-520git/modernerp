import { Router } from 'express';
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
router.get('/sales/csv', requirePermission('reports.export'),      ctrl.salesCsv);   // before /sales
router.get('/sales',     requirePermission('reports.sales'),       ctrl.salesReport);
router.get('/purchases', requirePermission('reports.purchases'),   ctrl.purchasesReport);
router.get('/products',  requirePermission('reports.products'),    ctrl.productReport);
router.get('/customers', requirePermission('reports.customers'),   ctrl.customerReport);
router.get('/inventory', requirePermission('reports.inventory'),   ctrl.inventoryReport);
router.get('/profit-loss', requirePermission('reports.profit_loss'), ctrl.profitLoss);
router.get('/aging',       requirePermission('reports.aging'),       ctrl.aging);
router.get('/pnl',        requirePermission('reports.profit_loss'), ctrl.pnlComparison);
router.get('/dashboard',  requirePermission('reports.dashboard'),  ctrl.dashboardStats);
router.get('/today-summary', requirePermission('reports.dashboard'), ctrl.todaySummary);
