import type { Prisma } from '@prisma/client';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';
import { deductBatchesFEFO } from '../../utils/batch-expiry.js';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface CreateProductionOrderInput {
  productId: string;
  warehouseId: string;
  quantity: number;          // planned finished-goods quantity
  notes?: string | null;
  createdById: string;
}

export interface ProductionFilters {
  status?: string;
  productId?: string;
  warehouseId?: string;
  search?: string;
  from?: Date;
  to?: Date;
}

// ─── Includes ─────────────────────────────────────────────────────────────────

const fullInclude = {
  product: { select: { id: true, name: true, sku: true } },
  warehouse: { select: { id: true, name: true, code: true } },
  createdBy: { select: { fullName: true } },
  lines: {
    orderBy: { createdAt: 'asc' as const },
    include: { material: { select: { id: true, name: true, sku: true } } },
  },
} satisfies Prisma.ProductionOrderInclude;

// ─── Helpers ──────────────────────────────────────────────────────────────────

/** PRD-2026-0001 — sequential per year. Falls back to total count if parse fails. */
async function generateOrderNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PRD-${year}-`;
  const last = await prisma.productionOrder.findFirst({
    where: { number: { startsWith: prefix } },
    orderBy: { createdAt: 'desc' },
    select: { number: true },
  });
  let next = 1;
  if (last) {
    const parsed = parseInt(last.number.slice(prefix.length), 10);
    if (Number.isInteger(parsed)) next = parsed + 1;
    else next = (await prisma.productionOrder.count({ where: { number: { startsWith: prefix } } })) + 1;
  }
  return `${prefix}${String(next).padStart(4, '0')}`;
}

// ─── Service ────────────────────────────────────────────────────────────────

export const productionService = {
  getAllOrders: async (filters: ProductionFilters = {}) => {
    try {
      const where: Prisma.ProductionOrderWhereInput = { deletedAt: null };
      if (filters.status) where.status = filters.status;
      if (filters.productId) where.productId = filters.productId;
      if (filters.warehouseId) where.warehouseId = filters.warehouseId;
      if (filters.from || filters.to) {
        where.createdAt = {};
        if (filters.from) where.createdAt.gte = filters.from;
        if (filters.to) where.createdAt.lte = filters.to;
      }
      if (filters.search) {
        where.OR = [
          { number: { contains: filters.search, mode: 'insensitive' } },
          { product: { name: { contains: filters.search, mode: 'insensitive' } } },
        ];
      }
      return await prisma.productionOrder.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        include: {
          product: { select: { id: true, name: true, sku: true } },
          warehouse: { select: { id: true, name: true, code: true } },
          _count: { select: { lines: true } },
        },
      });
    } catch (err) {
      logger.error(err, 'productionService.getAllOrders failed');
      throw err;
    }
  },

  getOrderById: async (id: string) => {
    try {
      const order = await prisma.productionOrder.findFirst({
        where: { id, deletedAt: null },
        include: fullInclude,
      });
      if (!order) throw new HttpError(404, 'Production order not found');
      return order;
    } catch (err) {
      logger.error(err, 'productionService.getOrderById failed');
      throw err;
    }
  },

  /**
   * Create a planned production order. Snapshots the product's BOM into order
   * lines, scaling each material by (quantity / yieldQty). No stock movement —
   * materials are only consumed when the order is started.
   */
  createOrder: async (data: CreateProductionOrderInput) => {
    try {
      if (data.quantity <= 0) throw new HttpError(400, 'Quantity must be greater than zero');

      const product = await prisma.product.findUnique({ where: { id: data.productId } });
      if (!product) throw new HttpError(400, 'Finished product not found');

      const warehouse = await prisma.warehouse.findUnique({ where: { id: data.warehouseId } });
      if (!warehouse) throw new HttpError(400, 'Warehouse not found');

      const bom = await prisma.bOM.findFirst({
        where: { productId: data.productId, deletedAt: null },
        include: { lines: { include: { material: { select: { costCents: true } } } } },
      });
      if (!bom) throw new HttpError(400, 'This product has no BOM — create one first');
      if (bom.lines.length === 0) throw new HttpError(400, 'The BOM has no material lines');

      // Scale each material by how many batch-yields this order represents.
      const scale = data.quantity / Number(bom.yieldQty);
      const lines = bom.lines.map((l) => {
        const plannedQty = Number(l.qty) * scale;
        const unitCostCents = l.material.costCents;
        const lineCostCents = Math.round(unitCostCents * plannedQty);
        return {
          materialId: l.materialId,
          plannedQty,
          actualQty: 0,
          unitCostCents,
          lineCostCents,
        };
      });
      const totalCostCents = lines.reduce((s, l) => s + l.lineCostCents, 0);

      const number = await generateOrderNumber();

      const created = await prisma.productionOrder.create({
        data: {
          number,
          productId: data.productId,
          bomId: bom.id,
          warehouseId: data.warehouseId,
          quantity: data.quantity,
          status: 'PENDING',
          totalCostCents,
          notes: data.notes ?? null,
          createdById: data.createdById,
          lines: { create: lines },
        },
        include: fullInclude,
      });

      logger.info({ orderId: created.id, number }, 'Production order created');
      return created;
    } catch (err) {
      logger.error(err, 'productionService.createOrder failed');
      throw err;
    }
  },

  /**
   * Start production: PENDING → IN_PROGRESS, consuming raw materials from stock.
   * Mirrors the inventory deduction pattern (FEFO batch + aggregate Stock +
   * StockMovement) inside one transaction.
   */
  startOrder: async (id: string) => {
    try {
      return await prisma.$transaction(async (tx) => {
        const order = await tx.productionOrder.findFirst({
          where: { id, deletedAt: null },
          include: { lines: true },
        });
        if (!order) throw new HttpError(404, 'Production order not found');
        if (order.status !== 'PENDING') {
          throw new HttpError(400, `Only pending orders can be started (current: ${order.status})`);
        }

        // Pre-check: ensure every material has sufficient aggregate stock.
        for (const line of order.lines) {
          const required = Number(line.plannedQty);
          const stock = await tx.stock.findUnique({
            where: { productId_warehouseId: { productId: line.materialId, warehouseId: order.warehouseId } },
          });
          const available = Number(stock?.qty ?? 0);
          if (available < required) {
            throw new HttpError(400, 'Insufficient stock for one or more materials');
          }
        }

        // Deduct each material (FEFO batch consumption + aggregate stock + movement).
        for (const line of order.lines) {
          const required = Number(line.plannedQty);
          await deductBatchesFEFO(tx, line.materialId, order.warehouseId, required, false);
          await tx.stock.upsert({
            where: { productId_warehouseId: { productId: line.materialId, warehouseId: order.warehouseId } },
            update: { qty: { decrement: required } },
            create: { productId: line.materialId, warehouseId: order.warehouseId, qty: 0 },
          });
          await tx.stockMovement.create({
            data: {
              productId: line.materialId,
              warehouseId: order.warehouseId,
              type: 'ADJUSTMENT',
              qty: -required,
              refType: 'Production',
              refId: order.id,
              note: `Production order: ${order.number}`,
            },
          });
          // Record consumed quantity on the line.
          await tx.productionOrderLine.update({
            where: { id: line.id },
            data: { actualQty: required },
          });
        }

        const updated = await tx.productionOrder.update({
          where: { id },
          data: { status: 'IN_PROGRESS', startedAt: new Date() },
          include: fullInclude,
        });
        logger.info({ orderId: id, number: order.number }, 'Production order started');
        return updated;
      });
    } catch (err) {
      logger.error(err, 'productionService.startOrder failed');
      throw err;
    }
  },

  /**
   * Complete production: IN_PROGRESS → COMPLETED, adding the finished product
   * into stock. Mirrors the purchase-receipt addition pattern.
   */
  completeOrder: async (id: string) => {
    try {
      return await prisma.$transaction(async (tx) => {
        const order = await tx.productionOrder.findFirst({
          where: { id, deletedAt: null },
        });
        if (!order) throw new HttpError(404, 'Production order not found');
        if (order.status !== 'IN_PROGRESS') {
          throw new HttpError(400, `Only in-progress orders can be completed (current: ${order.status})`);
        }

        const produced = Number(order.quantity);

        await tx.stock.upsert({
          where: { productId_warehouseId: { productId: order.productId, warehouseId: order.warehouseId } },
          update: { qty: { increment: produced } },
          create: { productId: order.productId, warehouseId: order.warehouseId, qty: produced },
        });
        await tx.stockMovement.create({
          data: {
            productId: order.productId,
            warehouseId: order.warehouseId,
            type: 'ADJUSTMENT',
            qty: produced,
            refType: 'Production',
            refId: order.id,
            note: `Production order completed: ${order.number}`,
          },
        });

        const updated = await tx.productionOrder.update({
          where: { id },
          data: { status: 'COMPLETED', completedAt: new Date() },
          include: fullInclude,
        });
        logger.info({ orderId: id, number: order.number }, 'Production order completed');
        return updated;
      });
    } catch (err) {
      logger.error(err, 'productionService.completeOrder failed');
      throw err;
    }
  },

  /**
   * Cancel an order. A PENDING order is simply marked cancelled. An IN_PROGRESS
   * order restores its consumed materials back into stock via a positive
   * ADJUSTMENT (stock addition — never a reversal of the original movement).
   * COMPLETED orders cannot be cancelled.
   */
  cancelOrder: async (id: string) => {
    try {
      return await prisma.$transaction(async (tx) => {
        const order = await tx.productionOrder.findFirst({
          where: { id, deletedAt: null },
          include: { lines: true },
        });
        if (!order) throw new HttpError(404, 'Production order not found');
        if (order.status === 'COMPLETED') {
          throw new HttpError(400, 'Completed orders cannot be cancelled');
        }
        if (order.status === 'CANCELLED') {
          throw new HttpError(400, 'Order is already cancelled');
        }

        // Restore consumed materials (stock ADDITION) only if production started.
        if (order.status === 'IN_PROGRESS') {
          for (const line of order.lines) {
            const restore = Number(line.actualQty);
            if (restore <= 0) continue;
            await tx.stock.upsert({
              where: { productId_warehouseId: { productId: line.materialId, warehouseId: order.warehouseId } },
              update: { qty: { increment: restore } },
              create: { productId: line.materialId, warehouseId: order.warehouseId, qty: restore },
            });
            await tx.stockMovement.create({
              data: {
                productId: line.materialId,
                warehouseId: order.warehouseId,
                type: 'ADJUSTMENT',
                qty: restore,
                refType: 'Production',
                refId: order.id,
                note: `Production order cancelled: ${order.number}`,
              },
            });
          }
        }

        const updated = await tx.productionOrder.update({
          where: { id },
          data: { status: 'CANCELLED' },
          include: fullInclude,
        });
        logger.info({ orderId: id, number: order.number }, 'Production order cancelled');
        return updated;
      });
    } catch (err) {
      logger.error(err, 'productionService.cancelOrder failed');
      throw err;
    }
  },

  getProductionStats: async () => {
    try {
      const [grouped, completedAgg] = await Promise.all([
        prisma.productionOrder.groupBy({
          by: ['status'],
          where: { deletedAt: null },
          _count: { _all: true },
        }),
        prisma.productionOrder.aggregate({
          where: { deletedAt: null, status: 'COMPLETED' },
          _sum: { totalCostCents: true },
        }),
      ]);

      const byStatus: Record<string, number> = {
        PENDING: 0,
        IN_PROGRESS: 0,
        COMPLETED: 0,
        CANCELLED: 0,
      };
      let totalOrders = 0;
      for (const g of grouped) {
        byStatus[g.status] = g._count._all;
        totalOrders += g._count._all;
      }

      return {
        totalOrders,
        pending: byStatus.PENDING,
        inProgress: byStatus.IN_PROGRESS,
        completed: byStatus.COMPLETED,
        cancelled: byStatus.CANCELLED,
        completedCostCents: completedAgg._sum.totalCostCents ?? 0,
      };
    } catch (err) {
      logger.error(err, 'productionService.getProductionStats failed');
      throw err;
    }
  },
};
