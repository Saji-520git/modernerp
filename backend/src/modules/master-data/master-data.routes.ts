import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { asyncHandler as h } from '../../middleware/async-handler.js';
import * as ctrl from './master-data.controller.js';

// Categories, brands and units are master data, not system configuration.
// manage_settings still implies settings.master_data, so nobody who could edit
// them before loses that; the split lets a stock manager maintain the catalogue
// without also holding the keys to receipt layout, alerts and warehouses.
export const router: Router = Router();

router.use(requireAuth);

// ── Categories ────────────────────────────────────────────────────────────────
router.get('/categories',     requirePermission('view_products'),    h(ctrl.listCategories));
router.post('/categories',    requirePermission('settings.master_data'),  h(ctrl.createCategory));
router.patch('/categories/:id', requirePermission('settings.master_data'), h(ctrl.updateCategory));
router.delete('/categories/:id', requirePermission('settings.master_data'), h(ctrl.deleteCategory));

// ── Brands ────────────────────────────────────────────────────────────────────
router.get('/brands',     requirePermission('view_products'),    h(ctrl.listBrands));
router.post('/brands',    requirePermission('settings.master_data'),  h(ctrl.createBrand));
router.patch('/brands/:id', requirePermission('settings.master_data'), h(ctrl.updateBrand));
router.delete('/brands/:id', requirePermission('settings.master_data'), h(ctrl.deleteBrand));

// ── Units ─────────────────────────────────────────────────────────────────────
router.get('/units',     requirePermission('view_products'),    h(ctrl.listUnits));
router.post('/units',    requirePermission('settings.master_data'),  h(ctrl.createUnit));
router.patch('/units/:id', requirePermission('settings.master_data'), h(ctrl.updateUnit));
router.delete('/units/:id', requirePermission('settings.master_data'), h(ctrl.deleteUnit));
