import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../middleware/error-handler.js';
import type { SupplierBodyInput, ListSuppliersInput } from './suppliers.schema.js';

export const suppliersService = {
  list: async (input: ListSuppliersInput) => {
    const { search, page, pageSize } = input;
    const where = search
      ? {
          OR: [
            { name: { contains: search, mode: 'insensitive' as const } },
            { phone: { contains: search, mode: 'insensitive' as const } },
            { email: { contains: search, mode: 'insensitive' as const } },
          ],
        }
      : {};

    const [total, data] = await prisma.$transaction([
      prisma.supplier.count({ where }),
      prisma.supplier.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: { _count: { select: { purchases: true } } },
      }),
    ]);

    return { total, page, pageSize, data };
  },

  getOne: async (id: string) => {
    const supplier = await prisma.supplier.findUnique({
      where: { id },
      include: { _count: { select: { purchases: true } } },
    });
    if (!supplier) throw new HttpError(404, 'Supplier not found');

    const purchasesAgg = await (prisma as any).purchase.aggregate({
      where: { supplierId: id, status: 'CONFIRMED', deletedAt: null },
      _sum: { totalCents: true, paidCents: true },
      _max: { date: true },
    });

    const totalPurchaseAmount = purchasesAgg._sum.totalCents ?? 0;
    const totalPaid           = purchasesAgg._sum.paidCents  ?? 0;
    const outstandingBalance  = totalPurchaseAmount - totalPaid;
    const lastOrderDate       = purchasesAgg._max.date ?? null;

    const returnsAgg = await (prisma as any).purchaseReturn.aggregate({
      where: { supplierId: id, isActive: true },
      _count: { id: true },
    });
    const totalReturns = returnsAgg._count.id ?? 0;

    return {
      ...supplier,
      totalPurchaseAmount,
      totalPaid,
      outstandingBalance,
      lastOrderDate,
      totalReturns,
    };
  },

  create: async (input: SupplierBodyInput) => {
    return prisma.supplier.create({
      data: {
        name: input.name,
        phone: input.phone || null,
        email: input.email || null,
        address: input.address || null,
      },
    });
  },

  update: async (id: string, input: SupplierBodyInput) => {
    const existing = await prisma.supplier.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Supplier not found');
    return prisma.supplier.update({
      where: { id },
      data: {
        name: input.name,
        phone: input.phone || null,
        email: input.email || null,
        address: input.address || null,
      },
    });
  },

  toggleActive: async (id: string) => {
    const existing = await prisma.supplier.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Supplier not found');
    return prisma.supplier.update({
      where: { id },
      data: { isActive: !existing.isActive },
    });
  },
};
