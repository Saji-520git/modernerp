import type { RequestHandler } from 'express';
import { settingsService } from './settings.service.js';
import { updateSettingsSchema, updateModulesSchema } from './settings.schema.js';
import { asyncHandler } from '../../middleware/async-handler.js';

export const getSettings: RequestHandler = asyncHandler(async (_req, res) => {
  const settings = await settingsService.get();
  res.json(settings);
});

export const updateSettings: RequestHandler = asyncHandler(async (req, res) => {
  const input = updateSettingsSchema.parse(req.body);
  const settings = await settingsService.update(input);
  res.json(settings);
});

export const updateModules: RequestHandler = asyncHandler(async (req, res) => {
  const input = updateModulesSchema.parse(req.body);
  const settings = await settingsService.updateModules(input);
  res.json(settings);
});
