import { Router } from 'express';
import * as ctrl from './auth.controller.js';
import { requireAuth } from '../../middleware/auth.js';
import { asyncHandler as h } from '../../middleware/async-handler.js';

export const router: Router = Router();

router.post('/login', h(ctrl.login));
// SECURITY: /register is intentionally disabled — user creation is admin-only via POST /api/v1/users
// router.post('/register', ctrl.register);
router.get('/me', requireAuth, h(ctrl.me));
