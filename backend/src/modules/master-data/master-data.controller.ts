import type { RequestHandler } from 'express';
import { z } from 'zod';
import { categoriesService, brandsService, unitsService } from './master-data.service.js';

const nameSchema = z.object({ name: z.string().min(1).max(100) });
const unitSchema = z.object({
  name:         z.string().min(1).max(100),
  shortCode:    z.string().min(1).max(10),
  allowDecimal: z.boolean().default(false),
});

// ─── Categories ───────────────────────────────────────────────────────────────

export const listCategories:   RequestHandler = async (_req, res) => res.json(await categoriesService.list());
export const createCategory:   RequestHandler = async (req, res) => { const { name } = nameSchema.parse(req.body); res.status(201).json(await categoriesService.create(name)); };
export const updateCategory:   RequestHandler = async (req, res) => { const { name } = nameSchema.parse(req.body); res.json(await categoriesService.update(req.params.id, name)); };
export const deleteCategory:   RequestHandler = async (req, res) => { await categoriesService.delete(req.params.id); res.json({ success: true }); };

// ─── Brands ───────────────────────────────────────────────────────────────────

export const listBrands:   RequestHandler = async (_req, res) => res.json(await brandsService.list());
export const createBrand:  RequestHandler = async (req, res) => { const { name } = nameSchema.parse(req.body); res.status(201).json(await brandsService.create(name)); };
export const updateBrand:  RequestHandler = async (req, res) => { const { name } = nameSchema.parse(req.body); res.json(await brandsService.update(req.params.id, name)); };
export const deleteBrand:  RequestHandler = async (req, res) => { await brandsService.delete(req.params.id); res.json({ success: true }); };

// ─── Units ────────────────────────────────────────────────────────────────────

export const listUnits:    RequestHandler = async (_req, res) => res.json(await unitsService.list());
export const createUnit:   RequestHandler = async (req, res) => { const d = unitSchema.parse(req.body); res.status(201).json(await unitsService.create(d.name, d.shortCode, d.allowDecimal)); };
export const updateUnit:   RequestHandler = async (req, res) => { const d = unitSchema.parse(req.body); res.json(await unitsService.update(req.params.id, d.name, d.shortCode, d.allowDecimal)); };
export const deleteUnit:   RequestHandler = async (req, res) => { await unitsService.delete(req.params.id); res.json({ success: true }); };
