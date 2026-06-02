import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireModule } from '../../middleware/requireModule.js';
import {
  getConfig, updateConfig, testConnection,
  getTemplates, updateTemplate, seedTemplates,
  sendReceipt, sendReminder, sendDailySummary, sendLowStock, sendOffer,
  getLog,
} from './whatsapp.controller.js';

export const router: Router = Router();

// All WhatsApp routes require authentication and the 'whatsapp' module flag.
router.use(requireAuth, requireModule('whatsapp'));

// Config
router.get('/config', getConfig);
router.put('/config', updateConfig);
router.post('/config/test', testConnection);

// Templates
router.get('/templates', getTemplates);
router.put('/templates/:id', updateTemplate);
router.post('/templates/seed', seedTemplates);

// Messaging
router.post('/send/receipt', sendReceipt);
router.post('/send/reminder', sendReminder);
router.post('/send/daily-summary', sendDailySummary);
router.post('/send/low-stock', sendLowStock);
router.post('/send/offer', sendOffer);

// Log
router.get('/log', getLog);
