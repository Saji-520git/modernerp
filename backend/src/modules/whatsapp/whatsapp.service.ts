import type { WhatsAppConfig, WhatsAppTemplate, WhatsAppLog, Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';
import { settingsService } from '../settings/settings.service.js';
import {
  formatPhone,
  buildSaleReceipt,
  buildSinhalaReceipt,
  buildPaymentReminder,
  buildDailySummary,
  buildLowStockAlert,
  buildOffer,
  buildQuoteSummary,
} from './message.composer.js';

const CONFIG_ID = 'singleton';

// ─── Helpers ──────────────────────────────────────────────────────────────────

const money = (cents: number): string => (cents / 100).toFixed(2);

const fmtDate = (d: Date): string =>
  d.toLocaleDateString('en-GB', { day: '2-digit', month: '2-digit', year: 'numeric' });

/** A messaging outcome — either a wa.me link (WEB) or an API send result. */
export type SendOutcome =
  | { mode: 'WEB'; to: string; message: string; waLink: string }
  | { mode: 'API'; to: string; message: string; success: boolean; messageId?: string; error?: string };

interface ApiSendResult {
  success: boolean;
  messageId?: string;
  error?: string;
}

// ─── Default templates (seeded on install) ────────────────────────────────────

const DEFAULT_TEMPLATES: Array<Pick<WhatsAppTemplate, 'name' | 'type' | 'language' | 'subject' | 'bodyEn' | 'bodySi' | 'isEditable'>> = [
  {
    name: 'Sale Receipt', type: 'RECEIPT', language: 'en', subject: null, isEditable: true,
    bodyEn: 'Receipt for {{invoiceNo}} — total Rs.{{total}}. Thank you for your purchase!',
    bodySi: '{{invoiceNo}} සඳහා රිසිට්පත — මුළු එකතුව Rs.{{total}}. ස්තූතියි!',
  },
  {
    name: 'Payment Reminder', type: 'PAYMENT_REMINDER', language: 'en', subject: null, isEditable: true,
    bodyEn: 'Dear {{customerName}}, a friendly reminder: invoice {{invoiceNo}} of Rs.{{amount}} is due. Please arrange payment.',
    bodySi: 'ආදරණීය {{customerName}}, මතක් කිරීමක්: ඉන්වොයිස් {{invoiceNo}} සඳහා Rs.{{amount}} ගෙවිය යුතුය.',
  },
  {
    name: 'Daily Summary', type: 'DAILY_SUMMARY', language: 'en', subject: null, isEditable: true,
    bodyEn: 'Daily report {{date}}: Sales Rs.{{totalSales}}, {{orderCount}} orders.',
    bodySi: null,
  },
  {
    name: 'Low Stock Alert', type: 'LOW_STOCK', language: 'en', subject: null, isEditable: true,
    bodyEn: 'Low stock alert: some products need restocking. Please arrange purchase orders.',
    bodySi: null,
  },
  {
    name: 'Special Offer', type: 'OFFER', language: 'en', subject: null, isEditable: true,
    bodyEn: 'Dear {{customerName}}, special offer: {{offerText}}. Visit us today!',
    bodySi: 'ආදරණීය {{customerName}}, විශේෂ දීමනාව: {{offerText}}.',
  },
  {
    name: 'Custom Message', type: 'CUSTOM', language: 'en', subject: null, isEditable: true,
    bodyEn: '{{message}}',
    bodySi: null,
  },
];

export const whatsappService = {

  // ── Config ──────────────────────────────────────────────────────────────────

  /** Returns the singleton config, creating a disabled WEB-mode default if absent. */
  getConfig: async (): Promise<WhatsAppConfig> => {
    try {
      return await prisma.whatsAppConfig.upsert({
        where:  { id: CONFIG_ID },
        update: {},
        create: { id: CONFIG_ID },
      });
    } catch (err) {
      logger.error(err, 'whatsappService.getConfig failed');
      throw err;
    }
  },

  /** Upserts the singleton config. Never logs secret values. */
  updateConfig: async (data: Partial<Omit<WhatsAppConfig, 'id' | 'createdAt' | 'updatedAt'>>): Promise<WhatsAppConfig> => {
    try {
      const result = await prisma.whatsAppConfig.upsert({
        where:  { id: CONFIG_ID },
        update: data,
        create: { id: CONFIG_ID, ...data },
      });
      // Log only non-sensitive field names — never the values of keys/tokens.
      logger.info({ fields: Object.keys(data) }, 'WhatsApp config updated');
      return result;
    } catch (err) {
      logger.error(err, 'whatsappService.updateConfig failed');
      throw err;
    }
  },

  // ── Templates ─────────────────────────────────────────────────────────────────

  getAllTemplates: async (): Promise<WhatsAppTemplate[]> => {
    try {
      return await prisma.whatsAppTemplate.findMany({ orderBy: { type: 'asc' } });
    } catch (err) {
      logger.error(err, 'whatsappService.getAllTemplates failed');
      throw err;
    }
  },

  getTemplate: async (name: string): Promise<WhatsAppTemplate | null> => {
    try {
      return await prisma.whatsAppTemplate.findUnique({ where: { name } });
    } catch (err) {
      logger.error(err, 'whatsappService.getTemplate failed');
      throw err;
    }
  },

  /** Creates any missing default templates. Safe to run repeatedly (idempotent). */
  seedDefaultTemplates: async (): Promise<number> => {
    try {
      let created = 0;
      for (const t of DEFAULT_TEMPLATES) {
        const existing = await prisma.whatsAppTemplate.findUnique({ where: { name: t.name } });
        if (!existing) {
          await prisma.whatsAppTemplate.create({ data: t });
          created += 1;
        }
      }
      if (created > 0) logger.info({ created }, 'WhatsApp default templates seeded');
      return created;
    } catch (err) {
      logger.error(err, 'whatsappService.seedDefaultTemplates failed');
      throw err;
    }
  },

  updateTemplate: async (
    id: string,
    data: { bodyEn?: string; bodySi?: string | null; subject?: string | null; isActive?: boolean },
  ): Promise<WhatsAppTemplate> => {
    try {
      const tpl = await prisma.whatsAppTemplate.findUnique({ where: { id } });
      if (!tpl) throw new HttpError(404, 'Template not found');
      if (!tpl.isEditable) throw new HttpError(400, 'This template is not editable');
      return await prisma.whatsAppTemplate.update({ where: { id }, data });
    } catch (err) {
      logger.error(err, 'whatsappService.updateTemplate failed');
      throw err;
    }
  },

  // ── Sending ───────────────────────────────────────────────────────────────────

  /** Builds a click-to-chat wa.me link with the message URL-encoded. */
  buildWaLink: (phone: string, message: string): string => {
    const intl = formatPhone(phone).replace(/^\+/, ''); // wa.me wants no leading +
    return `https://wa.me/${intl}?text=${encodeURIComponent(message)}`;
  },

  /**
   * Sends a message through the configured Business API provider (Meta / Twilio)
   * using the runtime's native fetch. Always records a WhatsAppLog row.
   * Never logs API keys or tokens.
   */
  sendViaAPI: async (
    to: string,
    message: string,
    customerId?: string | null,
    templateId?: string | null,
  ): Promise<ApiSendResult> => {
    const config = await whatsappService.getConfig();
    const intl = formatPhone(to).replace(/^\+/, '');
    let result: ApiSendResult = { success: false, error: 'No provider configured' };

    try {
      if (config.provider === 'TWILIO') {
        if (!config.twilioSid || !config.twilioToken || !config.twilioFrom) {
          result = { success: false, error: 'Twilio credentials incomplete' };
        } else {
          const auth = Buffer.from(`${config.twilioSid}:${config.twilioToken}`).toString('base64');
          const body = new URLSearchParams({
            From: `whatsapp:${formatPhone(config.twilioFrom)}`,
            To:   `whatsapp:+${intl}`,
            Body: message,
          });
          const res = await fetch(
            `https://api.twilio.com/2010-04-01/Accounts/${config.twilioSid}/Messages.json`,
            { method: 'POST', headers: { Authorization: `Basic ${auth}`, 'Content-Type': 'application/x-www-form-urlencoded' }, body },
          );
          const json = (await res.json()) as { sid?: string; message?: string };
          result = res.ok
            ? { success: true, messageId: json.sid }
            : { success: false, error: json.message ?? `Twilio error ${res.status}` };
        }
      } else if (config.provider === 'META') {
        if (!config.phoneNumberId || !config.apiKey) {
          result = { success: false, error: 'Meta credentials incomplete' };
        } else {
          const res = await fetch(
            `https://graph.facebook.com/v18.0/${config.phoneNumberId}/messages`,
            {
              method: 'POST',
              headers: { Authorization: `Bearer ${config.apiKey}`, 'Content-Type': 'application/json' },
              body: JSON.stringify({ messaging_product: 'whatsapp', to: intl, type: 'text', text: { body: message } }),
            },
          );
          const json = (await res.json()) as { messages?: { id: string }[]; error?: { message: string } };
          result = res.ok
            ? { success: true, messageId: json.messages?.[0]?.id }
            : { success: false, error: json.error?.message ?? `Meta error ${res.status}` };
        }
      }
    } catch (err) {
      logger.error({ provider: config.provider }, 'whatsappService.sendViaAPI request failed');
      result = { success: false, error: err instanceof Error ? err.message : 'Network error' };
    }

    await whatsappService.logMessage({
      to: formatPhone(to),
      customerId: customerId ?? null,
      templateId: templateId ?? null,
      message,
      mode: 'API',
      provider: config.provider,
      status: result.success ? 'SENT' : 'FAILED',
      error: result.error ?? null,
      sentAt: result.success ? new Date() : null,
    });

    return result;
  },

  /**
   * Routes a message according to the active mode.
   *  - WEB → returns a wa.me link (logged as PENDING) for the client to open.
   *  - API → sends immediately via the provider and returns the result.
   */
  dispatch: async (
    to: string,
    message: string,
    customerId?: string | null,
    templateId?: string | null,
  ): Promise<SendOutcome> => {
    const config = await whatsappService.getConfig();
    if (config.mode === 'API') {
      const r = await whatsappService.sendViaAPI(to, message, customerId, templateId);
      return { mode: 'API', to: formatPhone(to), message, success: r.success, messageId: r.messageId, error: r.error };
    }
    const waLink = whatsappService.buildWaLink(to, message);
    await whatsappService.logMessage({
      to: formatPhone(to),
      customerId: customerId ?? null,
      templateId: templateId ?? null,
      message,
      mode: 'WEB',
      status: 'PENDING',
    });
    return { mode: 'WEB', to: formatPhone(to), message, waLink };
  },

  // ── High-level use cases ────────────────────────────────────────────────────

  /** Builds and dispatches a receipt for a single sale. language: 'en' | 'si'. */
  sendReceipt: async (saleId: string, language: 'en' | 'si' = 'en'): Promise<SendOutcome> => {
    const sale = await prisma.sale.findFirst({
      where: { id: saleId, deletedAt: null },
      include: { customer: true, lines: { include: { product: true } } },
    });
    if (!sale) throw new HttpError(404, 'Sale not found');
    if (!sale.customer?.phone) throw new HttpError(400, 'Customer has no phone number');

    const settings = await settingsService.get();
    const data = {
      invoiceNo: sale.number,
      customerName: sale.customer.name,
      date: fmtDate(sale.date),
      items: sale.lines.map((l) => ({
        name: l.product.receiptName ?? l.product.name,
        qty: l.qty.toString(),
        amount: money(l.lineTotalCents),
      })),
      subtotal: money(sale.subtotalCents),
      discount: sale.discountCents > 0 ? money(sale.discountCents) : undefined,
      total: money(sale.totalCents),
      paymentMethod: sale.paymentMethod,
      businessName: settings.businessName,
      phone: settings.businessPhone ?? undefined,
    };
    const message = language === 'si' ? buildSinhalaReceipt(data) : buildSaleReceipt(data);
    const tpl = await whatsappService.getTemplate('Sale Receipt');
    return whatsappService.dispatch(sale.customer.phone, message, sale.customerId, tpl?.id ?? null);
  },

  /** Builds and dispatches a quotation summary to its customer. */
  sendQuoteViaWhatsApp: async (quotationId: string): Promise<SendOutcome> => {
    const quote = await prisma.quotation.findFirst({
      where: { id: quotationId, deletedAt: null },
      include: {
        customer: { select: { id: true, name: true, phone: true } },
        lines: { orderBy: { sortOrder: 'asc' } },
      },
    });
    if (!quote) throw new HttpError(404, 'Quotation not found');
    if (!quote.customer?.phone) throw new HttpError(400, 'Customer has no phone number');

    const settings = await settingsService.get();
    const message = buildQuoteSummary({
      quoteNo: quote.number,
      customerName: quote.customer.name,
      title: quote.title ?? undefined,
      items: quote.lines.map((l) => ({
        name: l.description,
        qty: l.qty.toString(),
        amount: money(l.totalCents),
      })),
      total: money(quote.totalCents),
      validUntil: quote.validUntil ? fmtDate(quote.validUntil) : undefined,
      businessName: settings.businessName,
    });
    const tpl = await whatsappService.getTemplate('Quote Summary');
    return whatsappService.dispatch(quote.customer.phone, message, quote.customerId, tpl?.id ?? null);
  },

  /** Loads a customer's outstanding sales and dispatches a payment reminder. */
  sendPaymentReminder: async (customerId: string): Promise<SendOutcome> => {
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new HttpError(404, 'Customer not found');
    if (!customer.phone) throw new HttpError(400, 'Customer has no phone number');

    const outstanding = await prisma.sale.findMany({
      where: { customerId, deletedAt: null, paymentStatus: { in: ['UNPAID', 'PARTIAL'] } },
      orderBy: { date: 'desc' },
    });
    if (outstanding.length === 0) throw new HttpError(400, 'Customer has no outstanding balance');

    const totalDue = outstanding.reduce((s, sale) => s + (sale.totalCents - sale.paidCents), 0);
    const latest = outstanding[0];
    const settings = await settingsService.get();

    const message = buildPaymentReminder({
      customerName: customer.name,
      invoiceNo: outstanding.length > 1 ? `${latest.number} (+${outstanding.length - 1} more)` : latest.number,
      amount: money(totalDue),
      dueDate: customer.creditSettleDays
        ? fmtDate(new Date(latest.date.getTime() + customer.creditSettleDays * 86_400_000))
        : undefined,
      businessName: settings.businessName,
      businessPhone: settings.businessPhone ?? undefined,
    });
    const tpl = await whatsappService.getTemplate('Payment Reminder');
    return whatsappService.dispatch(customer.phone, message, customerId, tpl?.id ?? null);
  },

  /** Computes the day's stats and dispatches a summary to the owner. */
  sendDailySummary: async (date?: Date): Promise<SendOutcome> => {
    const config = await whatsappService.getConfig();
    if (!config.ownerPhone) throw new HttpError(400, 'Owner phone not configured');

    const day = date ?? new Date();
    const start = new Date(day); start.setHours(0, 0, 0, 0);
    const end = new Date(start); end.setDate(end.getDate() + 1);
    const within = { gte: start, lt: end };

    const sales = await prisma.sale.findMany({
      where: { date: within, deletedAt: null, status: 'CONFIRMED' },
      select: { totalCents: true, paidCents: true, paymentMethod: true },
    });
    const totalSales = sales.reduce((s, x) => s + x.totalCents, 0);
    const cashCollected = sales.filter((s) => s.paymentMethod === 'CASH').reduce((s, x) => s + x.paidCents, 0);
    const creditGiven = sales.reduce((s, x) => s + Math.max(0, x.totalCents - x.paidCents), 0);

    const topLine = await prisma.saleLine.groupBy({
      by: ['productId'],
      where: { sale: { date: within, deletedAt: null, status: 'CONFIRMED' } },
      _sum: { qty: true },
      orderBy: { _sum: { qty: 'desc' } },
      take: 1,
    });
    let topProduct: string | undefined;
    if (topLine[0]) {
      const p = await prisma.product.findUnique({ where: { id: topLine[0].productId }, select: { name: true } });
      topProduct = p?.name;
    }

    const newCustomers = await prisma.customer.count({ where: { createdAt: within } });
    const settings = await settingsService.get();

    const message = buildDailySummary({
      date: fmtDate(start),
      totalSales: money(totalSales),
      orderCount: sales.length,
      cashCollected: money(cashCollected),
      creditGiven: money(creditGiven),
      topProduct,
      newCustomers,
      businessName: settings.businessName,
    });
    const tpl = await whatsappService.getTemplate('Daily Summary');
    return whatsappService.dispatch(config.ownerPhone, message, null, tpl?.id ?? null);
  },

  /** Detects low-stock products and dispatches an alert to the owner. */
  sendLowStockAlert: async (): Promise<SendOutcome> => {
    const config = await whatsappService.getConfig();
    if (!config.ownerPhone) throw new HttpError(400, 'Owner phone not configured');

    const products = await prisma.product.findMany({
      where: { isActive: true, reorderLevel: { gt: 0 } },
      select: { name: true, reorderLevel: true, stock: { select: { qty: true } } },
    });
    const low = products
      .map((p) => ({ name: p.name, current: p.stock.reduce((s, st) => s + Number(st.qty), 0), reorder: p.reorderLevel }))
      .filter((p) => p.current <= p.reorder);
    if (low.length === 0) throw new HttpError(400, 'No products are low on stock');

    const settings = await settingsService.get();
    const message = buildLowStockAlert({
      products: low.map((p) => ({ name: p.name, current: String(p.current), reorder: String(p.reorder) })),
      businessName: settings.businessName,
    });
    const tpl = await whatsappService.getTemplate('Low Stock Alert');
    return whatsappService.dispatch(config.ownerPhone, message, null, tpl?.id ?? null);
  },

  /** Dispatches an offer to many customers. Returns one outcome per recipient. */
  sendOffer: async (
    customerIds: string[],
    offerText: string,
    validUntil?: string,
  ): Promise<{ outcomes: SendOutcome[]; skipped: string[] }> => {
    const settings = await settingsService.get();
    const tpl = await whatsappService.getTemplate('Special Offer');
    const customers = await prisma.customer.findMany({ where: { id: { in: customerIds } } });

    const outcomes: SendOutcome[] = [];
    const skipped: string[] = [];
    for (const c of customers) {
      if (!c.phone) { skipped.push(c.id); continue; }
      const message = buildOffer({ customerName: c.name, offerText, validUntil, businessName: settings.businessName });
      outcomes.push(await whatsappService.dispatch(c.phone, message, c.id, tpl?.id ?? null));
    }
    return { outcomes, skipped };
  },

  /** Sends a free-form message to a single recipient (used by broadcast/custom). */
  sendCustom: async (to: string, message: string, customerId?: string | null): Promise<SendOutcome> => {
    const tpl = await whatsappService.getTemplate('Custom Message');
    return whatsappService.dispatch(to, message, customerId ?? null, tpl?.id ?? null);
  },

  // ── Logging ───────────────────────────────────────────────────────────────────

  logMessage: async (data: {
    to: string;
    customerId?: string | null;
    templateId?: string | null;
    message: string;
    mode: string;
    status?: string;
    provider?: string | null;
    error?: string | null;
    sentAt?: Date | null;
  }): Promise<WhatsAppLog> => {
    try {
      return await prisma.whatsAppLog.create({
        data: {
          to: data.to,
          customerId: data.customerId ?? null,
          templateId: data.templateId ?? null,
          message: data.message,
          mode: data.mode,
          status: data.status ?? 'PENDING',
          provider: data.provider ?? null,
          error: data.error ?? null,
          sentAt: data.sentAt ?? null,
        },
      });
    } catch (err) {
      logger.error(err, 'whatsappService.logMessage failed');
      throw err;
    }
  },

  getLog: async (filters?: { customerId?: string; status?: string; limit?: number }): Promise<WhatsAppLog[]> => {
    try {
      const where: Prisma.WhatsAppLogWhereInput = {};
      if (filters?.customerId) where.customerId = filters.customerId;
      if (filters?.status) where.status = filters.status;
      return await prisma.whatsAppLog.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        take: Math.min(filters?.limit ?? 20, 200),
      });
    } catch (err) {
      logger.error(err, 'whatsappService.getLog failed');
      throw err;
    }
  },
};
