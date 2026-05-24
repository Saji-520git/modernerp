import { Router } from 'express';
import * as ctrl from './purchases.controller.js';
// NOTE: /from-alerts must be registered before /:id routes to avoid Express
//       treating "from-alerts" as an id parameter.
import * as receiptCtrl from './purchase-receipt.controller.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { asyncHandler as h } from '../../middleware/async-handler.js';

export const router: Router = Router();

router.use(h(requireAuth));

router.get('/suppliers', h(ctrl.listSuppliers));
router.get('/products',  h(requirePermission('view_products')),   h(ctrl.listProducts));

// Receipts by ID — must come before /:id to avoid route collision
router.get('/receipts/:rid', h(requirePermission('view_purchases')), h(receiptCtrl.getReceiptHandler));

router.get('/',          h(requirePermission('view_purchases')),  h(ctrl.listPurchases));
router.get('/:id',       h(requirePermission('view_purchases')),  h(ctrl.getPurchase));

router.post('/from-alerts', h(requirePermission('create_purchases')),  h(ctrl.fromAlerts));
router.post('/',           h(requirePermission('create_purchases')),  h(ctrl.createPurchase));
router.patch('/:id',       h(requirePermission('create_purchases')),  h(ctrl.updatePurchase));
router.patch('/:id/confirm', h(requirePermission('confirm_purchases')), h(ctrl.confirmPurchase));
router.patch('/:id/cancel',  h(requirePermission('create_purchases')), h(ctrl.cancelPurchase));
router.delete('/:id',      h(requirePermission('create_purchases')),  h(ctrl.deletePurchase));
router.post('/:id/payments', h(requirePermission('create_purchases')), h(ctrl.recordSupplierPayment));
router.get('/:id/payments',  h(requirePermission('view_purchases')),  h(ctrl.listPurchasePayments));

// GRN Receipts
router.post('/:id/receipts', h(requirePermission('confirm_purchases')), h(receiptCtrl.createReceiptHandler));
router.get('/:id/receipts',  h(requirePermission('view_purchases')),    h(receiptCtrl.listReceiptsHandler));
