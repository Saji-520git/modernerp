import type { RequestHandler } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import { HttpError } from '../../middleware/error-handler.js';
import { deliveryService } from './delivery.service.js';
import {
  createDeliverySchema,
  updateDeliverySchema,
  deliveryStatusSchema,
} from './delivery.schema.js';

function toDate(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return new Date(v);
}

export const getDeliveries: RequestHandler = asyncHandler(async (req, res) => {
  const { status, customerId, driverName, search, from, to } = req.query;
  const data = await deliveryService.getAllDeliveries({
    status: typeof status === 'string' && status ? status : undefined,
    customerId: typeof customerId === 'string' && customerId ? customerId : undefined,
    driverName: typeof driverName === 'string' && driverName ? driverName : undefined,
    search: typeof search === 'string' && search ? search : undefined,
    from: typeof from === 'string' && from ? new Date(from) : undefined,
    to: typeof to === 'string' && to ? new Date(to) : undefined,
  });
  res.json({ success: true, data, message: 'ok' });
});

export const getDeliveryStats: RequestHandler = asyncHandler(async (_req, res) => {
  const data = await deliveryService.getDeliveryStats();
  res.json({ success: true, data, message: 'ok' });
});

export const getPendingDeliveries: RequestHandler = asyncHandler(async (_req, res) => {
  const data = await deliveryService.getPendingDeliveries();
  res.json({ success: true, data, message: 'ok' });
});

export const getDelivery: RequestHandler = asyncHandler(async (req, res) => {
  const data = await deliveryService.getDeliveryById(req.params.id);
  res.json({ success: true, data, message: 'ok' });
});

export const createDelivery: RequestHandler = asyncHandler(async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const input = createDeliverySchema.parse(req.body);
  const data = await deliveryService.createDelivery({
    saleId: input.saleId ?? null,
    quotationId: input.quotationId ?? null,
    customerId: input.customerId ?? null,
    scheduledAt: toDate(input.scheduledAt) ?? null,
    address: input.address,
    contactName: input.contactName ?? null,
    contactPhone: input.contactPhone ?? null,
    driverName: input.driverName ?? null,
    driverPhone: input.driverPhone ?? null,
    note: input.note ?? null,
    createdById: req.auth.userId,
  });
  res.status(201).json({ success: true, data, message: 'Delivery created' });
});

export const updateDelivery: RequestHandler = asyncHandler(async (req, res) => {
  const input = updateDeliverySchema.parse(req.body);
  const data = await deliveryService.updateDelivery(req.params.id, {
    scheduledAt: toDate(input.scheduledAt),
    address: input.address,
    contactName: input.contactName,
    contactPhone: input.contactPhone,
    driverName: input.driverName,
    driverPhone: input.driverPhone,
    note: input.note,
  });
  res.json({ success: true, data, message: 'Delivery updated' });
});

export const updateDeliveryStatus: RequestHandler = asyncHandler(async (req, res) => {
  const { status } = deliveryStatusSchema.parse(req.body);
  const data = await deliveryService.updateStatus(req.params.id, status);
  res.json({ success: true, data, message: 'Status updated' });
});
