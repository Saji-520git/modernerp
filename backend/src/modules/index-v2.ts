import { Router } from 'express';
import { router as configRouter } from './config/config.routes.js';
import { router as crmRouter } from './crm/crm.routes.js';
import { router as deliveryRouter } from './delivery/delivery.routes.js';
import { router as hrRouter } from './hr/hr.routes.js';
import { router as quotationRouter } from './quotations/quotation.routes.js';
import { router as tenantRouter } from './tenants/tenant.routes.js';
import { router as whatsappRouter } from './whatsapp/whatsapp.routes.js';

// v2 API aggregator — mounted at /api/v2. New v2 modules register here.
export const router: Router = Router();

router.get('/', (_req, res) => res.json({ name: 'BROcode ERP API', version: 'v2' }));

router.use('/config', configRouter);
router.use('/crm', crmRouter);
router.use('/deliveries', deliveryRouter);
router.use('/hr', hrRouter);
router.use('/quotations', quotationRouter);
router.use('/tenants', tenantRouter);
router.use('/whatsapp', whatsappRouter);
