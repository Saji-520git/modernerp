import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import {
  listWarehouses,
  getWarehouse,
  createWarehouse,
  updateWarehouse,
  toggleWarehouse,
  setDefaultWarehouse,
  getWarehouseStats,
} from './warehouses.controller.js';

export const router: Router = Router();

router.get('/',                  requireAuth, listWarehouses);
router.post('/',                 requireAuth, requirePermission('manage_settings'), createWarehouse);
router.get('/:id/stats',         requireAuth, getWarehouseStats);
router.get('/:id',               requireAuth, getWarehouse);
router.patch('/:id',             requireAuth, requirePermission('manage_settings'), updateWarehouse);
router.post('/:id/toggle',       requireAuth, requirePermission('manage_settings'), toggleWarehouse);
router.post('/:id/set-default',  requireAuth, requirePermission('manage_settings'), setDefaultWarehouse);
