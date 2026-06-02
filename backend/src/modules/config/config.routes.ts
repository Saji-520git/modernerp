import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireSuperAdmin } from '../../middleware/requireSuperAdmin.js';
import {
  getModules,
  getClient,
  updateModules,
  updateClient,
  applyTemplate,
} from './config.controller.js';

export const router: Router = Router();

// Read endpoints — any authenticated user (frontend needs to know what is on)
router.get('/modules', requireAuth, getModules);
router.get('/client',  requireAuth, getClient);

// Write endpoints — super-admin (BROcode Solutions staff) only
router.put('/modules',  requireAuth, requireSuperAdmin, updateModules);
router.put('/client',   requireAuth, requireSuperAdmin, updateClient);
router.post('/template', requireAuth, requireSuperAdmin, applyTemplate);
