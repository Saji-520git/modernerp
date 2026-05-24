import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../middleware/error-handler.js';

// ─── Categories ───────────────────────────────────────────────────────────────

export const categoriesService = {
  list: () => prisma.category.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { products: true } } },
  }),

  create: async (name: string) => {
    const exists = await prisma.category.findUnique({ where: { name } });
    if (exists) throw new HttpError(409, `Category "${name}" already exists`);
    return prisma.category.create({ data: { name } });
  },

  update: async (id: string, name: string) => {
    const existing = await prisma.category.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Category not found');
    const conflict = await prisma.category.findFirst({ where: { name, id: { not: id } } });
    if (conflict) throw new HttpError(409, `Category "${name}" already exists`);
    return prisma.category.update({ where: { id }, data: { name } });
  },

  delete: async (id: string) => {
    const existing = await prisma.category.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
    if (!existing) throw new HttpError(404, 'Category not found');
    if (existing._count.products > 0)
      throw new HttpError(409, `Cannot delete — ${existing._count.products} product(s) use this category`);
    return prisma.category.delete({ where: { id } });
  },
};

// ─── Brands ───────────────────────────────────────────────────────────────────

export const brandsService = {
  list: () => prisma.brand.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { products: true } } },
  }),

  create: async (name: string) => {
    const exists = await prisma.brand.findUnique({ where: { name } });
    if (exists) throw new HttpError(409, `Brand "${name}" already exists`);
    return prisma.brand.create({ data: { name } });
  },

  update: async (id: string, name: string) => {
    const existing = await prisma.brand.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Brand not found');
    const conflict = await prisma.brand.findFirst({ where: { name, id: { not: id } } });
    if (conflict) throw new HttpError(409, `Brand "${name}" already exists`);
    return prisma.brand.update({ where: { id }, data: { name } });
  },

  delete: async (id: string) => {
    const existing = await prisma.brand.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
    if (!existing) throw new HttpError(404, 'Brand not found');
    if (existing._count.products > 0)
      throw new HttpError(409, `Cannot delete — ${existing._count.products} product(s) use this brand`);
    return prisma.brand.delete({ where: { id } });
  },
};

// ─── Units ────────────────────────────────────────────────────────────────────

export const unitsService = {
  list: () => prisma.unit.findMany({
    orderBy: { name: 'asc' },
    include: { _count: { select: { products: true } } },
  }),

  create: async (name: string, shortCode: string, allowDecimal: boolean) => {
    const nameExists = await prisma.unit.findUnique({ where: { name } });
    if (nameExists) throw new HttpError(409, `Unit "${name}" already exists`);
    const codeExists = await prisma.unit.findUnique({ where: { shortCode } });
    if (codeExists) throw new HttpError(409, `Short code "${shortCode}" already exists`);
    return prisma.unit.create({ data: { name, shortCode, allowDecimal } });
  },

  update: async (id: string, name: string, shortCode: string, allowDecimal: boolean) => {
    const existing = await prisma.unit.findUnique({ where: { id } });
    if (!existing) throw new HttpError(404, 'Unit not found');
    const nameConflict = await prisma.unit.findFirst({ where: { name, id: { not: id } } });
    if (nameConflict) throw new HttpError(409, `Unit "${name}" already exists`);
    const codeConflict = await prisma.unit.findFirst({ where: { shortCode, id: { not: id } } });
    if (codeConflict) throw new HttpError(409, `Short code "${shortCode}" already exists`);
    return prisma.unit.update({ where: { id }, data: { name, shortCode, allowDecimal } });
  },

  delete: async (id: string) => {
    const existing = await prisma.unit.findUnique({ where: { id }, include: { _count: { select: { products: true } } } });
    if (!existing) throw new HttpError(404, 'Unit not found');
    if (existing._count.products > 0)
      throw new HttpError(409, `Cannot delete — ${existing._count.products} product(s) use this unit`);
    return prisma.unit.delete({ where: { id } });
  },
};
