import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../middleware/error-handler.js';
import type { CustomerBodyInput, ListCustomersInput } from './customers.schema.js';

export const customersService = {
  list: async (input: ListCustomersInput) => {
    const { search, page, pageSize, isActive } = input;
    const where: Record<string, unknown> = {};
    if (isActive !== 'all') where.isActive = isActive !== 'false';
    if (search) {
      where.OR = [
        { name: { contains: search, mode: 'insensitive' as const } },
        { phone: { contains: search, mode: 'insensitive' as const } },
        { email: { contains: search, mode: 'insensitive' as const } },
      ];
    }

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const w = where as any;
    const [total, data] = await prisma.$transaction([
      prisma.customer.count({ where: w }),
      prisma.customer.findMany({
        where: w,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { sales: true } } },
      }),
    ]);

    return { total, page, pageSize, data };
  },

  getOne: async (id: string) => {
    const customer = await prisma.customer.findUnique({
      where: { id },
      include: { _count: { select: { sales: true, customerPayments: true } } },
    });
    if (!customer) throw new HttpError(404, 'Customer not found');

    // Aggregate totals across CONFIRMED sales
    const salesAgg = await (prisma as any).sale.aggregate({
      where: { customerId: id, status: 'CONFIRMED', deletedAt: null },
      _sum: { totalCents: true, paidCents: true },
      _max: { date: true },
    });

    // Subtract returns against this customer's confirmed sales
    // SaleReturn has no soft-delete. If voiding is added: add isActive:true filter here.
    const returnsAgg = await (prisma as any).saleReturn.aggregate({
      where: { sale: { customerId: id, status: 'CONFIRMED' } },
      _sum: { totalCents: true },
    });

    const totalSalesAmount   = salesAgg._sum.totalCents  ?? 0;
    const totalPaid          = salesAgg._sum.paidCents   ?? 0;
    const totalReturned      = returnsAgg._sum.totalCents ?? 0;
    const outstandingBalance = Math.max(0, totalSalesAmount - totalReturned - totalPaid);
    const lastPurchaseDate   = salesAgg._max.date        ?? null;

    // Credit used = outstanding balance on unpaid/partial confirmed sales
    let creditUsedCents = 0;
    if (customer.creditEnabled) {
      const unpaidAgg = await (prisma as any).sale.aggregate({
        where: {
          customerId: id, status: 'CONFIRMED', deletedAt: null,
          paymentStatus: { in: ['UNPAID', 'PARTIAL'] },
        },
        _sum: { totalCents: true, paidCents: true },
      });
      creditUsedCents =
        (unpaidAgg._sum.totalCents ?? 0) - (unpaidAgg._sum.paidCents ?? 0);
    }

    return {
      ...customer,
      totalSalesAmount,
      totalPaid,
      outstandingBalance,
      lastPurchaseDate,
      creditUsedCents,
    };
  },

  create: async (input: CustomerBodyInput) => {
    return prisma.customer.create({
      data: {
        name:             input.name,
        phone:            input.phone || null,
        email:            input.email || null,
        address:          input.address || null,
        creditEnabled:    input.creditEnabled ?? false,
        creditLimitCents: input.creditLimitCents ?? 0,
        creditAlertPct:   input.creditAlertPct ?? 80,
        creditSettleDays: input.creditSettleDays ?? null,
      },
    });
  },

  update: async (id: string, input: CustomerBodyInput) => {
    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Customer not found');
    return prisma.customer.update({
      where: { id },
      data: {
        name:             input.name,
        phone:            input.phone || null,
        email:            input.email || null,
        address:          input.address || null,
        creditEnabled:    input.creditEnabled ?? false,
        creditLimitCents: input.creditLimitCents ?? 0,
        creditAlertPct:   input.creditAlertPct ?? 80,
        creditSettleDays: input.creditSettleDays ?? null,
      },
    });
  },

  toggleActive: async (id: string) => {
    const existing = await prisma.customer.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Customer not found');
    return prisma.customer.update({
      where: { id },
      data: { isActive: !existing.isActive },
    });
  },

  // ─── Smart delete ─────────────────────────────────────────────────────────
  // Client-facing "Delete" always succeeds; behaviour is decided here:
  //   • Customer with ANY sales history → soft delete (isActive:false) so the
  //     record (and its sales) stays intact and just hides from active lists.
  //   • Customer with NO history → permanently removed from the DB.
  // Held POS drafts reference customerId (nullable) and can exist without any
  // sale, so we unlink them first (set customerId:null) before the delete to
  // avoid a FK constraint. CustomerPayment requires a saleId, so none can
  // exist when saleCount === 0 — nothing else needs clearing.
  smartDelete: async (id: string): Promise<void> => {
    const existing = await prisma.customer.findUnique({ where: { id }, select: { id: true } });
    if (!existing) throw new HttpError(404, 'Customer not found');

    const saleCount = await prisma.sale.count({ where: { customerId: id } });

    if (saleCount > 0) {
      // History exists — keep the record, just hide it.
      await prisma.customer.update({ where: { id }, data: { isActive: false } });
      return;
    }

    // No history — safe to remove permanently. Unlink any held drafts first.
    await prisma.$transaction([
      prisma.posDraft.updateMany({ where: { customerId: id }, data: { customerId: null } }),
      prisma.customer.delete({ where: { id } }),
    ]);
  },
};
