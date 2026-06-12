import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';
import type { CreateSaleInput, ListSalesInput, RecordPaymentInput } from './sales.schema.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function generateInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  // Count ALL sales (POS + invoices) to share the number sequence
  const count = await prisma.sale.count({
    where: { number: { startsWith: prefix } },
  });
  return `${prefix}${String(count + 1).padStart(4, '0')}`;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const salesService = {
  // ── Customers dropdown ─────────────────────────────────────────────────────

  listCustomers: async () => {
    return prisma.customer.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, phone: true, email: true },
    });
  },

  // ── Products with current stock for a warehouse ────────────────────────────

  listProducts: async (warehouseId?: string) => {
    const products = await prisma.product.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        sku: true,
        priceCents: true,
        taxPercent: true,
        unit: { select: { shortCode: true } },
        stock: warehouseId
          ? { where: { warehouseId }, select: { qty: true } }
          : { select: { qty: true, warehouseId: true } },
      },
    });

    return products.map((p) => ({
      ...p,
      stockQty: p.stock.reduce((sum, s) => sum + Number(s.qty), 0),
    }));
  },

  // ── List sales (all types: POS + invoices) ────────────────────────────────

  listSales: async (input: ListSalesInput) => {
    const { search, status, paymentMethod, customerId, warehouseId, from, to, includePos, page, pageSize } = input;

    const where: Record<string, unknown> = { deletedAt: null };

    // isPos filter: default includes all (POS + invoices)
    if (includePos === 'false') where.isPos = false;

    if (status) where.status = status;
    if (paymentMethod) where.paymentMethod = paymentMethod;
    if (customerId) where.customerId = customerId;
    if (warehouseId) where.warehouseId = warehouseId;
    if (from || to) {
      where.date = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to   ? { lte: new Date(to + 'T23:59:59Z') } : {}),
      };
    }
    if (search) {
      where.OR = [
        { number: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { note: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, data] = await prisma.$transaction([
      prisma.sale.count({ where: where as any }),
      prisma.sale.findMany({
        where: where as any,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          warehouse: { select: { id: true, name: true, code: true } },
          createdBy: { select: { id: true, fullName: true } },
          _count: { select: { lines: true } },
        },
      }),
    ]);

    return { total, page, pageSize, data };
  },

  // ── Get single sale/invoice with lines ─────────────────────────────────────

  getSale: async (id: string) => {
    const sale = await (prisma as any).sale.findFirst({
      where: { id, deletedAt: null },
      include: {
        customer: true,
        warehouse: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, fullName: true } },
        lines: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                unit: { select: { shortCode: true } },
              },
            },
          },
        },
        customerPayments: {
          where:   { isActive: true },
          orderBy: { paymentDate: 'asc' },
          include: { createdByUser: { select: { id: true, fullName: true } } },
        },
      },
    });
    if (!sale) throw new HttpError(404, 'Invoice not found');
    return sale;
  },

  // ── Create draft invoice ───────────────────────────────────────────────────

  createSale: async (input: CreateSaleInput, userId: string) => {
    // Validate warehouse
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: input.warehouseId },
    });
    if (!warehouse) throw new HttpError(400, 'Warehouse not found');
    if (!warehouse.isActive) throw new HttpError(400, 'Warehouse is not active');

    // Validate customer if provided
    if (input.customerId) {
      const customer = await prisma.customer.findUnique({
        where: { id: input.customerId },
      });
      if (!customer) throw new HttpError(400, 'Customer not found');
    }

    // Validate all products exist and are active
    const productIds = [...new Set(input.lines.map((l) => l.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
    });
    if (products.length !== productIds.length) {
      throw new HttpError(400, 'One or more products not found or inactive');
    }

    const number = await generateInvoiceNumber();

    // Compute line and order totals (all integer cents)
    const computedLines = input.lines.map((line) => {
      const subtotal = Math.round(line.qty * line.unitPriceCents);
      const tax = Math.round(subtotal * (line.taxPercent / 100));
      const lineTotal = subtotal + tax - line.discountCents;
      return {
        ...line,
        subtotalCents: subtotal,
        taxLineCents: tax,
        lineTotalCents: Math.max(0, lineTotal),
      };
    });

    const subtotalCents = computedLines.reduce((s, l) => s + l.subtotalCents, 0);
    const taxCents = computedLines.reduce((s, l) => s + l.taxLineCents, 0);
    const discountCents = computedLines.reduce((s, l) => s + l.discountCents, 0);
    const totalCents = subtotalCents + taxCents - discountCents;

    return prisma.sale.create({
      data: {
        number,
        isPos: false,
        customerId: input.customerId || null,
        warehouseId: input.warehouseId,
        date: input.date ? new Date(input.date) : new Date(),
        note: input.note,
        subtotalCents,
        taxCents,
        discountCents,
        totalCents,
        paidCents: 0,
        status: 'DRAFT',
        paymentMethod: 'CASH',
        createdById: userId,
        lines: {
          create: computedLines.map((l) => ({
            productId: l.productId,
            qty: l.qty,
            unitPriceCents: l.unitPriceCents,
            taxPercent: l.taxPercent,
            discountCents: l.discountCents,
            lineTotalCents: l.lineTotalCents,
          })),
        },
      },
      include: {
        customer: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true, code: true } },
        lines: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
          },
        },
      },
    });
  },

  // ── Confirm invoice → deduct stock ─────────────────────────────────────────

  confirmSale: async (id: string) => {
    const sale = await (prisma as any).sale.findFirst({
      where: { id, isPos: false, deletedAt: null },
      include: { lines: true },
    });
    if (!sale) throw new HttpError(404, 'Invoice not found');
    if (sale.status !== 'DRAFT') {
      throw new HttpError(409, `Cannot confirm a ${sale.status.toLowerCase()} invoice`);
    }

    logger.info({ saleId: id, number: sale.number, lines: sale.lines.length }, 'Confirming invoice');

    await prisma.$transaction(async (tx) => {
      // Lock each stock row with SELECT FOR UPDATE before checking or decrementing.
      // This serialises concurrent confirmations for the same product+warehouse so the
      // check and the decrement see the same committed value — preventing overselling.
      for (const line of sale.lines) {
        const locked = await tx.$queryRaw<{ qty: number }[]>`
          SELECT qty::float AS qty FROM "Stock"
          WHERE "productId" = ${line.productId} AND "warehouseId" = ${sale.warehouseId}
          FOR UPDATE
        `;
        const available = locked[0]?.qty ?? 0;
        const needed    = Number(line.qty);
        if (available < needed) {
          const product = await tx.product.findUnique({
            where: { id: line.productId },
            select: { name: true },
          });
          throw new HttpError(
            400,
            `Insufficient stock for "${product?.name}": available ${available}, needed ${needed}`,
          );
        }
      }

      // Confirm the invoice
      await tx.sale.update({ where: { id }, data: { status: 'CONFIRMED' } });

      // Deduct stock + write SALE_OUT movements (row is still locked for this transaction)
      for (const line of sale.lines) {
        await tx.stock.update({
          where: { productId_warehouseId: { productId: line.productId, warehouseId: sale.warehouseId } },
          data: { qty: { decrement: line.qty } },
        });
        await tx.stockMovement.create({
          data: {
            productId:   line.productId,
            warehouseId: sale.warehouseId,
            type:        'SALE_OUT',
            qty:         line.qty,
            refType:     'Sale',
            refId:       id,
            note:        `Invoice ${sale.number}`,
          },
        });
      }
    });

    logger.info({ saleId: id, number: sale.number }, 'Invoice confirmed');

    return prisma.sale.findUnique({
      where: { id },
      include: {
        customer: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true, code: true } },
        lines: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                unit: { select: { shortCode: true } },
              },
            },
          },
        },
      },
    });
  },

  // ── Update invoice (DRAFT only) ───────────────────────────────────────────

  updateSale: async (id: string, input: import('./sales.schema.js').UpdateSaleInput) => {
    const sale = await (prisma as any).sale.findFirst({ where: { id, isPos: false, deletedAt: null }, include: { lines: true } });
    if (!sale) throw new HttpError(404, 'Invoice not found');
    if (sale.status !== 'DRAFT') throw new HttpError(400, 'Cannot edit a confirmed or cancelled invoice');

    const lines = input.lines ?? [];
    let subtotalCents = 0;
    for (const l of lines) {
      subtotalCents += Math.round(l.qty * l.unitPriceCents) - (l.discountCents ?? 0);
    }
    const discountCents = input.discountCents ?? sale.discountCents;
    const totalCents = Math.max(0, subtotalCents - discountCents);

    return prisma.$transaction(async (tx) => {
      await tx.saleLine.deleteMany({ where: { saleId: id } });
      return tx.sale.update({
        where: { id },
        data: {
          customerId:   input.customerId !== undefined ? (input.customerId ?? null) : sale.customerId,
          warehouseId:  input.warehouseId ?? sale.warehouseId,
          date:         input.date ? new Date(input.date) : sale.date,
          note:         input.note !== undefined ? (input.note ?? null) : sale.note,
          discountCents,
          subtotalCents,
          totalCents,
          lines: {
            create: lines.map((l) => ({
              productId:     l.productId,
              qty:           l.qty,
              unitPriceCents:l.unitPriceCents,
              taxPercent:    l.taxPercent,
              discountCents: l.discountCents ?? 0,
              lineTotalCents: Math.round(l.qty * l.unitPriceCents) - (l.discountCents ?? 0),
            })),
          },
        },
        include: {
          customer:  { select: { id: true, name: true } },
          warehouse: { select: { id: true, name: true, code: true } },
          createdBy: { select: { id: true, fullName: true } },
          lines: { include: { product: { select: { id: true, name: true, sku: true, unit: { select: { shortCode: true } } } } } },
        },
      });
    });
  },

  // ── Cancel invoice (DRAFT only) ────────────────────────────────────────────

  cancelSale: async (id: string) => {
    const sale = await (prisma as any).sale.findFirst({ where: { id, isPos: false, deletedAt: null } });
    if (!sale) throw new HttpError(404, 'Invoice not found');
    if (sale.status !== 'DRAFT') {
      throw new HttpError(409, `Cannot cancel a ${sale.status.toLowerCase()} invoice`);
    }
    return prisma.sale.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  },

  // ── Record payment (creates Payment row + increments paidCents) ──────────

  recordPayment: async (id: string, input: RecordPaymentInput, userId: string) => {
    const sale = await (prisma as any).sale.findFirst({ where: { id, deletedAt: null } });
    if (!sale) throw new HttpError(404, 'Sale not found');
    if (sale.status !== 'CONFIRMED') throw new HttpError(400, 'Can only record payment on confirmed invoices');
    if (input.paidCents <= 0) throw new HttpError(400, 'Payment amount must be greater than 0');

    // Sales returns reduce what the customer effectively owes (v1.0.54).
    // effectiveTotal = totalCents - sum(returns); cap payment at effectiveTotal - paidCents.
    // SaleReturn has no soft-delete. If voiding is added: add isActive:true filter here.
    const returnsAgg = await prisma.saleReturn.aggregate({
      where: { saleId: id },
      _sum: { totalCents: true },
    });
    const returnedCents = returnsAgg._sum.totalCents ?? 0;
    const effectiveTotal = Math.max(0, sale.totalCents - returnedCents);
    const outstanding = effectiveTotal - sale.paidCents;
    if (outstanding <= 0) {
      throw new HttpError(400, 'This invoice has been fully paid or refunded. No payment due.');
    }
    if (input.paidCents > outstanding) {
      throw new HttpError(400, `Payment exceeds outstanding balance of Rs.${(outstanding / 100).toFixed(2)}`);
    }

    return prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          saleId:      id,
          amountCents: input.paidCents,
          method:      input.paymentMethod,
          createdById: userId,
        },
      });
      return tx.sale.update({
        where: { id },
        data: { paidCents: { increment: input.paidCents }, paymentMethod: input.paymentMethod },
      });
    });
  },

  // ── List payments for a sale ──────────────────────────────────────────────

  listPayments: async (id: string) => {
    const sale = await (prisma as any).sale.findFirst({ where: { id, deletedAt: null } });
    if (!sale) throw new HttpError(404, 'Sale not found');
    return prisma.payment.findMany({
      where: { saleId: id },
      orderBy: { createdAt: 'asc' },
      include: { createdBy: { select: { fullName: true } } },
    });
  },

  deleteSale: async (id: string, userId: string) => {
    const sale = await (prisma as any).sale.findFirst({ where: { id, isPos: false, deletedAt: null } });
    if (!sale) throw new HttpError(404, 'Invoice not found');
    if (sale.status !== 'DRAFT') throw new HttpError(400, 'Only DRAFT invoices can be deleted');
    await (prisma as any).sale.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: userId },
    });
    return { success: true };
  },
};
