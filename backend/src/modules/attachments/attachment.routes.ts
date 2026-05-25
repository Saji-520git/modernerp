import { Router } from 'express';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { asyncHandler as h } from '../../middleware/async-handler.js';
import { uploadMiddleware } from '../../middleware/upload.middleware.js';
import * as ctrl from './attachment.controller.js';

export const router: Router = Router();

router.use(h(requireAuth));

// Upload a file (any authenticated user)
router.post(
  '/',
  uploadMiddleware.single('file'),
  h(ctrl.createAttachment),
);

// List attachments for a ref (any authenticated user)
router.get('/:refType/:refId', h(ctrl.listAttachments));

// Delete an attachment (ADMIN / MANAGER — manage_settings covers both)
router.delete('/:id', h(requirePermission('manage_settings')), h(ctrl.deleteAttachment));
