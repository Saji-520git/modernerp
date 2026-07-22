import type { RequestHandler } from 'express';
import { loyaltyService } from './loyalty.service.js';
import { updateLoyaltyConfigSchema, adjustPointsSchema } from './loyalty.schema.js';

export const loyaltyController = {
  getConfig: (async (_req, res) => {
    res.json(await loyaltyService.getConfig());
  }) as RequestHandler,

  updateConfig: (async (req, res) => {
    const input = updateLoyaltyConfigSchema.parse(req.body);
    res.json(await loyaltyService.updateConfig(input));
  }) as RequestHandler,

  getCustomer: (async (req, res) => {
    res.json(await loyaltyService.getCustomerLoyalty(req.params.customerId));
  }) as RequestHandler,

  adjust: (async (req, res) => {
    const input = adjustPointsSchema.parse(req.body);
    res.json(await loyaltyService.adjust(req.params.customerId, input));
  }) as RequestHandler,
};
