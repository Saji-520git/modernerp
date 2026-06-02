import type { RequestHandler } from 'express';
import { asyncHandler } from '../../middleware/async-handler.js';
import { whatsappService } from './whatsapp.service.js';
import {
  updateConfigSchema,
  updateTemplateSchema,
  sendReceiptSchema,
  sendReminderSchema,
  sendDailySummarySchema,
  sendOfferSchema,
} from './whatsapp.schema.js';

// Secret fields are masked before a config row is returned to the client.
const SECRET_FIELDS = ['apiKey', 'apiSecret', 'twilioToken'] as const;

function maskConfig<T extends Record<string, unknown>>(config: T): T {
  const masked = { ...config } as Record<string, unknown>;
  for (const f of SECRET_FIELDS) {
    if (masked[f]) masked[f] = '••••••••'; // present-but-hidden marker
  }
  return masked as T;
}

// ─── Config ───────────────────────────────────────────────────────────────────

export const getConfig: RequestHandler = asyncHandler(async (_req, res) => {
  const data = await whatsappService.getConfig();
  res.json({ success: true, data: maskConfig(data), message: 'ok' });
});

export const updateConfig: RequestHandler = asyncHandler(async (req, res) => {
  const input = updateConfigSchema.parse(req.body);
  // Drop masked secret placeholders so we never overwrite a real key with dots.
  const clean = { ...input } as Record<string, unknown>;
  for (const f of SECRET_FIELDS) {
    if (clean[f] === '••••••••') delete clean[f];
  }
  const data = await whatsappService.updateConfig(clean);
  res.json({ success: true, data: maskConfig(data), message: 'WhatsApp config updated' });
});

export const testConnection: RequestHandler = asyncHandler(async (_req, res) => {
  const config = await whatsappService.getConfig();
  if (!config.ownerPhone) {
    res.status(400).json({ success: false, data: null, message: 'Owner phone not configured' });
    return;
  }
  const message = '✅ BROcode ERP — WhatsApp test message. Your connection works!';
  const outcome = await whatsappService.dispatch(config.ownerPhone, message, null, null);
  res.json({ success: true, data: outcome, message: 'Test dispatched' });
});

// ─── Templates ──────────────────────────────────────────────────────────────────

export const getTemplates: RequestHandler = asyncHandler(async (_req, res) => {
  const data = await whatsappService.getAllTemplates();
  res.json({ success: true, data, message: 'ok' });
});

export const updateTemplate: RequestHandler = asyncHandler(async (req, res) => {
  const input = updateTemplateSchema.parse(req.body);
  const data = await whatsappService.updateTemplate(req.params.id, input);
  res.json({ success: true, data, message: 'Template updated' });
});

export const seedTemplates: RequestHandler = asyncHandler(async (_req, res) => {
  const created = await whatsappService.seedDefaultTemplates();
  res.json({ success: true, data: { created }, message: 'Templates seeded' });
});

// ─── Messaging ──────────────────────────────────────────────────────────────────

export const sendReceipt: RequestHandler = asyncHandler(async (req, res) => {
  const { saleId, language } = sendReceiptSchema.parse(req.body);
  const data = await whatsappService.sendReceipt(saleId, language ?? 'en');
  res.json({ success: true, data, message: 'Receipt prepared' });
});

export const sendReminder: RequestHandler = asyncHandler(async (req, res) => {
  const { customerId } = sendReminderSchema.parse(req.body);
  const data = await whatsappService.sendPaymentReminder(customerId);
  res.json({ success: true, data, message: 'Reminder prepared' });
});

export const sendDailySummary: RequestHandler = asyncHandler(async (req, res) => {
  const { date } = sendDailySummarySchema.parse(req.body);
  const data = await whatsappService.sendDailySummary(date ? new Date(date) : undefined);
  res.json({ success: true, data, message: 'Daily summary prepared' });
});

export const sendLowStock: RequestHandler = asyncHandler(async (_req, res) => {
  const data = await whatsappService.sendLowStockAlert();
  res.json({ success: true, data, message: 'Low stock alert prepared' });
});

export const sendOffer: RequestHandler = asyncHandler(async (req, res) => {
  const { customerIds, offerText, validUntil } = sendOfferSchema.parse(req.body);
  const { outcomes, skipped } = await whatsappService.sendOffer(customerIds, offerText, validUntil);
  // WEB mode → links to open; API mode → sent/failed summary.
  const links = outcomes.filter((o) => o.mode === 'WEB').map((o) => (o as { waLink: string }).waLink);
  const sent = outcomes.filter((o) => o.mode === 'API' && (o as { success: boolean }).success).length;
  const failed = outcomes.filter((o) => o.mode === 'API' && !(o as { success: boolean }).success).length;
  res.json({
    success: true,
    data: { outcomes, links, sent, failed, skipped },
    message: 'Offer dispatched',
  });
});

// ─── Log ──────────────────────────────────────────────────────────────────────

export const getLog: RequestHandler = asyncHandler(async (req, res) => {
  const customerId = typeof req.query.customerId === 'string' ? req.query.customerId : undefined;
  const status = typeof req.query.status === 'string' ? req.query.status : undefined;
  const limit = typeof req.query.limit === 'string' ? parseInt(req.query.limit, 10) : undefined;
  const data = await whatsappService.getLog({ customerId, status, limit });
  res.json({ success: true, data, message: 'ok' });
});
