import { Router } from 'express';
import * as ctrl from './suppliers.controller.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';

export const router: Router = Router();

router.use(requireAuth);

router.get('/', requirePermission('view_contacts'), ctrl.list);
router.get('/:id', requirePermission('view_contacts'), ctrl.getOne);

router.post('/', requirePermission('manage_contacts'), ctrl.create);
router.put('/:id', requirePermission('manage_contacts'), ctrl.update);
router.patch('/:id/toggle-active', requirePermission('manage_contacts'), ctrl.toggleActive);
