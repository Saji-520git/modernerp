import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../middleware/error-handler.js';
import type { CreateUnitInput, UpdateUnitInput, ListUnitsInput } from './units.schema.js';

export const unitsService = {

  async list(input: ListUnitsInput) {
    const { search, type, isActive, page, pageSize } = input;
    const skip = (page - 1) * pageSize;

    const where: Record<string, unknown> = {};
    if (isActive !== 'all') where.isActive = isActive !== 'false';
    if (type) where.type = type;
    if (search) {
      where.OR = [
        { name:      { contains: search, mode: 'insensitive' } },
        { shortCode: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, data] = await prisma.$transaction([
      prisma.unit.count({ where }),
      prisma.unit.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { name: 'asc' },
        include: {
          _count: {
            select: {
              productsAsBase:     true,
              productsAsPurchase: true,
              productsAsSales:    true,
            },
          },
        },
      }),
    ]);

    return { total, page, pageSize, data };
  },

  async getById(id: string) {
    const unit = await prisma.unit.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            productsAsBase:     true,
            productsAsPurchase: true,
            productsAsSales:    true,
          },
        },
      },
    });
    if (!unit) throw new HttpError(404, 'Unit not found');
    return unit;
  },

  async create(input: CreateUnitInput) {
    const nameTaken = await prisma.unit.findUnique({ where: { name: input.name } });
    if (nameTaken) throw new HttpError(409, `Unit name "${input.name}" already exists`);

    const codeTaken = await prisma.unit.findUnique({ where: { shortCode: input.shortCode } });
    if (codeTaken) throw new HttpError(409, `Short code "${input.shortCode}" already exists`);

    return prisma.unit.create({ data: input });
  },

  async update(id: string, input: UpdateUnitInput) {
    const existing = await prisma.unit.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Unit not found');

    if (input.name && input.name !== existing.name) {
      const conflict = await prisma.unit.findUnique({ where: { name: input.name } });
      if (conflict) throw new HttpError(409, `Unit name "${input.name}" already exists`);
    }

    if (input.shortCode && input.shortCode !== existing.shortCode) {
      const conflict = await prisma.unit.findUnique({ where: { shortCode: input.shortCode } });
      if (conflict) throw new HttpError(409, `Short code "${input.shortCode}" already exists`);
    }

    return prisma.unit.update({ where: { id }, data: input });
  },

  async softDelete(id: string) {
    const existing = await prisma.unit.findUnique({
      where: { id },
      include: {
        _count: {
          select: {
            products:           true,  // legacy unitId
            productsAsBase:     true,
            productsAsPurchase: true,
            productsAsSales:    true,
            conversionsFrom:    true,
            conversionsTo:      true,
          },
        },
      },
    });
    if (!existing) throw new HttpError(404, 'Unit not found');

    const usageCount =
      existing._count.products +
      existing._count.productsAsBase +
      existing._count.productsAsPurchase +
      existing._count.productsAsSales +
      existing._count.conversionsFrom +
      existing._count.conversionsTo;

    if (usageCount > 0) {
      throw new HttpError(
        400,
        `Cannot deactivate — this unit is used by ${usageCount} product(s) or conversion(s).`,
      );
    }

    return prisma.unit.update({ where: { id }, data: { isActive: false } });
  },
};
