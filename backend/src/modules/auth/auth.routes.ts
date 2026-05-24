import { Router } from 'express';
import * as ctrl from './auth.controller.js';
import { requireAuth } from '../../middleware/auth.js';

export const router: Router = Router();

router.post('/login', ctrl.login);
// SECURITY: /register is intentionally disabled — user creation is admin-only via POST /api/v1/users
// router.post('/register', ctrl.register);
router.get('/me', requireAuth, ctrl.me);
