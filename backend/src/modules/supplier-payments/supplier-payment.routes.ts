import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { asyncHandler } from '../../middleware/async-handler.js';
import * as ctrl from './supplier-payment.controller.js';

export const router = Router();

// All routes require authentication
router.use(requireAuth);

// POST /api/v1/supplier-payments           — create payment (ADMIN, MANAGER)
router.post(
  '/',
  requirePermission('confirm_purchases'),
  asyncHandler(ctrl.createPayment),
);

// POST /api/v1/supplier-payments/lump-sum — one payment across many POs (oldest-first)
router.post(
  '/lump-sum',
  requirePermission('confirm_purchases'),
  asyncHandler(ctrl.createLumpSumPayment),
);

// POST /api/v1/supplier-payments/credit   — receive credit back from supplier
router.post(
  '/credit',
  requirePermission('confirm_purchases'),
  asyncHandler(ctrl.receiveCredit),
);

// POST /api/v1/supplier-payments/apply-credit — spend stored supplier credit across POs
router.post(
  '/apply-credit',
  requirePermission('confirm_purchases'),
  asyncHandler(ctrl.applyCredit),
);

// GET  /api/v1/supplier-payments/credit-ledger/:supplierId
router.get(
  '/credit-ledger/:supplierId',
  requirePermission('view_purchases'),
  asyncHandler(ctrl.listCreditLedger),
);

// GET  /api/v1/supplier-payments/purchase/:purchaseId  — list for a PO
router.get(
  '/purchase/:purchaseId',
  requirePermission('view_purchases'),
  asyncHandler(ctrl.listByPurchase),
);

// GET  /api/v1/supplier-payments/supplier/:supplierId  — list for a supplier
router.get(
  '/supplier/:supplierId',
  requirePermission('view_purchases'),
  asyncHandler(ctrl.listBySupplier),
);

// GET  /api/v1/supplier-payments/:id/voucher-data
router.get(
  '/:id/voucher-data',
  requirePermission('view_purchases'),
  asyncHandler(ctrl.getVoucherData),
);

// DELETE /api/v1/supplier-payments/:id     — void (ADMIN only)
router.delete(
  '/:id',
  requirePermission('confirm_purchases'),  // MANAGER+ gate
  asyncHandler(ctrl.voidPayment),
);

