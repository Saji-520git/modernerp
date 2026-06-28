import { Router } from 'express';
import * as ctrl from './users.controller.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { asyncHandler as h } from '../../middleware/async-handler.js';

export const router: Router = Router();

router.use(requireAuth);

// All user management requires the manage_users permission (ADMIN only by default)
router.get('/stats', requirePermission('manage_users'), ctrl.stats);
router.get('/', requirePermission('manage_users'), ctrl.list);
router.get('/:id', requirePermission('manage_users'), ctrl.getOne);

router.post('/', requirePermission('manage_users'), h(ctrl.create));
router.put('/:id', requirePermission('manage_users'), h(ctrl.update));
router.patch('/:id/password', requirePermission('manage_users'), h(ctrl.changePassword));
router.patch('/:id/toggle-active', requirePermission('manage_users'), h(ctrl.toggleActive));
router.patch('/:id/permissions', requirePermission('manage_users'), h(ctrl.updatePermissions));
