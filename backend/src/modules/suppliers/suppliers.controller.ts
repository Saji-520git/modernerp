import type { RequestHandler } from 'express';
import { suppliersService } from './suppliers.service.js';
import { supplierBodySchema, listSuppliersSchema } from './suppliers.schema.js';

export const list: RequestHandler = async (req, res) => {
  const input = listSuppliersSchema.parse(req.query);
  res.json(await suppliersService.list(input));
};

export const getOne: RequestHandler = async (req, res) => {
  res.json(await suppliersService.getOne(req.params.id));
};

export const create: RequestHandler = async (req, res) => {
  const input = supplierBodySchema.parse(req.body);
  res.status(201).json(await suppliersService.create(input));
};

export const update: RequestHandler = async (req, res) => {
  const input = supplierBodySchema.parse(req.body);
  res.json(await suppliersService.update(req.params.id, input));
};

export const toggleActive: RequestHandler = async (req, res) => {
  res.json(await suppliersService.toggleActive(req.params.id));
};

export const remove: RequestHandler = async (req, res) => {
  await suppliersService.smartDelete(req.params.id);
  res.json({ success: true });
};
