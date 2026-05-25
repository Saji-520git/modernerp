import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { asyncHandler as h } from '../../middleware/async-handler.js';
import * as ctrl from './purchase-return.controller.js';

export const router = Router();

router.use(requireAuth);

router.get(  '/',               h(requirePermission('view_purchases')),    h(ctrl.listReturns));
router.get(  '/:id',            h(requirePermission('view_purchases')),    h(ctrl.getReturn));
router.get(  '/:id/debit-note', h(requirePermission('view_purchases')),    h(ctrl.getDebitNote));
router.post( '/',               h(requirePermission('create_purchases')),  h(ctrl.createReturn));
router.patch('/:id/confirm',    h(requirePermission('confirm_purchases')), h(ctrl.confirmReturn));
router.patch('/:id/cancel',     h(requirePermission('create_purchases')),  h(ctrl.cancelReturn));
router.delete('/:id',           h(requirePermission('create_purchases')),  h(ctrl.deleteReturn));
