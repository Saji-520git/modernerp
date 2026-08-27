import { Router } from 'express';
import { asyncHandler as h } from '../../middleware/async-handler.js';
import * as ctrl from './dashboard.controller.js';
import { requireAuth } from '../../middleware/auth.js';

export const router: Router = Router();

router.use(requireAuth);

router.get('/summary',       h(ctrl.summary));
router.get('/revenue-chart', h(ctrl.revenueChart));
