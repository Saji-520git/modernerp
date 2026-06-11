import { Router } from 'express';
import * as ctrl from './customers.controller.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { asyncHandler as h } from '../../middleware/async-handler.js';

export const router: Router = Router();

router.use(requireAuth);

router.get('/', requirePermission('view_contacts'), ctrl.list);
router.get('/:id', requirePermission('view_contacts'), h(ctrl.getOne));

router.post('/', requirePermission('manage_contacts'), ctrl.create);
router.put('/:id', requirePermission('manage_contacts'), ctrl.update);
router.patch('/:id/toggle-active', requirePermission('manage_contacts'), ctrl.toggleActive);

// Smart delete (hard-delete when no sales history, else soft-delete).
// Registered after the specific routes above so it never shadows them.
router.delete('/:id', requirePermission('manage_contacts'), h(ctrl.remove));
