import type { RequestHandler } from 'express';
import { inventoryService } from './inventory.service.js';
import { alertsService } from './alerts.service.js';
import { asyncHandler as h } from '../../middleware/async-handler.js';
import {
  stockListSchema,
  adjustmentSchema,
  transferSchema,
  writeOffSchema,
  movementsListSchema,
} from './inventory.schema.js';
import { HttpError } from '../../middleware/error-handler.js';

export const listStock: RequestHandler = async (req, res) => {
  const input = stockListSchema.parse(req.query);
  const result = await inventoryService.listStock(input);
  res.json(result);
};

export const getLowStock: RequestHandler = async (_req, res) => {
  const result = await inventoryService.getLowStock();
  res.json(result);
};

export const getWarehouses: RequestHandler = async (_req, res) => {
  const result = await inventoryService.getWarehouses();
  res.json(result);
};

export const createAdjustment: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const input = adjustmentSchema.parse(req.body);
  const result = await inventoryService.createAdjustment(input, req.auth.userId);
  res.status(201).json(result);
};

export const createTransfer: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const input = transferSchema.parse(req.body);
  const result = await inventoryService.createTransfer(input, req.auth.userId);
  res.status(201).json(result);
};

export const listMovements: RequestHandler = async (req, res) => {
  const input = movementsListSchema.parse(req.query);
  const result = await inventoryService.listMovements(input);
  res.json(result);
};

export const getStockByUnits: RequestHandler = async (req, res) => {
  const result = await inventoryService.getStockByUnits(req.params.productId);
  res.json(result);
};

export const listExpiring: RequestHandler = async (_req, res) => {
  const result = await inventoryService.listExpiring();
  res.json(result);
};

export const getBatchDetail: RequestHandler = async (req, res) => {
  const { productId, warehouseId } = req.params;
  const result = await inventoryService.getBatchDetail(productId, warehouseId);
  res.json(result);
};

export const ensureStockRecords: RequestHandler = h(async (_req, res) => {
  const result = await inventoryService.ensureStockRecords();
  res.status(200).json(result);
});

export const cleanupPhantomStock: RequestHandler = h(async (_req, res) => {
  const result = await inventoryService.cleanupPhantomStock();
  res.status(200).json(result);
});

export const repairStockQty: RequestHandler = h(async (_req, res) => {
  const result = await inventoryService.repairStockQty();
  res.json(result);
});

export const writeOff: RequestHandler = h(async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const input = writeOffSchema.parse(req.body);
  const result = await inventoryService.writeOff(input, req.auth.userId);
  res.status(201).json(result);
});

// ─── Alerts ───────────────────────────────────────────────────────────────────

export const getAlerts: RequestHandler = h(async (req, res) => {
  const isReadParam = req.query.isRead as string | undefined;
  const filters = {
    type:      req.query.type      as string | undefined,
    severity:  req.query.severity  as string | undefined,
    isRead:    isReadParam === 'true' ? true : isReadParam === 'false' ? false : undefined,
    page:      Number(req.query.page)     || 1,
    pageSize:  Number(req.query.pageSize) || 50,
  };
  res.json(await alertsService.getAlerts(filters));
});

export const getAlertCount: RequestHandler = h(async (_req, res) => {
  res.json(await alertsService.getUnreadCount());
});

export const markAlertsRead: RequestHandler = h(async (req, res) => {
  const { ids } = req.body as { ids: string[] | 'all' };
  if (ids === 'all') await alertsService.markAllRead();
  else await alertsService.markRead(ids);
  res.json({ success: true });
});

export const dismissAlert: RequestHandler = h(async (req, res) => {
  await alertsService.dismiss(req.params.id);
  res.json({ success: true });
});

export const dismissAllAlerts: RequestHandler = h(async (req, res) => {
  await alertsService.dismissAll(req.query.type as string | undefined);
  res.json({ success: true });
});
