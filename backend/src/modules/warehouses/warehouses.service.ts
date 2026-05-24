import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';
import type { CreateWarehouseInput, UpdateWarehouseInput, ListWarehousesInput } from './warehouses.schema.js';

// ─── Shared select ────────────────────────────────────────────────────────────

const warehouseSelect = {
  id:        true,
  name:      true,
  code:      true,
  address:   true,
  city:      true,
  phone:     true,
  email:     true,
  type:      true,
  isActive:  true,
  isDefault: true,
  notes:     true,
  managerId: true,
  manager:   { select: { id: true, fullName: true, email: true } },
  createdAt: true,
  updatedAt: true,
  _count: {
    select: {
      stock:     true,
      purchases: true,
      sales:     true,
      posShifts: { where: { status: 'OPEN' as const } },
    },
  },
} as const;

// ─── Service ──────────────────────────────────────────────────────────────────

export const warehousesService = {

  list: async (query: ListWarehousesInput) => {
    const where: Record<string, unknown> = {};

    if (query.search) {
      where.OR = [
        { name: { contains: query.search, mode: 'insensitive' } },
        { code: { contains: query.search, mode: 'insensitive' } },
        { city: { contains: query.search, mode: 'insensitive' } },
      ];
    }
    if (query.type)               where.type     = query.type;
    if (query.isActive !== undefined) where.isActive = query.isActive;

    const [items, total] = await Promise.all([
      prisma.warehouse.findMany({
        where,
        select:  warehouseSelect,
        orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
        skip:    (query.page - 1) * query.pageSize,
        take:    query.pageSize,
      }),
      prisma.warehouse.count({ where }),
    ]);

    return { items, total, page: query.page, pageSize: query.pageSize };
  },

  get: async (id: string) => {
    const w = await prisma.warehouse.findFirst({
      where: { id },
      select: {
        ...warehouseSelect,
        stock: {
          select: {
            qty:     true,
            product: { select: { id: true, name: true, sku: true, costCents: true } },
          },
          where:   { qty: { gt: new Decimal(0) } },
          orderBy: { qty: 'desc' },
          take:    50,
        },
      },
    });
    if (!w) throw new HttpError(404, 'Warehouse not found');
    return w;
  },

  create: async (input: CreateWarehouseInput) => {
    const existingName = await prisma.warehouse.findFirst({
      where: { name: { equals: input.name, mode: 'insensitive' } },
    });
    if (existingName) throw new HttpError(400, `Warehouse "${input.name}" already exists`);

    const existingCode = await prisma.warehouse.findFirst({
      where: { code: input.code.toUpperCase() },
    });
    if (existingCode) throw new HttpError(400, `Code "${input.code}" is already in use`);

    if (input.isDefault) {
      await prisma.warehouse.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    }

    const warehouse = await prisma.warehouse.create({
      data: { ...input, code: input.code.toUpperCase() },
      select: warehouseSelect,
    });
    logger.info({ warehouseId: warehouse.id, name: warehouse.name }, 'Warehouse created');
    return warehouse;
  },

  update: async (id: string, input: UpdateWarehouseInput) => {
    const existing = await prisma.warehouse.findFirst({ where: { id } });
    if (!existing) throw new HttpError(404, 'Warehouse not found');

    if (input.name && input.name !== existing.name) {
      const dupe = await prisma.warehouse.findFirst({
        where: { name: { equals: input.name, mode: 'insensitive' }, id: { not: id } },
      });
      if (dupe) throw new HttpError(400, `Warehouse "${input.name}" already exists`);
    }

    if (input.code && input.code.toUpperCase() !== existing.code) {
      const dupe = await prisma.warehouse.findFirst({
        where: { code: input.code.toUpperCase(), id: { not: id } },
      });
      if (dupe) throw new HttpError(400, `Code "${input.code}" is already in use`);
    }

    if (input.isDefault && !existing.isDefault) {
      await prisma.warehouse.updateMany({
        where: { isDefault: true, id: { not: id } },
        data:  { isDefault: false },
      });
    }

    const updated = await prisma.warehouse.update({
      where: { id },
      data:  { ...input, code: input.code ? input.code.toUpperCase() : undefined },
      select: warehouseSelect,
    });
    logger.info({ warehouseId: id }, 'Warehouse updated');
    return updated;
  },

  toggleActive: async (id: string) => {
    const w = await prisma.warehouse.findFirst({ where: { id } });
    if (!w) throw new HttpError(404, 'Warehouse not found');

    if (w.isActive) {
      const activeCount = await prisma.warehouse.count({ where: { isActive: true } });
      if (activeCount <= 1) throw new HttpError(400, 'Cannot deactivate the only active warehouse');
      if (w.isDefault) throw new HttpError(400,
        'Cannot deactivate the default warehouse. Set another warehouse as default first.');
    }

    const updated = await prisma.warehouse.update({
      where: { id },
      data:  { isActive: !w.isActive },
      select: warehouseSelect,
    });
    logger.info({ warehouseId: id, isActive: updated.isActive }, 'Warehouse toggled');
    return updated;
  },

  setDefault: async (id: string) => {
    const w = await prisma.warehouse.findFirst({ where: { id } });
    if (!w) throw new HttpError(404, 'Warehouse not found');
    if (!w.isActive) throw new HttpError(400, 'Cannot set an inactive warehouse as default');

    await prisma.warehouse.updateMany({ where: { isDefault: true }, data: { isDefault: false } });
    return prisma.warehouse.update({
      where:  { id },
      data:   { isDefault: true },
      select: warehouseSelect,
    });
  },

  getStats: async (id: string) => {
    const w = await prisma.warehouse.findFirst({ where: { id } });
    if (!w) throw new HttpError(404, 'Warehouse not found');

    const [stockStats, recentMovements, openShifts] = await Promise.all([
      prisma.stock.aggregate({
        where: { warehouseId: id },
        _sum:   { qty: true },
        _count: { productId: true },
      }),
      prisma.stockMovement.findMany({
        where:   { warehouseId: id },
        orderBy: { createdAt: 'desc' },
        take:    10,
        select: {
          id: true, type: true, qty: true, createdAt: true,
          product: { select: { name: true, sku: true } },
        },
      }),
      prisma.posShift.count({ where: { warehouseId: id, status: 'OPEN' } }),
    ]);

    return {
      totalProducts:    stockStats._count.productId,
      totalUnits:       stockStats._sum.qty ?? new Decimal(0),
      openShifts,
      recentMovements,
    };
  },
};
