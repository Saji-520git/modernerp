import type { RequestHandler } from 'express';
import { posService } from './pos.service.js';
import { checkoutSchema, productSearchSchema, listSalesSchema, saveDraftSchema, openShiftSchema, closeShiftSchema, forceCloseShiftSchema, listShiftsSchema } from './pos.schema.js';
import { HttpError } from '../../middleware/error-handler.js';

export const searchProducts: RequestHandler = async (req, res) => {
  const input = productSearchSchema.parse(req.query);
  res.json(await posService.searchProducts(input));
};

export const getWarehouses: RequestHandler = async (_req, res) => {
  res.json(await posService.getWarehouses());
};

export const checkout: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const input = checkoutSchema.parse(req.body);
  const perms = req.auth.permissions as string[];
  const result = await posService.checkout(
    input,
    req.auth.userId,
    perms.includes('adjust_sale_price'),
    perms.includes('sell_on_credit'),
    perms.includes('manage_credit'),
  );
  res.status(201).json(result);
};

export const getReceipt: RequestHandler = async (req, res) => {
  res.json(await posService.getReceipt(req.params.id));
};

export const listSales: RequestHandler = async (req, res) => {
  const input = listSalesSchema.parse(req.query);
  res.json(await posService.listSales(input));
};

// ─── Drafts ───────────────────────────────────────────────────────────────────

export const listDrafts: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  res.json(await posService.listDrafts(req.auth.userId));
};

export const saveDraft: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const input = saveDraftSchema.parse(req.body);
  res.json(await posService.saveDraft(input, req.auth.userId));
};

export const deleteDraft: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  res.json(await posService.deleteDraft(req.params.id, req.auth.userId));
};

// ─── Customer credit ──────────────────────────────────────────────────────────

export const getCustomerCredit: RequestHandler = async (req, res) => {
  res.json(await posService.getCustomerCredit(req.params.customerId));
};

// ─── Shift management ─────────────────────────────────────────────────────────

export const openShift: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const input = openShiftSchema.parse(req.body);
  const shift = await posService.openShift(req.auth.userId, input);
  res.status(201).json(shift);
};

export const getCurrentShift: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const warehouseId = req.query.warehouseId as string | undefined;
  const shift = await posService.getCurrentShift(req.auth.userId, warehouseId);
  res.json(shift ?? null);
};

export const closeShift: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const input = closeShiftSchema.parse(req.body);
  const shift = await posService.closeShift(req.auth.userId, input);
  res.json(shift);
};

export const forceCloseShift: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const { id } = req.params;
  const input = forceCloseShiftSchema.parse(req.body);
  const shift = await posService.forceCloseShift(req.auth.userId, id, input);
  res.json(shift);
};

export const listShifts: RequestHandler = async (req, res) => {
  const input = listShiftsSchema.parse(req.query);
  res.json(await posService.listShifts(input));
};

export const getShift: RequestHandler = async (req, res) => {
  res.json(await posService.getShift(req.params.id));
};
