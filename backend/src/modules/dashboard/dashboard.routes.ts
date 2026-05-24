import { Router } from 'express';
import * as ctrl from './dashboard.controller.js';
import { requireAuth } from '../../middleware/auth.js';

export const router: Router = Router();

router.use(requireAuth);

router.get('/summary',       ctrl.summary);
router.get('/revenue-chart', ctrl.revenueChart);
