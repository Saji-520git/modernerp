import type { RequestHandler } from 'express';
import { z } from 'zod';
import { dataManagementService } from './data-management.service.js';

export const summary: RequestHandler = async (_req, res) => {
  res.json(await dataManagementService.summary());
};

const clearSchema = z.object({
  type: z.enum(['product', 'supplier', 'customer']),
  ids:  z.array(z.string().min(1)).min(1).max(1000),
});

export const clearEntities: RequestHandler = async (req, res) => {
  const input = clearSchema.parse(req.body);
  res.json(await dataManagementService.clearEntities(input.type, input.ids));
};
