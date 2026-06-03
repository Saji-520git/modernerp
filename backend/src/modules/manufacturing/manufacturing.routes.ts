import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireModule } from '../../middleware/requireModule.js';
import {
  getBOMs, getBOM, getBOMByProduct, createBOM, updateBOM, deleteBOM,
  getOrders, getProductionStats, getOrder, createOrder,
  startOrder, completeOrder, cancelOrder,
} from './manufacturing.controller.js';

export const router: Router = Router();

// All manufacturing routes require auth and the 'manufacturing' module flag.
router.use(requireAuth, requireModule('manufacturing'));

// ─── BOM ──────────────────────────────────────────────────────────────────────
router.get('/boms', getBOMs);
router.post('/boms', createBOM);
router.get('/boms/by-product/:productId', getBOMByProduct);  // before /:id
router.get('/boms/:id', getBOM);
router.put('/boms/:id', updateBOM);
router.delete('/boms/:id', deleteBOM);

// ─── Production orders ──────────────────────────────────────────────────────────
router.get('/orders', getOrders);
router.post('/orders', createOrder);
router.get('/orders/stats', getProductionStats);   // before /:id
router.get('/orders/:id', getOrder);
router.post('/orders/:id/start', startOrder);
router.post('/orders/:id/complete', completeOrder);
router.post('/orders/:id/cancel', cancelOrder);
