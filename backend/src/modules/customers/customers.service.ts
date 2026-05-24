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
    const customer = await prisma.customer.findUnique({ where: { id } });
    if (!customer) throw new HttpError(404, 'Customer not found');
    return customer;
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
};
