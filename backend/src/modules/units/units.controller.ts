import type { Request, Response } from 'express';
import { unitsService } from './units.service.js';
import { createUnitSchema, updateUnitSchema, listUnitsSchema } from './units.schema.js';

export const unitsController = {

  async list(req: Request, res: Response) {
    const input = listUnitsSchema.parse(req.query);
    const result = await unitsService.list(input);
    res.json(result);
  },

  async getById(req: Request, res: Response) {
    const unit = await unitsService.getById(req.params.id);
    res.json(unit);
  },

  async create(req: Request, res: Response) {
    const input = createUnitSchema.parse(req.body);
    const unit = await unitsService.create(input);
    res.status(201).json(unit);
  },

  async update(req: Request, res: Response) {
    const input = updateUnitSchema.parse(req.body);
    const unit = await unitsService.update(req.params.id, input);
    res.json(unit);
  },

  async softDelete(req: Request, res: Response) {
    const result = await unitsService.softDelete(req.params.id);
    res.json(result);
  },
};
