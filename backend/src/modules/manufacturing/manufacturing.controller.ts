import type { RequestHandler } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import { HttpError } from '../../middleware/error-handler.js';
import { bomService } from './bom.service.js';
import { productionService } from './production.service.js';
import {
  createBOMSchema,
  updateBOMSchema,
  createProductionOrderSchema,
} from './manufacturing.schema.js';

// ─── BOM ──────────────────────────────────────────────────────────────────────

export const getBOMs: RequestHandler = asyncHandler(async (_req, res) => {
  const data = await bomService.getAllBOMs();
  res.json({ success: true, data, message: 'ok' });
});

export const getBOM: RequestHandler = asyncHandler(async (req, res) => {
  const data = await bomService.getBOMById(req.params.id);
  res.json({ success: true, data, message: 'ok' });
});

export const getBOMByProduct: RequestHandler = asyncHandler(async (req, res) => {
  const data = await bomService.getBOMByProductId(req.params.productId);
  res.json({ success: true, data, message: 'ok' });
});

export const createBOM: RequestHandler = asyncHandler(async (req, res) => {
  const input = createBOMSchema.parse(req.body);
  const data = await bomService.createBOM({
    productId: input.productId,
    name: input.name,
    yieldQty: input.yieldQty,
    notes: input.notes ?? null,
    lines: input.lines.map((l) => ({ materialId: l.materialId, qty: l.qty, notes: l.notes ?? null })),
  });
  res.status(201).json({ success: true, data, message: 'BOM created' });
});

export const updateBOM: RequestHandler = asyncHandler(async (req, res) => {
  const input = updateBOMSchema.parse(req.body);
  const data = await bomService.updateBOM(req.params.id, {
    name: input.name,
    yieldQty: input.yieldQty,
    notes: input.notes,
    isActive: input.isActive,
    lines: input.lines?.map((l) => ({ materialId: l.materialId, qty: l.qty, notes: l.notes ?? null })),
  });
  res.json({ success: true, data, message: 'BOM updated' });
});

export const deleteBOM: RequestHandler = asyncHandler(async (req, res) => {
  const data = await bomService.deleteBOM(req.params.id);
  res.json({ success: true, data, message: 'BOM deleted' });
});

// ─── Production orders ──────────────────────────────────────────────────────────

export const getOrders: RequestHandler = asyncHandler(async (req, res) => {
  const { status, productId, warehouseId, search, from, to } = req.query;
  const data = await productionService.getAllOrders({
    status: typeof status === 'string' && status ? status : undefined,
    productId: typeof productId === 'string' && productId ? productId : undefined,
    warehouseId: typeof warehouseId === 'string' && warehouseId ? warehouseId : undefined,
    search: typeof search === 'string' && search ? search : undefined,
    from: typeof from === 'string' && from ? new Date(from) : undefined,
    to: typeof to === 'string' && to ? new Date(to) : undefined,
  });
  res.json({ success: true, data, message: 'ok' });
});

export const getProductionStats: RequestHandler = asyncHandler(async (_req, res) => {
  const data = await productionService.getProductionStats();
  res.json({ success: true, data, message: 'ok' });
});

export const getOrder: RequestHandler = asyncHandler(async (req, res) => {
  const data = await productionService.getOrderById(req.params.id);
  res.json({ success: true, data, message: 'ok' });
});

export const createOrder: RequestHandler = asyncHandler(async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const input = createProductionOrderSchema.parse(req.body);
  const data = await productionService.createOrder({
    productId: input.productId,
    warehouseId: input.warehouseId,
    quantity: input.quantity,
    notes: input.notes ?? null,
    createdById: req.auth.userId,
  });
  res.status(201).json({ success: true, data, message: 'Production order created' });
});

export const startOrder: RequestHandler = asyncHandler(async (req, res) => {
  const data = await productionService.startOrder(req.params.id);
  res.json({ success: true, data, message: 'Production order started' });
});

export const completeOrder: RequestHandler = asyncHandler(async (req, res) => {
  const data = await productionService.completeOrder(req.params.id);
  res.json({ success: true, data, message: 'Production order completed' });
});

export const cancelOrder: RequestHandler = asyncHandler(async (req, res) => {
  const data = await productionService.cancelOrder(req.params.id);
  res.json({ success: true, data, message: 'Production order cancelled' });
});
