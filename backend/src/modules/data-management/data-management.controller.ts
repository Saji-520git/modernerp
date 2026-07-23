import type { RequestHandler } from 'express';
import { z } from 'zod';
import { HttpError } from '../../middleware/error-handler.js';
import { dataManagementService } from './data-management.service.js';
import { resetService } from './data-management.reset.js';
import { backupService } from './data-management.backup.js';

export const summary: RequestHandler = async (_req, res) => {
  res.json(await dataManagementService.summary());
};

export const backup: RequestHandler = async (_req, res) => {
  const data = await backupService.exportAll();
  const stamp = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Content-Disposition', `attachment; filename="brocode-backup-${stamp}.json"`);
  res.send(JSON.stringify(data));
};

const clearSchema = z.object({
  type: z.enum(['product', 'supplier', 'customer']),
  ids:  z.array(z.string().min(1)).min(1).max(1000),
});

export const clearEntities: RequestHandler = async (req, res) => {
  const input = clearSchema.parse(req.body);
  res.json(await dataManagementService.clearEntities(input.type, input.ids));
};

const presetEnum = z.enum(['transactions', 'keepProducts', 'full']);

export const resetPreview: RequestHandler = async (req, res) => {
  const preset = presetEnum.parse(req.query.preset);
  res.json(await resetService.preview(preset));
};

const executeSchema = z.object({
  preset:   presetEnum,
  password: z.string().min(1),
  confirm:  z.string(),
});

export const resetExecute: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const input = executeSchema.parse(req.body);
  if (input.confirm !== 'RESET') throw new HttpError(400, 'Type RESET to confirm');
  res.json(await resetService.execute(input.preset, req.auth.userId, input.password));
};
