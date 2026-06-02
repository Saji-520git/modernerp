import { Router } from 'express';
import { requireAuth } from '../../middleware/auth.js';
import { requireModule } from '../../middleware/requireModule.js';
import {
  getLoyaltyConfig, updateLoyaltyConfig, getCustomerLoyalty, adjustCustomerPoints,
  getTiers, createTier, updateTier, deleteTier,
  getProductPrices, setProductPrices, setCustomerTier,
  getTopCustomers, getInactiveCustomers, getCustomerStats, getOwnerDashboard, getPendingFollowUps,
  getInteractions, addInteraction, markInteractionDone,
} from './crm.controller.js';

export const router: Router = Router();

// All CRM routes require authentication and the 'crm' module flag.
router.use(requireAuth, requireModule('crm'));

// Loyalty — /config is registered before /:customerId to avoid param capture.
router.get('/loyalty/config', getLoyaltyConfig);
router.put('/loyalty/config', updateLoyaltyConfig);
router.get('/loyalty/:customerId', getCustomerLoyalty);
router.post('/loyalty/:customerId/adjust', adjustCustomerPoints);

// Price tiers
router.get('/tiers', getTiers);
router.post('/tiers', createTier);
router.put('/tiers/:id', updateTier);
router.delete('/tiers/:id', deleteTier);
router.get('/tiers/product/:productId', getProductPrices);
router.put('/tiers/product/:productId', setProductPrices);
router.put('/tiers/customer/:customerId', setCustomerTier);

// Intelligence
router.get('/intelligence/top-customers', getTopCustomers);
router.get('/intelligence/inactive', getInactiveCustomers);
router.get('/intelligence/customer/:id', getCustomerStats);
router.get('/intelligence/dashboard', getOwnerDashboard);
router.get('/intelligence/followups', getPendingFollowUps);

// Interactions
router.get('/interactions/:customerId', getInteractions);
router.post('/interactions', addInteraction);
router.put('/interactions/:id/done', markInteractionDone);
