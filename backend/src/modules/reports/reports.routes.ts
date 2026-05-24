import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import * as ctrl from './reports.controller.js';

export const router: Router = Router();

router.use(requireAuth);
router.use(requirePermission('view_reports'));

router.get('/sales/csv', ctrl.salesCsv);       // must be before /sales
router.get('/sales',     ctrl.salesReport);
router.get('/purchases', ctrl.purchasesReport);
router.get('/products',  ctrl.productReport);
router.get('/customers', ctrl.customerReport);
router.get('/inventory', ctrl.inventoryReport);
router.get('/profit-loss', ctrl.profitLoss);
