import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { getSettings, updateSettings, updateModules } from './settings.controller.js';

export const router: Router = Router();

router.get('/',        requireAuth, requirePermission('view_settings'),   getSettings);
router.patch('/',      requireAuth, requirePermission('manage_settings'), updateSettings);
// Module on/off is super-admin only.
router.patch('/modules', requireAuth, requirePermission('manage_modules'), updateModules);
