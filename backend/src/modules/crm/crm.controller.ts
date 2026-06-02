import type { RequestHandler } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import { HttpError } from '../../middleware/error-handler.js';
import { loyaltyService } from './loyalty.service.js';
import { priceTierService } from './priceTier.service.js';
import { intelligenceService, type SpendPeriod } from './intelligence.service.js';
import {
  updateLoyaltyConfigSchema,
  adjustPointsSchema,
  createTierSchema,
  updateTierSchema,
  setProductPricesSchema,
  setCustomerTierSchema,
  addInteractionSchema,
} from './crm.schema.js';

// ─── Loyalty ──────────────────────────────────────────────────────────────────

export const getLoyaltyConfig: RequestHandler = asyncHandler(async (_req, res) => {
  const data = await loyaltyService.getLoyaltyConfig();
  res.json({ success: true, data, message: 'ok' });
});

export const updateLoyaltyConfig: RequestHandler = asyncHandler(async (req, res) => {
  const input = updateLoyaltyConfigSchema.parse(req.body);
  const data = await loyaltyService.updateLoyaltyConfig(input);
  res.json({ success: true, data, message: 'Loyalty config updated' });
});

export const getCustomerLoyalty: RequestHandler = asyncHandler(async (req, res) => {
  const data = await loyaltyService.getCustomerLoyalty(req.params.customerId);
  res.json({ success: true, data, message: 'ok' });
});

export const adjustCustomerPoints: RequestHandler = asyncHandler(async (req, res) => {
  const { points, note } = adjustPointsSchema.parse(req.body);
  const data = await loyaltyService.adjustPoints(req.params.customerId, points, note);
  res.status(201).json({ success: true, data, message: 'Points adjusted' });
});

// ─── Price tiers ────────────────────────────────────────────────────────────

export const getTiers: RequestHandler = asyncHandler(async (_req, res) => {
  const data = await priceTierService.getAllTiers();
  res.json({ success: true, data, message: 'ok' });
});

export const createTier: RequestHandler = asyncHandler(async (req, res) => {
  const input = createTierSchema.parse(req.body);
  const data = await priceTierService.createTier(input);
  res.status(201).json({ success: true, data, message: 'Tier created' });
});

export const updateTier: RequestHandler = asyncHandler(async (req, res) => {
  const input = updateTierSchema.parse(req.body);
  const data = await priceTierService.updateTier(req.params.id, input);
  res.json({ success: true, data, message: 'Tier updated' });
});

export const deleteTier: RequestHandler = asyncHandler(async (req, res) => {
  const data = await priceTierService.deleteTier(req.params.id);
  res.json({ success: true, data, message: 'Tier deleted' });
});

export const getProductPrices: RequestHandler = asyncHandler(async (req, res) => {
  const data = await priceTierService.getProductPrices(req.params.productId);
  res.json({ success: true, data, message: 'ok' });
});

export const setProductPrices: RequestHandler = asyncHandler(async (req, res) => {
  const { prices } = setProductPricesSchema.parse(req.body);
  const productId = req.params.productId;
  const results = [];
  for (const p of prices) {
    results.push(await priceTierService.setProductPrice(productId, p.tierId, p.priceCents));
  }
  res.json({ success: true, data: results, message: 'Product prices saved' });
});

export const setCustomerTier: RequestHandler = asyncHandler(async (req, res) => {
  const { tierId } = setCustomerTierSchema.parse(req.body);
  const data = await priceTierService.setCustomerTier(req.params.customerId, tierId);
  res.json({ success: true, data, message: 'Customer tier updated' });
});

// ─── Intelligence ───────────────────────────────────────────────────────────

const VALID_PERIODS: SpendPeriod[] = ['all', '30d', '90d', '1y'];

export const getTopCustomers: RequestHandler = asyncHandler(async (req, res) => {
  const limit = req.query.limit !== undefined ? Number(req.query.limit) : 10;
  if (!Number.isInteger(limit) || limit <= 0 || limit > 100) {
    throw new HttpError(400, 'Invalid "limit" (1-100)');
  }
  const periodRaw = (req.query.period as string) ?? 'all';
  const period = (VALID_PERIODS.includes(periodRaw as SpendPeriod) ? periodRaw : 'all') as SpendPeriod;
  const data = await intelligenceService.getTopCustomers(limit, period);
  res.json({ success: true, data, message: 'ok' });
});

export const getInactiveCustomers: RequestHandler = asyncHandler(async (req, res) => {
  const daysSince = req.query.daysSince !== undefined ? Number(req.query.daysSince) : 30;
  if (!Number.isInteger(daysSince) || daysSince < 0) {
    throw new HttpError(400, 'Invalid "daysSince"');
  }
  const data = await intelligenceService.getInactiveCustomers(daysSince);
  res.json({ success: true, data, message: 'ok' });
});

export const getCustomerStats: RequestHandler = asyncHandler(async (req, res) => {
  const data = await intelligenceService.getCustomerStats(req.params.id);
  res.json({ success: true, data, message: 'ok' });
});

export const getOwnerDashboard: RequestHandler = asyncHandler(async (_req, res) => {
  const data = await intelligenceService.getOwnerDashboard();
  res.json({ success: true, data, message: 'ok' });
});

export const getPendingFollowUps: RequestHandler = asyncHandler(async (_req, res) => {
  const data = await intelligenceService.getPendingFollowUps();
  res.json({ success: true, data, message: 'ok' });
});

// ─── Interactions ───────────────────────────────────────────────────────────

export const getInteractions: RequestHandler = asyncHandler(async (req, res) => {
  const data = await intelligenceService.getInteractions(req.params.customerId);
  res.json({ success: true, data, message: 'ok' });
});

export const addInteraction: RequestHandler = asyncHandler(async (req, res) => {
  const input = addInteractionSchema.parse(req.body);
  const createdBy = req.auth?.userId;
  if (!createdBy) throw new HttpError(401, 'Not authenticated');
  const data = await intelligenceService.addInteraction({ ...input, createdBy });
  res.status(201).json({ success: true, data, message: 'Interaction added' });
});

export const markInteractionDone: RequestHandler = asyncHandler(async (req, res) => {
  const data = await intelligenceService.markFollowUpDone(req.params.id);
  res.json({ success: true, data, message: 'Follow-up marked done' });
});
