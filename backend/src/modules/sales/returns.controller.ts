import type { RequestHandler } from 'express';
import { returnsService } from './returns.service.js';
import { createReturnSchema, listReturnsSchema } from './returns.schema.js';
import { HttpError } from '../../middleware/error-handler.js';

export const list: RequestHandler = async (req, res) => {
  const input = listReturnsSchema.parse(req.query);
  res.json(await returnsService.list(input));
};

export const getOne: RequestHandler = async (req, res) => {
  res.json(await returnsService.getOne(req.params.id));
};

export const getSaleForReturn: RequestHandler = async (req, res) => {
  res.json(await returnsService.getSaleForReturn(req.params.saleId));
};

export const create: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const input = createReturnSchema.parse(req.body);
  res.status(201).json(await returnsService.create(input, req.auth.userId));
};
