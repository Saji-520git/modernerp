import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { asyncHandler as h } from '../../middleware/async-handler.js';
import { requireModule } from '../../middleware/require-module.js';
import * as ctrl from './products.controller.js';

export const router: Router = Router();

router.use(requireAuth);

// Meta endpoint first (before /:id to avoid route collision)
router.get('/meta', requirePermission('view_products'), h(ctrl.meta));

// One-time seed data cleanup — ADMIN only (manage_users = ADMIN-only permission)
router.post('/cleanup-seed-data', requirePermission('manage_users'), h(ctrl.cleanupSeedData));

// Fix scientific-notation barcodes in the DB — ADMIN only
router.post('/fix-barcodes', requirePermission('manage_users'), h(ctrl.cleanupBarcodes));

router.get('/by-barcode/:barcode', requirePermission('view_products'), h(ctrl.getByBarcode));

router.get('/',    requirePermission('view_products'),   h(ctrl.list));
router.get('/:id', requirePermission('view_products'),   h(ctrl.getById));
router.post('/',   requirePermission('manage_products'), h(ctrl.create));
router.patch('/:id',             requirePermission('manage_products'), h(ctrl.update));
router.patch('/:id/toggle-active', requirePermission('manage_products'), h(ctrl.toggleActive));
// Smart delete (hard-delete if no history, else soft-delete). Placed after the
// specific GET routes (/meta, /by-barcode/:barcode) so there is no collision.
router.delete('/:id',            requirePermission('manage_products'), h(ctrl.remove));

// Optional module, so it can be withheld from a client who should not be able
// to walk out with the catalogue. Enforced here, not only in the nav.
router.get('/export/csv', requireModule('productExport'), requirePermission('view_products'), h(ctrl.exportCsv));

// Unit conversions sub-resource
router.get( '/:id/conversions', requirePermission('view_products'),   h(ctrl.getConversions));
router.put( '/:id/conversions', requirePermission('manage_products'), h(ctrl.setConversions));
