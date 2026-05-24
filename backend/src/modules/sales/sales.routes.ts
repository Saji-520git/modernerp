import { Router } from 'express';
import * as ctrl from './sales.controller.js';
import * as retCtrl from './returns.controller.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { asyncHandler as h } from '../../middleware/async-handler.js';

export const router: Router = Router();

router.use(h(requireAuth));

router.get('/customers', h(ctrl.listCustomers));
router.get('/products',  h(requirePermission('view_products')),  h(ctrl.listProducts));
router.get('/',          h(requirePermission('view_sales')),     h(ctrl.listSales));
router.get('/:id',       h(requirePermission('view_sales')),     h(ctrl.getSale));

router.post('/',               h(requirePermission('create_sales')),   h(ctrl.createSale));
router.delete('/:id',          h(requirePermission('create_sales')),   h(ctrl.deleteSale));
router.patch('/:id',           h(requirePermission('create_sales')),   h(ctrl.updateSale));
router.patch('/:id/confirm',   h(requirePermission('confirm_sales')),  h(ctrl.confirmSale));
router.patch('/:id/cancel',    h(requirePermission('create_sales')),   h(ctrl.cancelSale));
router.patch('/:id/pay',       h(requirePermission('record_payments')), h(ctrl.recordPayment));
router.post('/:id/payments',   h(requirePermission('record_payments')), h(ctrl.recordPayment));
router.get('/:id/payments',    h(requirePermission('view_sales')),     h(ctrl.listPayments));

// ── Returns ────────────────────────────────────────────────────────────────────
router.get('/returns/list',         h(requirePermission('view_sales')),   h(retCtrl.list));
router.get('/returns/:id',          h(requirePermission('view_sales')),   h(retCtrl.getOne));
router.get('/returns/for-sale/:saleId', h(requirePermission('view_sales')), h(retCtrl.getSaleForReturn));
router.post('/returns',             h(requirePermission('create_sales')), h(retCtrl.create));
