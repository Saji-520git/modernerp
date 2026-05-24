import type { RequestHandler } from 'express';
import { salesService } from './sales.service.js';
import {
  createSaleSchema,
  updateSaleSchema,
  listSalesSchema,
  recordPaymentSchema,
} from './sales.schema.js';
import { HttpError } from '../../middleware/error-handler.js';

export const listCustomers: RequestHandler = async (_req, res) => {
  res.json(await salesService.listCustomers());
};

export const listProducts: RequestHandler = async (req, res) => {
  const warehouseId = req.query.warehouseId as string | undefined;
  res.json(await salesService.listProducts(warehouseId));
};

export const listSales: RequestHandler = async (req, res) => {
  const input = listSalesSchema.parse(req.query);
  res.json(await salesService.listSales(input));
};

export const getSale: RequestHandler = async (req, res) => {
  res.json(await salesService.getSale(req.params.id));
};

export const createSale: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const input = createSaleSchema.parse(req.body);
  res.status(201).json(await salesService.createSale(input, req.auth.userId));
};

export const confirmSale: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  res.json(await salesService.confirmSale(req.params.id));
};

export const cancelSale: RequestHandler = async (req, res) => {
  res.json(await salesService.cancelSale(req.params.id));
};

export const updateSale: RequestHandler = async (req, res) => {
  const input = updateSaleSchema.parse(req.body);
  res.json(await salesService.updateSale(req.params.id, input));
};

export const recordPayment: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const input = recordPaymentSchema.parse(req.body);
  res.json(await salesService.recordPayment(req.params.id, input, req.auth.userId));
};

export const listPayments: RequestHandler = async (req, res) => {
  res.json(await salesService.listPayments(req.params.id));
};

export const deleteSale: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const result = await salesService.deleteSale(req.params.id, req.auth.userId);
  res.json(result);
};
