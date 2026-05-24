import { Router } from 'express';
import * as ctrl from './users.controller.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';

export const router: Router = Router();

router.use(requireAuth);

// All user management requires the manage_users permission (ADMIN only by default)
router.get('/stats', requirePermission('manage_users'), ctrl.stats);
router.get('/', requirePermission('manage_users'), ctrl.list);
router.get('/:id', requirePermission('manage_users'), ctrl.getOne);

router.post('/', requirePermission('manage_users'), ctrl.create);
router.put('/:id', requirePermission('manage_users'), ctrl.update);
router.patch('/:id/password', requirePermission('manage_users'), ctrl.changePassword);
router.patch('/:id/toggle-active', requirePermission('manage_users'), ctrl.toggleActive);
router.patch('/:id/permissions', requirePermission('manage_users'), ctrl.updatePermissions);
