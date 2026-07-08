import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requirePermission } from '../../middleware/auth.js';
import { asyncHandler as h } from '../../middleware/async-handler.js';
import * as ctrl from './customer-payment.controller.js';

export const router = Router();

router.use(requireAuth);

router.post(  '/',                              h(ctrl.createCustomerPayment));
router.post(  '/lump-sum',                      h(requirePermission('record_payments')), h(ctrl.createLumpSumCustomerPayment));
router.get(   '/credit-ledger/:customerId',     h(ctrl.listCustomerCreditLedger));
router.get(   '/sale/:saleId',                  h(ctrl.listCustomerPayments));
router.get(   '/customer/:customerId',           h(ctrl.listPaymentsByCustomer));
router.delete('/:id',                           h(requirePermission('manage_settings')), h(ctrl.voidCustomerPayment));
