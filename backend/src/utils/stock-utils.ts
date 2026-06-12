import type { Prisma } from '@prisma/client';
import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../config/prisma.js';

// ─── Stock quantity reconciliation ────────────────────────────────────────────
//
// Stock.qty (aggregate, one row per product+warehouse) and the sum of positive
// StockBatch rows can drift apart over time. The batch rows are the physical
// source of truth for any product that is batch-tracked. These helpers keep the
// aggregate Stock.qty in lock-step with the batch sum and can never produce a
// negative aggregate.

/**
 * Recomputes Stock.qty from the actual sum of positive StockBatch rows.
 * Call this INSIDE a transaction, AFTER any operation that has already
 * modified the StockBatch rows (purchase confirm, write-off, FEFO sale).
 *
 * The batch sum is the single source of truth and cannot go negative, so the
 * resulting Stock.qty is always >= 0.
 *
 * ⚠️ Only safe for batch-tracked flows. For products with NO batch rows
 *    (pre-batch-tracking stock) the batch sum is 0 — callers in that situation
 *    must NOT use this helper, or they will zero out legitimate stock.
 */
export async function recomputeStockQty(
  tx: Prisma.TransactionClient,
  productId: string,
  warehouseId: string,
): Promise<void> {
  const batchSum = await tx.stockBatch.aggregate({
    where: { productId, warehouseId, qty: { gt: 0 } },
    _sum:  { qty: true },
  });

  // Stock.qty is Decimal(18,4) — convert with Number() for the write.
  const correctQty = Number(batchSum._sum.qty ?? 0);

  await tx.stock.upsert({
    where:  { productId_warehouseId: { productId, warehouseId } },
    update: { qty: correctQty },
    create: { productId, warehouseId, qty: correctQty },
  });
}

/**
 * Repairs every negative Stock.qty record by recomputing it from the positive
 * StockBatch sum (floored at 0). One-shot maintenance routine — intended to be
 * called once after deploying the drift fix to clean historical bad data.
 */
export async function repairNegativeStockQty(): Promise<{
  repaired: number;
  details: Array<{
    productId:   string;
    warehouseId: string;
    oldQty:      number;
    newQty:      number;
  }>;
}> {
  const negativeStocks = await prisma.stock.findMany({
    where:  { qty: { lt: new Decimal(0) } },
    select: { productId: true, warehouseId: true, qty: true },
  });

  const details: Array<{
    productId:   string;
    warehouseId: string;
    oldQty:      number;
    newQty:      number;
  }> = [];

  for (const stock of negativeStocks) {
    const batchSum = await prisma.stockBatch.aggregate({
      where: { productId: stock.productId, warehouseId: stock.warehouseId, qty: { gt: 0 } },
      _sum:  { qty: true },
    });

    const correctQty = Math.max(0, Number(batchSum._sum.qty ?? 0));

    await prisma.stock.update({
      where: {
        productId_warehouseId: {
          productId:   stock.productId,
          warehouseId: stock.warehouseId,
        },
      },
      data: { qty: correctQty },
    });

    details.push({
      productId:   stock.productId,
      warehouseId: stock.warehouseId,
      oldQty:      Number(stock.qty),
      newQty:      correctQty,
    });
  }

  return { repaired: details.length, details };
}
