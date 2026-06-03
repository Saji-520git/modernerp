import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireModule } from '../../middleware/requireModule.js';
import {
  getDeliveries, getDeliveryStats, getPendingDeliveries, getDelivery,
  createDelivery, updateDelivery, updateDeliveryStatus,
} from './delivery.controller.js';

export const router: Router = Router();

// All delivery routes require authentication and the 'delivery' module flag.
router.use(requireAuth, requireModule('delivery'));

router.get('/', getDeliveries);
router.post('/', createDelivery);
router.get('/stats', getDeliveryStats);       // before /:id
router.get('/pending', getPendingDeliveries); // before /:id
router.get('/:id', getDelivery);
router.put('/:id', updateDelivery);
router.post('/:id/status', updateDeliveryStatus);
