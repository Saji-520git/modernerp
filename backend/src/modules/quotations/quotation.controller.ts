import type { RequestHandler } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import { HttpError } from '../../middleware/error-handler.js';
import { quotationService } from './quotation.service.js';
import { whatsappService } from '../whatsapp/whatsapp.service.js';
import {
  createQuotationSchema,
  updateQuotationSchema,
  quotationStatusSchema,
} from './quotation.schema.js';

function toDate(v: string | null | undefined): Date | null | undefined {
  if (v === undefined) return undefined;
  if (v === null) return null;
  return new Date(v);
}

export const getQuotations: RequestHandler = asyncHandler(async (req, res) => {
  const { customerId, status, search, from, to } = req.query;
  const data = await quotationService.getAllQuotations({
    customerId: typeof customerId === 'string' && customerId ? customerId : undefined,
    status: typeof status === 'string' && status ? status : undefined,
    search: typeof search === 'string' && search ? search : undefined,
    from: typeof from === 'string' && from ? new Date(from) : undefined,
    to: typeof to === 'string' && to ? new Date(to) : undefined,
  });
  res.json({ success: true, data, message: 'ok' });
});

export const getQuotationStats: RequestHandler = asyncHandler(async (_req, res) => {
  const data = await quotationService.getQuotationStats();
  res.json({ success: true, data, message: 'ok' });
});

export const getQuotation: RequestHandler = asyncHandler(async (req, res) => {
  const data = await quotationService.getQuotationById(req.params.id);
  res.json({ success: true, data, message: 'ok' });
});

export const createQuotation: RequestHandler = asyncHandler(async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const input = createQuotationSchema.parse(req.body);
  const data = await quotationService.createQuotation({
    customerId: input.customerId ?? null,
    title: input.title ?? null,
    validUntil: toDate(input.validUntil) ?? null,
    note: input.note ?? null,
    termsConditions: input.termsConditions ?? null,
    lines: input.lines,
    createdById: req.auth.userId,
  });
  res.status(201).json({ success: true, data, message: 'Quotation created' });
});

export const updateQuotation: RequestHandler = asyncHandler(async (req, res) => {
  const input = updateQuotationSchema.parse(req.body);
  const data = await quotationService.updateQuotation(req.params.id, {
    title: input.title ?? null,
    validUntil: toDate(input.validUntil) ?? null,
    note: input.note ?? null,
    termsConditions: input.termsConditions ?? null,
    lines: input.lines,
  });
  res.json({ success: true, data, message: 'Quotation updated' });
});

export const deleteQuotation: RequestHandler = asyncHandler(async (req, res) => {
  const data = await quotationService.deleteQuotation(req.params.id);
  res.json({ success: true, data, message: 'Quotation deleted' });
});

export const updateQuotationStatus: RequestHandler = asyncHandler(async (req, res) => {
  const { status } = quotationStatusSchema.parse(req.body);
  const data = await quotationService.updateStatus(req.params.id, status);
  res.json({ success: true, data, message: 'Status updated' });
});

export const convertQuotation: RequestHandler = asyncHandler(async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const data = await quotationService.convertToSale(req.params.id, req.auth.userId);
  res.status(201).json({ success: true, data, message: 'Quotation converted to sale' });
});

export const duplicateQuotation: RequestHandler = asyncHandler(async (req, res) => {
  if (!req.auth) throw new HttpError(401, 'Not authenticated');
  const data = await quotationService.duplicateQuotation(req.params.id, req.auth.userId);
  res.status(201).json({ success: true, data, message: 'Quotation duplicated' });
});

export const sendQuotationWhatsApp: RequestHandler = asyncHandler(async (req, res) => {
  const config = await whatsappService.getConfig();
  if (!config.isEnabled) {
    throw new HttpError(400, 'WhatsApp is not enabled. Enable it in WhatsApp settings first.');
  }
  const data = await whatsappService.sendQuoteViaWhatsApp(req.params.id);
  res.json({ success: true, data, message: 'Quote sent via WhatsApp' });
});
