import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import * as ctrl from './master-data.controller.js';

export const router: Router = Router();

router.use(requireAuth);

// ── Categories ────────────────────────────────────────────────────────────────
router.get('/categories',     requirePermission('view_products'),    ctrl.listCategories);
router.post('/categories',    requirePermission('manage_settings'),  ctrl.createCategory);
router.patch('/categories/:id', requirePermission('manage_settings'), ctrl.updateCategory);
router.delete('/categories/:id', requirePermission('manage_settings'), ctrl.deleteCategory);

// ── Brands ────────────────────────────────────────────────────────────────────
router.get('/brands',     requirePermission('view_products'),    ctrl.listBrands);
router.post('/brands',    requirePermission('manage_settings'),  ctrl.createBrand);
router.patch('/brands/:id', requirePermission('manage_settings'), ctrl.updateBrand);
router.delete('/brands/:id', requirePermission('manage_settings'), ctrl.deleteBrand);

// ── Units ─────────────────────────────────────────────────────────────────────
router.get('/units',     requirePermission('view_products'),    ctrl.listUnits);
router.post('/units',    requirePermission('manage_settings'),  ctrl.createUnit);
router.patch('/units/:id', requirePermission('manage_settings'), ctrl.updateUnit);
router.delete('/units/:id', requirePermission('manage_settings'), ctrl.deleteUnit);
