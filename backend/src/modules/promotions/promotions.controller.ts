import type { RequestHandler } from 'express';
import { promotionsService } from './promotions.service.js';
import { createPromotionSchema, updatePromotionSchema, previewSchema } from './promotions.schema.js';

export const promotionsController = {
  list: (async (_req, res) => {
    res.json(await promotionsService.list());
  }) as RequestHandler,

  getById: (async (req, res) => {
    res.json(await promotionsService.getById(req.params.id));
  }) as RequestHandler,

  create: (async (req, res) => {
    const input = createPromotionSchema.parse(req.body);
    res.status(201).json(await promotionsService.create(input, req.auth?.userId));
  }) as RequestHandler,

  update: (async (req, res) => {
    const input = updatePromotionSchema.parse(req.body);
    res.json(await promotionsService.update(req.params.id, input));
  }) as RequestHandler,

  remove: (async (req, res) => {
    res.json(await promotionsService.remove(req.params.id));
  }) as RequestHandler,

  preview: (async (req, res) => {
    const input = previewSchema.parse(req.body);
    res.json(await promotionsService.preview(input));
  }) as RequestHandler,
};
