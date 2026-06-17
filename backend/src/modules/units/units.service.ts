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

    const [total, units, roleRows] = await prisma.$transaction([
      prisma.unit.count({ where }),
      prisma.unit.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { name: 'asc' },
      }),
      // Distinct active-product count per unit: pull every active product's three
      // unit-role ids in ONE query, then tally below. (Replaces the old _count
      // role-sum, which double-counted multi-role products and counted inactive
      // recycle-bin products.)
      prisma.product.findMany({
        where: { isActive: true },
        select: { baseUnitId: true, purchaseUnitId: true, salesUnitId: true },
      }),
    ]);

    // Count each active product ONCE per distinct unit it references in any role
    // (base/purchase/sales). A product using Piece as base AND sales adds 1 to
    // Piece, not 2.
    const countMap = new Map<string, number>();
    for (const p of roleRows) {
      const unitIds = new Set(
        [p.baseUnitId, p.purchaseUnitId, p.salesUnitId].filter(
          (id): id is string => id != null,
        ),
      );
      for (const id of unitIds) {
        countMap.set(id, (countMap.get(id) ?? 0) + 1);
      }
    }

    const data = units.map(u => ({ ...u, productCount: countMap.get(u.id) ?? 0 }));

    return { total, page, pageSize, data };
  },

  async getById(id: string) {
    const unit = await prisma.unit.findUnique({ where: { id } });
    if (!unit) throw new HttpError(404, 'Unit not found');
    // Distinct active products using this unit in any role (base/purchase/sales).
    const productCount = await prisma.product.count({
      where: {
        isActive: true,
        OR: [{ baseUnitId: id }, { purchaseUnitId: id }, { salesUnitId: id }],
      },
    });
    return { ...unit, productCount };
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
            // Only ACTIVE products/conversions should block deactivation —
            // recycle-bin (isActive:false) rows must not keep a unit locked.
            products:           { where: { isActive: true } },  // legacy unitId
            productsAsBase:     { where: { isActive: true } },
            productsAsPurchase: { where: { isActive: true } },
            productsAsSales:    { where: { isActive: true } },
            conversionsFrom:    { where: { isActive: true } },
            conversionsTo:      { where: { isActive: true } },
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
