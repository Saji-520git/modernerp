import type { RequestHandler } from 'express';
import { purchaseService } from './purchases.service.js';
import { createPurchaseSchema, updatePurchaseSchema, listPurchasesSchema, fromAlertsSchema } from './purchases.schema.js';
import { HttpError } from '../../middleware/error-handler.js';

export const listSuppliers: RequestHandler = async (_req, res) => {
  const result = await purchaseService.listSuppliers();
  res.json(result);
};

export const listProducts: RequestHandler = async (_req, res) => {
  const result = await purchaseService.listProducts();
  res.json(result);
};

export const listPurchases: RequestHandler = async (req, res) => {
  const input = listPurchasesSchema.parse(req.query);
  const result = await purchaseService.listPurchases(input);
  res.json(result);
};

export const getPurchase: RequestHandler = async (req, res) => {
  const result = await purchaseService.getPurchase(req.params.id);
  res.json(result);
};

export const createPurchase: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const input = createPurchaseSchema.parse(req.body);
  const result = await purchaseService.createPurchase(input, req.auth.userId);
  res.status(201).json(result);
};

export const confirmPurchase: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  // Default FULL preserves the existing one-step confirm-and-receive behaviour.
  const receiveMode = req.body?.receiveMode === 'AWAIT_GRN' ? 'AWAIT_GRN' : 'FULL';
  const result = await purchaseService.confirmPurchase(req.params.id, req.auth.userId, receiveMode);
  res.json(result);
};

export const cancelPurchase: RequestHandler = async (req, res) => {
  const result = await purchaseService.cancelPurchase(req.params.id);
  res.json(result);
};

export const updatePurchase: RequestHandler = async (req, res) => {
  const input  = updatePurchaseSchema.parse(req.body);
  const result = await purchaseService.updatePurchase(req.params.id, input);
  res.json(result);
};

export const fromAlerts: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const input = fromAlertsSchema.parse(req.body);
  const result = await purchaseService.fromAlerts(input, req.auth.userId);
  res.status(201).json(result);
};

export const deletePurchase: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const result = await purchaseService.deletePurchase(req.params.id, req.auth.userId);
  res.json(result);
};
