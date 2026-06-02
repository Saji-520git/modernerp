import type { RequestHandler } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import { configService } from './config.service.js';
import { updateModulesSchema, updateClientSchema, applyTemplateSchema } from './config.schema.js';

export const getModules: RequestHandler = asyncHandler(async (_req, res) => {
  const modules = await configService.getModules();
  res.json({ success: true, data: modules, message: 'ok' });
});

export const getClient: RequestHandler = asyncHandler(async (_req, res) => {
  const cfg = await configService.getConfig();
  res.json({
    success: true,
    data:    { clientName: cfg.clientName, businessType: cfg.businessType },
    message: 'ok',
  });
});

export const updateModules: RequestHandler = asyncHandler(async (req, res) => {
  const { modules } = updateModulesSchema.parse(req.body);
  const updated = await configService.updateModules(modules);
  res.json({ success: true, data: updated, message: 'Modules updated' });
});

export const updateClient: RequestHandler = asyncHandler(async (req, res) => {
  const input = updateClientSchema.parse(req.body);
  const cfg = await configService.updateClientInfo(input);
  res.json({
    success: true,
    data:    { clientName: cfg.clientName, businessType: cfg.businessType },
    message: 'Client updated',
  });
});

export const applyTemplate: RequestHandler = asyncHandler(async (req, res) => {
  const { template } = applyTemplateSchema.parse(req.body);
  const cfg = await configService.applyTemplate(template);
  res.json({
    success: true,
    data:    { businessType: cfg.businessType, modules: cfg.modules },
    message: 'Template applied',
  });
});
