import type { RequestHandler } from 'express';
import { stockTakeService } from './stocktake.service.js';
import { createStockTakeSchema, saveCountsSchema } from './stocktake.schema.js';
import { HttpError } from '../../middleware/error-handler.js';

export const stockTakeController = {
  list: (async (_req, res) => {
    res.json(await stockTakeService.list());
  }) as RequestHandler,

  getById: (async (req, res) => {
    res.json(await stockTakeService.getById(req.params.id));
  }) as RequestHandler,

  create: (async (req, res) => {
    if (!req.auth) throw new HttpError(401, 'Not authenticated');
    const input = createStockTakeSchema.parse(req.body);
    res.status(201).json(await stockTakeService.create(input, req.auth.userId));
  }) as RequestHandler,

  saveCounts: (async (req, res) => {
    const input = saveCountsSchema.parse(req.body);
    res.json(await stockTakeService.saveCounts(req.params.id, input));
  }) as RequestHandler,

  confirm: (async (req, res) => {
    if (!req.auth) throw new HttpError(401, 'Not authenticated');
    res.json(await stockTakeService.confirm(req.params.id, req.auth.userId));
  }) as RequestHandler,

  cancel: (async (req, res) => {
    res.json(await stockTakeService.cancel(req.params.id));
  }) as RequestHandler,
};
