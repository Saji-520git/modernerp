import { Router } from 'express';
import * as ctrl from './data-management.controller.js';
import { requireAuth, requirePermission } from '../../middleware/auth.js';
import { requireModule } from '../../middleware/require-module.js';
import { asyncHandler as h } from '../../middleware/async-handler.js';

export const router: Router = Router();

// Data Management is a super-admin tool: the module must be enabled (super-admin
// bypasses the gate) AND the caller must hold clear_data — a super-admin-only
// permission never granted to a client role. Double-gated by design.
router.use(requireAuth, requireModule('dataManagement'), requirePermission('clear_data'));

router.get('/summary',         h(ctrl.summary));
router.get('/backup',          h(ctrl.backup));   // full JSON snapshot (download)
router.post('/clear-entities', h(ctrl.clearEntities));

// Tiered factory reset — preview (read-only) + execute (destructive, password-gated).
router.get('/reset/preview',   h(ctrl.resetPreview));
router.post('/reset/execute',  h(ctrl.resetExecute));

// Restore from a backup JSON — preview (read-only) + execute (wipe+import, password-gated).
router.post('/restore/preview', h(ctrl.restorePreview));
router.post('/restore/execute', h(ctrl.restoreExecute));
