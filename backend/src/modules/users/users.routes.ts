import { Router } from 'express';
import * as ctrl from './users.controller.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { requireModule } from '../../middleware/require-module.js';
import { asyncHandler as h } from '../../middleware/async-handler.js';

export const router: Router = Router();

// User Management is a per-client module. The client's own admin only reaches it
// when the super-admin enables 'userManagement'; the super-admin always bypasses.
router.use(requireAuth, requireModule('userManagement'));

// All user management requires the manage_users permission (ADMIN only by default)
router.get('/stats', requirePermission('manage_users'), h(ctrl.stats));
router.get('/', requirePermission('manage_users'), h(ctrl.list));
router.get('/:id', requirePermission('manage_users'), h(ctrl.getOne));

router.post('/', requirePermission('manage_users'), h(ctrl.create));
router.put('/:id', requirePermission('manage_users'), h(ctrl.update));
router.patch('/:id/password', requirePermission('manage_users'), h(ctrl.changePassword));
router.patch('/:id/toggle-active', requirePermission('manage_users'), h(ctrl.toggleActive));
router.patch('/:id/permissions', requirePermission('manage_users'), h(ctrl.updatePermissions));
