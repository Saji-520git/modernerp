import type { RequestHandler } from 'express';
import { HttpError } from '../../middleware/error-handler.js';
import { z } from 'zod';
import {
  createReceipt,
  listReceipts,
  getReceiptById,
} from './purchase-receipt.service.js';

const receiptLineSchema = z.object({
  purchaseLineId: z.string().min(1),
  qty:            z.number().positive(),
  unitCostCents:  z.number().int().nonnegative().optional(),
  sellingPriceCents: z.number().int().nonnegative().optional(),
  damagedQty:     z.number().nonnegative().optional(),
  damagedAccepted:       z.boolean().optional(),
  damagedUnitCostCents:  z.number().int().nonnegative().optional(),
  damagedSellingPriceCents: z.number().int().nonnegative().optional(),
  note:           z.string().max(300).optional(),
  batchNumber:    z.string().optional(),
  expiryDate:     z.string().optional(),
});

const createReceiptSchema = z.object({
  lines: z.array(receiptLineSchema).min(1),
  notes: z.string().optional(),
});

// POST /api/v1/purchases/:id/receipts
export const createReceiptHandler: RequestHandler = async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const { lines, notes } = createReceiptSchema.parse(req.body);
  const receipt = await createReceipt(req.params.id, lines, req.auth.userId, notes);
  res.status(201).json(receipt);
};

// GET /api/v1/purchases/:id/receipts
export const listReceiptsHandler: RequestHandler = async (req, res) => {
  const receipts = await listReceipts(req.params.id);
  res.json(receipts);
};

// GET /api/v1/purchases/receipts/:rid
export const getReceiptHandler: RequestHandler = async (req, res) => {
  const receipt = await getReceiptById(req.params.rid);
  res.json(receipt);
};
