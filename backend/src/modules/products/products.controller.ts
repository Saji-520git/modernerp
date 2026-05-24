import type { RequestHandler } from 'express';
import {
  listProductsSchema,
  createProductSchema,
  updateProductSchema,
} from './products.schema.js';
import { productsService } from './products.service.js';
import { productConversionsService, conversionLineSchema } from './product-conversions.service.js';
import { z } from 'zod';

export const list: RequestHandler = async (req, res) => {
  const input = listProductsSchema.parse(req.query);
  res.json(await productsService.list(input));
};

export const getByBarcode: RequestHandler = async (req, res) => {
  const product = await productsService.getByBarcode(req.params.barcode);
  res.json({ product });
};

export const getById: RequestHandler = async (req, res) => {
  res.json(await productsService.getById(req.params.id));
};

export const create: RequestHandler = async (req, res) => {
  const input = createProductSchema.parse(req.body);
  res.status(201).json(await productsService.create(input));
};

export const update: RequestHandler = async (req, res) => {
  const input = updateProductSchema.parse(req.body);
  res.json(await productsService.update(req.params.id, input));
};

export const toggleActive: RequestHandler = async (req, res) => {
  res.json(await productsService.toggleActive(req.params.id));
};

export const meta: RequestHandler = async (_req, res) => {
  res.json(await productsService.meta());
};

export const cleanupSeedData: RequestHandler = async (_req, res) => {
  res.json(await productsService.cleanupSeedData());
};

export const cleanupBarcodes: RequestHandler = async (_req, res) => {
  res.json(await productsService.cleanupScientificBarcodes());
};

export const getConversions: RequestHandler = async (req, res) => {
  res.json(await productConversionsService.getConversions(req.params.id));
};

export const setConversions: RequestHandler = async (req, res) => {
  const conversions = z.array(conversionLineSchema).parse(req.body);
  res.json(await productConversionsService.setConversions(req.params.id, conversions));
};
