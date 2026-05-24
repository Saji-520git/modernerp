import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { getSettings, updateSettings } from './settings.controller.js';

export const router: Router = Router();

router.get('/',   requireAuth, requirePermission('view_settings'),   getSettings);
router.patch('/', requireAuth, requirePermission('manage_settings'), updateSettings);
