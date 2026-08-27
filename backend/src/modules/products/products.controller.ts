import type { RequestHandler } from 'express';
import {
  listProductsSchema,
  createProductSchema,
  updateProductSchema,
} from './products.schema.js';
import { prisma } from '../../config/prisma.js';
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

export const remove: RequestHandler = async (req, res) => {
  await productsService.smartDelete(req.params.id);
  res.json({ success: true });
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

// Exported in the SAME column order the importer expects, so a file taken out
// of one installation can be read straight back into another — an export nobody
// can re-import is a dead end.
export const exportCsv: RequestHandler = async (_req, res) => {
  // Every product, active or not, with isActive as a column: a catalogue
  // export that quietly drops retired lines is not a catalogue.
  const rows = await prisma.product.findMany({
    orderBy: { sku: 'asc' },
    include: {
      category: { select: { name: true } },
      brand:    { select: { name: true } },
      unit:     { select: { shortCode: true } },
      stock:    { select: { qty: true } },
    },
  });

  // Quote every field and double any inner quote: product names carry commas
  // and the occasional inch mark, and one of those turns a row into two.
  const cell = (v: unknown) => {
    if (v === null || v === undefined) return '""';
    return `"${String(v).replace(/"/g, '""')}"`;
  };

  const header = [
    'sku', 'name', 'barcode', 'category', 'brand', 'unit',
    'costPrice', 'sellPrice', 'taxPercent', 'reorderLevel', 'openingStock', 'isActive',
  ];

  const lines = [
    header.join(','),
    ...rows.map((p) => [
      p.sku,
      p.name,
      p.barcode ?? '',
      p.category?.name ?? '',
      p.brand?.name ?? '',
      p.unit?.shortCode ?? '',
      (p.costCents / 100).toFixed(2),
      (p.priceCents / 100).toFixed(2),
      p.taxPercent,
      p.reorderLevel,
      p.stock.reduce((s, r) => s + Number(r.qty), 0),
      p.isActive ? 'yes' : 'no',
    ].map(cell).join(',')),
  ];

  const today = new Date().toISOString().slice(0, 10);
  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="products-${today}.csv"`);
  // BOM so Excel reads UTF-8 rather than mangling any non-ASCII product name.
  res.send('\uFEFF' + lines.join('\r\n'));
};

export const getConversions: RequestHandler = async (req, res) => {
  res.json(await productConversionsService.getConversions(req.params.id));
};

export const setConversions: RequestHandler = async (req, res) => {
  const conversions = z.array(conversionLineSchema).parse(req.body);
  res.json(await productConversionsService.setConversions(req.params.id, conversions));
};
