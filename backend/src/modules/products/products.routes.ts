import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import * as ctrl from './products.controller.js';

export const router: Router = Router();

router.use(requireAuth);

// Meta endpoint first (before /:id to avoid route collision)
router.get('/meta', requirePermission('view_products'), ctrl.meta);

// One-time seed data cleanup — ADMIN only (manage_users = ADMIN-only permission)
router.post('/cleanup-seed-data', requirePermission('manage_users'), ctrl.cleanupSeedData);

// Fix scientific-notation barcodes in the DB — ADMIN only
router.post('/fix-barcodes', requirePermission('manage_users'), ctrl.cleanupBarcodes);

router.get('/by-barcode/:barcode', requirePermission('view_products'), ctrl.getByBarcode);

router.get('/',    requirePermission('view_products'),   ctrl.list);
router.get('/:id', requirePermission('view_products'),   ctrl.getById);
router.post('/',   requirePermission('manage_products'), ctrl.create);
router.patch('/:id',             requirePermission('manage_products'), ctrl.update);
router.patch('/:id/toggle-active', requirePermission('manage_products'), ctrl.toggleActive);

// Unit conversions sub-resource
router.get( '/:id/conversions', requirePermission('view_products'),   ctrl.getConversions);
router.put( '/:id/conversions', requirePermission('manage_products'), ctrl.setConversions);
