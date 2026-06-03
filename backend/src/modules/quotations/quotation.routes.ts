import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireModule } from '../../middleware/requireModule.js';
import {
  getQuotations, getQuotationStats, getQuotation,
  createQuotation, updateQuotation, deleteQuotation,
  updateQuotationStatus, convertQuotation, duplicateQuotation,
  sendQuotationWhatsApp,
} from './quotation.controller.js';

export const router: Router = Router();

// All quotation routes require authentication and the 'quotations' module flag.
router.use(requireAuth, requireModule('quotations'));

router.get('/', getQuotations);
router.post('/', createQuotation);
router.get('/stats', getQuotationStats);   // before /:id
router.get('/:id', getQuotation);
router.put('/:id', updateQuotation);
router.delete('/:id', deleteQuotation);
router.post('/:id/status', updateQuotationStatus);
router.post('/:id/convert', convertQuotation);
router.post('/:id/duplicate', duplicateQuotation);
router.post('/:id/send-whatsapp', sendQuotationWhatsApp);
