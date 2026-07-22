import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';
import { salesService } from '../sales/sales.service.js';
import type { CreateQuotationInput, UpdateQuotationInput, SetStatusInput } from './quotations.schema.js';

async function generateQuotationNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `QUO-${year}-`;
  const count = await prisma.quotation.count({ where: { number: { startsWith: prefix } } });
  return `${prefix}${String(count + 1).padStart(4, '0')}`;
}

type LineInput = CreateQuotationInput['lines'][number];

/** Per-line total (qty × price − line discount, floored at 0) + rolled-up order totals. */
function computeTotals(lines: LineInput[], discountCents: number, taxCents: number) {
  const computed = lines.map((l, i) => {
    const gross = Math.round(l.qty * l.unitPriceCents);
    const total = Math.max(0, gross - l.discountCents);
    return {
      productId:      l.productId ?? null,
      description:    l.description,
      qty:            l.qty,
      unitLabel:      l.unitLabel,
      unitPriceCents: l.unitPriceCents,
      discountCents:  l.discountCents,
      totalCents:     total,
      sortOrder:      i,
    };
  });
  const subtotalCents = computed.reduce((s, l) => s + l.totalCents, 0);
  const totalCents = Math.max(0, subtotalCents - discountCents + taxCents);
  return { computed, subtotalCents, totalCents };
}

const DETAIL_INCLUDE = {
  lines: { orderBy: { sortOrder: 'asc' } },
  customer: { select: { id: true, name: true, phone: true, email: true, address: true } },
} as const;

export const quotationsService = {
  list: () =>
    prisma.quotation.findMany({
      where: { deletedAt: null },
      orderBy: { createdAt: 'desc' },
      include: { customer: { select: { id: true, name: true } }, _count: { select: { lines: true } } },
    }),

  getById: async (id: string) => {
    const q = await prisma.quotation.findFirst({ where: { id, deletedAt: null }, include: DETAIL_INCLUDE });
    if (!q) throw new HttpError(404, 'Quotation not found');
    return q;
  },

  create: async (input: CreateQuotationInput, userId: string) => {
    const { computed, subtotalCents, totalCents } = computeTotals(input.lines, input.discountCents, input.taxCents);
    const number = await generateQuotationNumber();
    return prisma.quotation.create({
      data: {
        number, customerId: input.customerId ?? null, title: input.title ?? null,
        validUntil: input.validUntil ?? null, note: input.note ?? null, termsConditions: input.termsConditions ?? null,
        discountCents: input.discountCents, taxCents: input.taxCents, subtotalCents, totalCents,
        createdById: userId,
        lines: { create: computed },
      },
      include: DETAIL_INCLUDE,
    });
  },

  update: async (id: string, input: UpdateQuotationInput) => {
    const existing = await quotationsService.getById(id);
    if (existing.status === 'CONVERTED') throw new HttpError(400, 'A converted quotation cannot be edited');
    const { computed, subtotalCents, totalCents } = computeTotals(input.lines, input.discountCents, input.taxCents);
    return prisma.$transaction(async (tx) => {
      await tx.quotationLine.deleteMany({ where: { quotationId: id } });
      return tx.quotation.update({
        where: { id },
        data: {
          customerId: input.customerId ?? null, title: input.title ?? null, validUntil: input.validUntil ?? null,
          note: input.note ?? null, termsConditions: input.termsConditions ?? null,
          discountCents: input.discountCents, taxCents: input.taxCents, subtotalCents, totalCents,
          lines: { create: computed },
        },
        include: DETAIL_INCLUDE,
      });
    });
  },

  setStatus: async (id: string, input: SetStatusInput) => {
    const q = await quotationsService.getById(id);
    if (q.status === 'CONVERTED') throw new HttpError(400, 'A converted quotation cannot change status');
    return prisma.quotation.update({ where: { id }, data: { status: input.status }, include: DETAIL_INCLUDE });
  },

  remove: async (id: string) => {
    await quotationsService.getById(id);
    await prisma.quotation.update({ where: { id }, data: { deletedAt: new Date() } });
    return { success: true };
  },

  /** Convert to a DRAFT sales invoice (reuses the sales create flow). All lines must be product-linked. */
  convertToSale: async (id: string, warehouseId: string, userId: string) => {
    const q = await quotationsService.getById(id);
    if (q.status === 'CONVERTED') throw new HttpError(400, 'Quotation already converted');
    const freeText = q.lines.filter((l) => !l.productId);
    if (freeText.length > 0) throw new HttpError(400, 'All lines must be linked to a product before converting to a sale');

    const sale = await salesService.createSale({
      warehouseId,
      customerId: q.customerId ?? undefined,
      lines: q.lines.map((l) => ({
        productId: l.productId!, qty: l.qty, unitPriceCents: l.unitPriceCents,
        taxPercent: 0, discountCents: l.discountCents,
      })),
    } as Parameters<typeof salesService.createSale>[0], userId);

    await prisma.quotation.update({
      where: { id },
      data: { status: 'CONVERTED', convertedToSaleId: sale.id, convertedAt: new Date() },
    });
    logger.info({ quotationId: id, saleId: sale.id }, 'Quotation converted to sale');
    return { saleId: sale.id, saleNumber: sale.number };
  },
};
