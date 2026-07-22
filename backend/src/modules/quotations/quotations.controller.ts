import type { RequestHandler } from 'express';
import { quotationsService } from './quotations.service.js';
import { createQuotationSchema, updateQuotationSchema, setStatusSchema, convertSchema } from './quotations.schema.js';
import { HttpError } from '../../middleware/error-handler.js';

export const quotationsController = {
  list: (async (_req, res) => {
    res.json(await quotationsService.list());
  }) as RequestHandler,

  getById: (async (req, res) => {
    res.json(await quotationsService.getById(req.params.id));
  }) as RequestHandler,

  create: (async (req, res) => {
    if (!req.auth) throw new HttpError(401, 'Not authenticated');
    const input = createQuotationSchema.parse(req.body);
    res.status(201).json(await quotationsService.create(input, req.auth.userId));
  }) as RequestHandler,

  update: (async (req, res) => {
    const input = updateQuotationSchema.parse(req.body);
    res.json(await quotationsService.update(req.params.id, input));
  }) as RequestHandler,

  setStatus: (async (req, res) => {
    const input = setStatusSchema.parse(req.body);
    res.json(await quotationsService.setStatus(req.params.id, input));
  }) as RequestHandler,

  remove: (async (req, res) => {
    res.json(await quotationsService.remove(req.params.id));
  }) as RequestHandler,

  convert: (async (req, res) => {
    if (!req.auth) throw new HttpError(401, 'Not authenticated');
    const input = convertSchema.parse(req.body);
    res.json(await quotationsService.convertToSale(req.params.id, input.warehouseId, req.auth.userId));
  }) as RequestHandler,
};
