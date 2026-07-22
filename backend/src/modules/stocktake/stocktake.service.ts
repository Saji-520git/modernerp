import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';
import { inventoryService } from '../inventory/inventory.service.js';
import type { CreateStockTakeInput, SaveCountsInput } from './stocktake.schema.js';

async function generateStockTakeNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `ST-${year}-`;
  const count = await prisma.stockTake.count({ where: { number: { startsWith: prefix } } });
  return `${prefix}${String(count + 1).padStart(4, '0')}`;
}

const LINE_INCLUDE = {
  product: {
    select: {
      id: true, name: true, sku: true,
      unit:     { select: { shortCode: true } },
      baseUnit: { select: { shortCode: true } },
    },
  },
} as const;

export const stockTakeService = {
  list: () =>
    prisma.stockTake.findMany({
      orderBy: { createdAt: 'desc' },
      include: {
        warehouse: { select: { id: true, name: true, code: true } },
        _count:    { select: { lines: true } },
      },
    }),

  getById: async (id: string) => {
    const st = await prisma.stockTake.findUnique({
      where: { id },
      include: {
        warehouse: { select: { id: true, name: true, code: true } },
        lines:     { include: LINE_INCLUDE, orderBy: { product: { name: 'asc' } } },
      },
    });
    if (!st) throw new HttpError(404, 'Stock-take not found');
    return st;
  },

  /** Open a counting session: snapshot current warehouse stock into count lines. */
  create: async (input: CreateStockTakeInput, userId: string) => {
    const wh = await prisma.warehouse.findFirst({ where: { id: input.warehouseId, isActive: true }, select: { id: true } });
    if (!wh) throw new HttpError(404, 'Warehouse not found');

    const stockRows = await prisma.stock.findMany({
      where: {
        warehouseId: input.warehouseId,
        product: { isActive: true, ...(input.categoryId ? { categoryId: input.categoryId } : {}) },
      },
      select: { productId: true, qty: true, product: { select: { costCents: true } } },
    });
    if (stockRows.length === 0) throw new HttpError(400, 'No products to count for this warehouse/category');

    const number = await generateStockTakeNumber();
    const created = await prisma.stockTake.create({
      data: {
        number,
        warehouseId: input.warehouseId,
        note:        input.note ?? null,
        createdById: userId,
        status:      'DRAFT',
        lines: {
          create: stockRows.map((r) => ({
            productId:     r.productId,
            systemQty:     r.qty,
            unitCostCents: r.product.costCents,
          })),
        },
      },
      select: { id: true },
    });
    logger.info({ id: created.id, number, lines: stockRows.length }, 'Stock-take created');
    return stockTakeService.getById(created.id);
  },

  /** Save entered counts on a draft (no stock changes yet). */
  saveCounts: async (id: string, input: SaveCountsInput) => {
    const st = await prisma.stockTake.findUnique({ where: { id }, select: { status: true } });
    if (!st) throw new HttpError(404, 'Stock-take not found');
    if (st.status !== 'DRAFT') throw new HttpError(400, 'Only a draft stock-take can be edited');

    await prisma.$transaction(
      input.lines.map((l) =>
        prisma.stockTakeLine.updateMany({
          where: { id: l.lineId, stockTakeId: id }, // scope to this take (security)
          data:  { countedQty: l.countedQty, note: l.note ?? null },
        }),
      ),
    );
    return stockTakeService.getById(id);
  },

  /**
   * Finalise: for each counted line, reconcile system stock to the counted qty by
   * posting an adjustment (reuses inventory.createAdjustment — same stock/batch/P&L
   * path). Variance is (counted − FRESH system qty) so stock == counted afterwards,
   * even if stock moved during counting. Re-confirm is safe: applied lines now have
   * zero variance and are skipped.
   */
  confirm: async (id: string, userId: string) => {
    const st = await prisma.stockTake.findUnique({ where: { id }, include: { lines: true } });
    if (!st) throw new HttpError(404, 'Stock-take not found');
    if (st.status !== 'DRAFT') throw new HttpError(400, 'Stock-take is already finalised');

    let adjusted = 0;
    for (const line of st.lines) {
      if (line.countedQty === null) continue; // uncounted → leave stock untouched

      const cur = await prisma.stock.findUnique({
        where:  { productId_warehouseId: { productId: line.productId, warehouseId: st.warehouseId } },
        select: { qty: true },
      });
      const fresh = cur ? Number(cur.qty) : 0;
      const variance = Number(line.countedQty) - fresh;

      if (variance !== 0) {
        await inventoryService.createAdjustment(
          { productId: line.productId, warehouseId: st.warehouseId, qty: variance, reason: `Stock-take ${st.number}` },
          userId,
        );
        adjusted++;
      }
      await prisma.stockTakeLine.update({
        where: { id: line.id },
        data:  { appliedQty: variance, systemQty: fresh },
      });
    }

    await prisma.stockTake.update({
      where: { id },
      data:  { status: 'COMPLETED', completedById: userId, completedAt: new Date() },
    });
    logger.info({ id, number: st.number, adjusted }, 'Stock-take confirmed');
    return stockTakeService.getById(id);
  },

  cancel: async (id: string) => {
    const st = await prisma.stockTake.findUnique({ where: { id }, select: { status: true } });
    if (!st) throw new HttpError(404, 'Stock-take not found');
    if (st.status !== 'DRAFT') throw new HttpError(400, 'Only a draft stock-take can be cancelled');
    await prisma.stockTake.update({ where: { id }, data: { status: 'CANCELLED' } });
    return { success: true };
  },
};
