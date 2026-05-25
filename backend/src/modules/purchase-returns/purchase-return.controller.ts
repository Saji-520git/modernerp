import type { RequestHandler } from 'express';
import { purchaseReturnService } from './purchase-return.service.js';
import { HttpError } from '../../middleware/error-handler.js';

// ─── GET / (list all, optional ?purchaseId=) ─────────────────────────────────

export const listReturns: RequestHandler = async (req, res) => {
  const purchaseId = req.query.purchaseId as string | undefined;
  const items = await purchaseReturnService.listReturns(purchaseId);
  res.json(items);
};

// ─── GET /:id ─────────────────────────────────────────────────────────────────

export const getReturn: RequestHandler = async (req, res) => {
  const ret = await purchaseReturnService.getReturn(req.params.id);
  res.json(ret);
};

// ─── GET /:id/debit-note ──────────────────────────────────────────────────────

export const getDebitNote: RequestHandler = async (req, res) => {
  const data = await purchaseReturnService.getDebitNoteData(req.params.id);
  res.json(data);
};

// ─── POST / ───────────────────────────────────────────────────────────────────

export const createReturn: RequestHandler = async (req, res) => {
  const { purchaseId, reason, lines } = req.body as {
    purchaseId: string;
    reason?:    string;
    lines:      Array<{ purchaseLineId: string; qty: number }>;
  };

  if (!purchaseId)            throw new HttpError(400, 'purchaseId is required');
  if (!lines || !lines.length) throw new HttpError(400, 'lines are required');

  const ret = await purchaseReturnService.createReturn({
    purchaseId,
    reason,
    lines,
    createdBy: req.auth!.userId,
  });

  res.status(201).json(ret);
};

// ─── PATCH /:id/confirm ───────────────────────────────────────────────────────

export const confirmReturn: RequestHandler = async (req, res) => {
  const ret = await purchaseReturnService.confirmReturn(req.params.id);
  res.json(ret);
};

// ─── PATCH /:id/cancel ────────────────────────────────────────────────────────

export const cancelReturn: RequestHandler = async (req, res) => {
  const ret = await purchaseReturnService.cancelReturn(req.params.id);
  res.json(ret);
};

// ─── DELETE /:id ──────────────────────────────────────────────────────────────

export const deleteReturn: RequestHandler = async (req, res) => {
  const ret = await purchaseReturnService.deleteReturn(req.params.id);
  res.json(ret);
};
