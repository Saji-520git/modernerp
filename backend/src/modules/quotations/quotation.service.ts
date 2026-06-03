import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface QuotationLineInput {
  productId?: string | null;
  description: string;
  qty: number;
  unitLabel: string;
  unitPriceCents: number;
  discountCents?: number;
  sortOrder?: number;
}

export interface CreateQuotationInput {
  customerId?: string | null;
  title?: string | null;
  validUntil?: Date | null;
  note?: string | null;
  termsConditions?: string | null;
  lines: QuotationLineInput[];
  createdById: string;
}

export interface UpdateQuotationInput {
  title?: string | null;
  validUntil?: Date | null;
  note?: string | null;
  termsConditions?: string | null;
  lines?: QuotationLineInput[];
}

export interface QuotationFilters {
  customerId?: string;
  status?: string;
  search?: string;
  from?: Date;
  to?: Date;
}

// ─── Helpers ────────────────────────────────────────────────────────────────

/** QUO-2026-0001 — sequential per year. Falls back to total count if parse fails. */
async function generateQuoteNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `QUO-${year}-`;
  const last = await prisma.quotation.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { createdAt: 'desc' },
    select: { number: true },
  });
  let next = 1;
  if (last) {
    const parsed = parseInt(last.number.slice(prefix.length), 10);
    if (Number.isInteger(parsed)) next = parsed + 1;
    else next = (await prisma.quotation.count({ where: { number: { startsWith: prefix } } })) + 1;
  }
  return `${prefix}${String(next).padStart(4, '0')}`;
}

/** Compute per-line totals (integer cents) and the quotation subtotal. */
function computeLines(lines: QuotationLineInput[]) {
  const computed = lines.map((line, idx) => {
    const discount = line.discountCents ?? 0;
    const lineTotalCents = Math.round(line.unitPriceCents * line.qty) - discount;
    if (lineTotalCents < 0) {
      throw new HttpError(400, `Line "${line.description}" has a negative total`);
    }
    return {
      productId: line.productId ?? null,
      description: line.description,
      qty: line.qty,
      unitLabel: line.unitLabel || 'pcs',
      unitPriceCents: line.unitPriceCents,
      discountCents: discount,
      totalCents: lineTotalCents,
      sortOrder: line.sortOrder ?? idx,
    };
  });
  const subtotalCents = computed.reduce((s, l) => s + l.totalCents, 0);
  return { computed, subtotalCents };
}

const fullInclude = {
  customer: { select: { id: true, name: true, phone: true } },
  lines: {
    orderBy: { sortOrder: 'asc' as const },
    include: { product: { select: { id: true, name: true } } },
  },
  deliveries: { select: { id: true, number: true, status: true } },
  createdBy: { select: { fullName: true } },
} satisfies Prisma.QuotationInclude;

// Allowed quotation status transitions.
const QUOTE_TRANSITIONS: Record<string, string[]> = {
  DRAFT:     ['SENT', 'REJECTED'],
  SENT:      ['ACCEPTED', 'REJECTED', 'EXPIRED'],
  ACCEPTED:  ['EXPIRED', 'CONVERTED'],
  REJECTED:  [],
  EXPIRED:   [],
  CONVERTED: [],
};

// ─── Service ────────────────────────────────────────────────────────────────

export const quotationService = {
  getAllQuotations: async (filters: QuotationFilters = {}) => {
    try {
      const where: Prisma.QuotationWhereInput = { deletedAt: null };
      if (filters.customerId) where.customerId = filters.customerId;
      if (filters.status) where.status = filters.status;
      if (filters.from || filters.to) {
        where.createdAt = {};
        if (filters.from) where.createdAt.gte = filters.from;
        if (filters.to) where.createdAt.lte = filters.to;
      }
      if (filters.search) {
        where.OR = [
          { number: { contains: filters.search, mode: 'insensitive' } },
          { title: { contains: filters.search, mode: 'insensitive' } },
          { customer: { name: { contains: filters.search, mode: 'insensitive' } } },
        ];
      }
      return await prisma.quotation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          _count: { select: { lines: true } },
        },
      });
    } catch (err) {
      logger.error(err, 'quotationService.getAllQuotations failed');
      throw err;
    }
  },

  getQuotationById: async (id: string) => {
    try {
      const quotation = await prisma.quotation.findFirst({
        where: { id, deletedAt: null },
        include: fullInclude,
      });
      if (!quotation) throw new HttpError(404, 'Quotation not found');

      // Attach the converted sale (id + number) if any.
      let convertedToSale: { id: string; number: string } | null = null;
      if (quotation.convertedToSaleId) {
        convertedToSale = await prisma.sale.findUnique({
          where: { id: quotation.convertedToSaleId },
          select: { id: true, number: true },
        });
      }
      return { ...quotation, convertedToSale };
    } catch (err) {
      logger.error(err, 'quotationService.getQuotationById failed');
      throw err;
    }
  },

  createQuotation: async (data: CreateQuotationInput) => {
    try {
      if (!data.lines || data.lines.length === 0) {
        throw new HttpError(400, 'A quotation needs at least one line');
      }
      if (data.customerId) {
        const customer = await prisma.customer.findUnique({ where: { id: data.customerId } });
        if (!customer) throw new HttpError(400, 'Customer not found');
      }

      const { computed, subtotalCents } = computeLines(data.lines);
      const totalCents = Math.max(0, subtotalCents); // no order-level discount on create
      const number = await generateQuoteNumber();

      const created = await prisma.$transaction(async (tx) => {
        return tx.quotation.create({
          data: {
            number,
            customerId: data.customerId ?? null,
            title: data.title ?? null,
            status: 'DRAFT',
            validUntil: data.validUntil ?? null,
            subtotalCents,
            discountCents: 0,
            taxCents: 0,
            totalCents,
            note: data.note ?? null,
            termsConditions: data.termsConditions ?? null,
            createdById: data.createdById,
            lines: { create: computed },
          },
          include: fullInclude,
        });
      });

      logger.info({ quotationId: created.id, number }, 'Quotation created');
      return created;
    } catch (err) {
      logger.error(err, 'quotationService.createQuotation failed');
      throw err;
    }
  },

  updateQuotation: async (id: string, data: UpdateQuotationInput) => {
    try {
      const existing = await prisma.quotation.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new HttpError(404, 'Quotation not found');
      if (existing.status !== 'DRAFT') {
        throw new HttpError(400, 'Only draft quotations can be edited');
      }

      const fields: Prisma.QuotationUpdateInput = {
        title: data.title ?? null,
        validUntil: data.validUntil ?? null,
        note: data.note ?? null,
        termsConditions: data.termsConditions ?? null,
      };

      const updated = await prisma.$transaction(async (tx) => {
        if (data.lines) {
          if (data.lines.length === 0) throw new HttpError(400, 'A quotation needs at least one line');
          const { computed, subtotalCents } = computeLines(data.lines);
          await tx.quotationLine.deleteMany({ where: { quotationId: id } });
          fields.subtotalCents = subtotalCents;
          fields.totalCents = Math.max(0, subtotalCents);
          fields.lines = { create: computed };
        }
        return tx.quotation.update({ where: { id }, data: fields, include: fullInclude });
      });

      logger.info({ quotationId: id }, 'Quotation updated');
      return updated;
    } catch (err) {
      logger.error(err, 'quotationService.updateQuotation failed');
      throw err;
    }
  },

  updateStatus: async (id: string, status: string) => {
    try {
      const existing = await prisma.quotation.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new HttpError(404, 'Quotation not found');

      const allowed = QUOTE_TRANSITIONS[existing.status] ?? [];
      if (!allowed.includes(status)) {
        throw new HttpError(400, `Invalid status transition: ${existing.status} → ${status}`);
      }
      const updated = await prisma.quotation.update({
        where: { id },
        data: { status },
        include: fullInclude,
      });
      logger.info({ quotationId: id, from: existing.status, to: status }, 'Quotation status updated');
      return updated;
    } catch (err) {
      logger.error(err, 'quotationService.updateStatus failed');
      throw err;
    }
  },

  /**
   * Converts an ACCEPTED quotation into a CONFIRMED sale.
   * SAFETY: runs in a single $transaction, never calls pos.service, and creates
   * the sale via direct Prisma so NO stock movement / deduction is triggered.
   */
  convertToSale: async (quotationId: string, userId: string) => {
    try {
      return await prisma.$transaction(async (tx) => {
        const quotation = await tx.quotation.findFirst({
          where: { id: quotationId, deletedAt: null },
          include: { lines: true },
        });
        if (!quotation) throw new HttpError(404, 'Quotation not found');
        if (quotation.status !== 'ACCEPTED') {
          throw new HttpError(400, 'Only accepted quotations can be converted to a sale');
        }
        if (quotation.convertedToSaleId) {
          throw new HttpError(400, 'This quotation has already been converted to a sale');
        }
        if (quotation.lines.length === 0) {
          throw new HttpError(400, 'Quotation has no lines to convert');
        }
        // SaleLine.productId is required — every line must be product-linked.
        const orphan = quotation.lines.find((l) => !l.productId);
        if (orphan) {
          throw new HttpError(400, 'All quotation lines must have a linked product before converting to a sale');
        }

        // Sale.warehouseId is required — use the default warehouse.
        const warehouse =
          (await tx.warehouse.findFirst({ where: { isDefault: true, isActive: true } })) ??
          (await tx.warehouse.findFirst({ where: { isActive: true } }));
        if (!warehouse) throw new HttpError(400, 'No active warehouse found to assign the sale');

        // Generate the next invoice number (shares the INV sequence).
        const year = new Date().getFullYear();
        const invPrefix = `INV-${year}-`;
        const invCount = await tx.sale.count({ where: { number: { startsWith: invPrefix } } });
        const saleNumber = `${invPrefix}${String(invCount + 1).padStart(4, '0')}`;

        const sale = await tx.sale.create({
          data: {
            number: saleNumber,
            customerId: quotation.customerId,
            warehouseId: warehouse.id,
            status: 'CONFIRMED',
            isPos: false,
            paymentStatus: 'UNPAID',
            paymentMethod: 'CASH',
            subtotalCents: quotation.subtotalCents,
            discountCents: quotation.discountCents,
            taxCents: quotation.taxCents,
            totalCents: quotation.totalCents,
            paidCents: 0,
            note: quotation.title ? `From quotation ${quotation.number} — ${quotation.title}` : `From quotation ${quotation.number}`,
            createdById: userId,
            lines: {
              create: quotation.lines.map((l) => ({
                productId: l.productId as string,
                qty: l.qty,
                unitPriceCents: l.unitPriceCents,
                taxPercent: 0,
                discountCents: l.discountCents,
                lineTotalCents: l.totalCents,
              })),
            },
          },
          select: { id: true, number: true },
        });

        const updatedQuotation = await tx.quotation.update({
          where: { id: quotationId },
          data: {
            convertedToSaleId: sale.id,
            convertedAt: new Date(),
            status: 'CONVERTED',
          },
          include: fullInclude,
        });

        logger.info({ quotationId, saleId: sale.id, saleNumber }, 'Quotation converted to sale');
        return { quotation: updatedQuotation, sale };
      });
    } catch (err) {
      logger.error(err, 'quotationService.convertToSale failed');
      throw err;
    }
  },

  deleteQuotation: async (id: string) => {
    try {
      const existing = await prisma.quotation.findFirst({ where: { id, deletedAt: null } });
      if (!existing) throw new HttpError(404, 'Quotation not found');
      if (existing.status !== 'DRAFT') {
        throw new HttpError(400, 'Only draft quotations can be deleted');
      }
      await prisma.quotation.update({ where: { id }, data: { deletedAt: new Date() } });
      logger.info({ quotationId: id }, 'Quotation soft-deleted');
      return { id };
    } catch (err) {
      logger.error(err, 'quotationService.deleteQuotation failed');
      throw err;
    }
  },

  duplicateQuotation: async (id: string, userId: string) => {
    try {
      const original = await prisma.quotation.findFirst({
        where: { id, deletedAt: null },
        include: { lines: { orderBy: { sortOrder: 'asc' } } },
      });
      if (!original) throw new HttpError(404, 'Quotation not found');

      const number = await generateQuoteNumber();
      const created = await prisma.$transaction(async (tx) =>
        tx.quotation.create({
          data: {
            number,
            customerId: original.customerId,
            title: original.title,
            status: 'DRAFT',
            validUntil: original.validUntil,
            subtotalCents: original.subtotalCents,
            discountCents: original.discountCents,
            taxCents: original.taxCents,
            totalCents: original.totalCents,
            note: original.note,
            termsConditions: original.termsConditions,
            createdById: userId,
            lines: {
              create: original.lines.map((l) => ({
                productId: l.productId,
                description: l.description,
                qty: l.qty,
                unitLabel: l.unitLabel,
                unitPriceCents: l.unitPriceCents,
                discountCents: l.discountCents,
                totalCents: l.totalCents,
                sortOrder: l.sortOrder,
              })),
            },
          },
          include: fullInclude,
        }),
      );
      logger.info({ from: id, to: created.id, number }, 'Quotation duplicated');
      return created;
    } catch (err) {
      logger.error(err, 'quotationService.duplicateQuotation failed');
      throw err;
    }
  },

  getQuotationStats: async () => {
    try {
      const now = new Date();
      const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
      const where: Prisma.QuotationWhereInput = { deletedAt: null, createdAt: { gte: monthStart } };

      const grouped = await prisma.quotation.groupBy({
        by: ['status'],
        where,
        _count: { _all: true },
        _sum: { totalCents: true },
      });

      const byStatus: Record<string, number> = {
        DRAFT: 0, SENT: 0, ACCEPTED: 0, REJECTED: 0, EXPIRED: 0, CONVERTED: 0,
      };
      let totalThisMonth = 0;
      let totalValueAcceptedCents = 0;
      for (const g of grouped) {
        byStatus[g.status] = g._count._all;
        totalThisMonth += g._count._all;
        if (g.status === 'ACCEPTED' || g.status === 'CONVERTED') {
          totalValueAcceptedCents += g._sum.totalCents ?? 0;
        }
      }

      const accepted = byStatus.ACCEPTED + byStatus.CONVERTED;
      const decided = accepted + byStatus.SENT + byStatus.REJECTED;
      const conversionRate = decided > 0 ? Math.round((accepted / decided) * 1000) / 10 : 0;

      return { totalThisMonth, byStatus, conversionRate, totalValueAcceptedCents };
    } catch (err) {
      logger.error(err, 'quotationService.getQuotationStats failed');
      throw err;
    }
  },
};
