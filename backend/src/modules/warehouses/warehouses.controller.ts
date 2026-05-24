import type { RequestHandler } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import { warehousesService } from './warehouses.service.js';
import {
  CreateWarehouseSchema,
  UpdateWarehouseSchema,
  ListWarehousesSchema,
} from './warehouses.schema.js';

export const listWarehouses: RequestHandler = asyncHandler(async (req, res) => {
  const query = ListWarehousesSchema.parse(req.query);
  res.json(await warehousesService.list(query));
});

export const getWarehouse: RequestHandler = asyncHandler(async (req, res) => {
  res.json(await warehousesService.get(req.params.id));
});

export const createWarehouse: RequestHandler = asyncHandler(async (req, res) => {
  const input = CreateWarehouseSchema.parse(req.body);
  res.status(201).json(await warehousesService.create(input));
});

export const updateWarehouse: RequestHandler = asyncHandler(async (req, res) => {
  const input = UpdateWarehouseSchema.parse(req.body);
  res.json(await warehousesService.update(req.params.id, input));
});

export const toggleWarehouse: RequestHandler = asyncHandler(async (req, res) => {
  res.json(await warehousesService.toggleActive(req.params.id));
});

export const setDefaultWarehouse: RequestHandler = asyncHandler(async (req, res) => {
  res.json(await warehousesService.setDefault(req.params.id));
});

export const getWarehouseStats: RequestHandler = asyncHandler(async (req, res) => {
  res.json(await warehousesService.getStats(req.params.id));
});
