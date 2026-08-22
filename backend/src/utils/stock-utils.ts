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

// ─── Overselling: the shortfall ledger ────────────────────────────────────────
//
// When the POS counter sells more than stock covers (allowNegativeStock), the
// uncovered quantity is recorded on Stock.shortfallQty instead of pushing
// Stock.qty negative.
//
// Why not just store a negative qty: Stock.qty is DERIVED. recomputeStockQty
// above sets it to SUM(positive batches), so a negative would be wiped by the
// next recompute from any path — purchase confirm, a return, an adjustment —
// resurrecting units that were already sold and paid for. Keeping qty >= 0 and
// equal to the batch sum also means valuation, stock-take variance, FEFO,
// low-stock alerts and every report keep working untouched.
//
// The debt is a deferred stock-out: it is settled by consuming real batches
// through the ordinary FEFO path as soon as goods arrive, so the movement
// ledger and batch costing see exactly what they would have seen had the sale
// waited for the delivery.

/**
 * Records units sold that stock could not cover.
 *
 * Call INSIDE the checkout transaction, after the available stock has already
 * been deducted, with the quantity still uncovered. Stock.qty is untouched —
 * it is already at 0 (or at the batch sum) by this point.
 */
export async function addShortfall(
  tx: Prisma.TransactionClient,
  productId: string,
  warehouseId: string,
  qty: number,
): Promise<void> {
  if (qty <= 0) return;
  await tx.stock.upsert({
    where:  { productId_warehouseId: { productId, warehouseId } },
    update: { shortfallQty: { increment: qty } },
    create: { productId, warehouseId, qty: 0, shortfallQty: qty },
  });
}

/**
 * Pays down the shortfall out of stock that has just arrived.
 *
 * Call INSIDE the transaction of ANY operation that increases stock — purchase
 * confirm, GRN receipt, adjustment increase, transfer in, import — AFTER the
 * new batch rows exist and Stock.qty reflects them.
 *
 * No-ops when nothing is owed, which is every case while the feature is off, so
 * call sites carry no behavioural change until someone oversells.
 *
 * Expired batches are eligible: the goods were already handed to a customer, so
 * refusing to settle against them would strand the debt forever. The settlement
 * is backdated in meaning, not in time — it records what left the shelf.
 *
 * @returns units actually settled (0 when nothing was owed or nothing arrived)
 */
export async function settleShortfall(
  tx: Prisma.TransactionClient,
  productId: string,
  warehouseId: string,
): Promise<number> {
  const row = await tx.stock.findUnique({
    where:  { productId_warehouseId: { productId, warehouseId } },
    select: { qty: true, shortfallQty: true },
  });

  const owed = Number(row?.shortfallQty ?? 0);
  if (owed <= 0) return 0;

  const onHand = Number(row?.qty ?? 0);
  const settle = Math.min(owed, onHand);
  if (settle <= 0) return 0;   // owed, but nothing arrived yet — stays owed

  // Consume real batches so the batch sum stays the source of truth. Dynamic
  // import breaks a cycle: batch-expiry imports from this module.
  const { deductBatchesFEFO } = await import('./batch-expiry.js');
  const deducted = await deductBatchesFEFO(tx, productId, warehouseId, settle, true);

  if (deducted > 0) {
    await recomputeStockQty(tx, productId, warehouseId);
  } else {
    // Legacy stock with no batch rows behind it: FEFO was a no-op, and a
    // recompute here would wipe the aggregate. Decrement it directly instead,
    // mirroring the legacy fork in the POS and adjustment paths.
    await tx.stock.update({
      where: { productId_warehouseId: { productId, warehouseId } },
      data:  { qty: Math.max(0, onHand - settle) },
    });
  }

  await tx.stock.update({
    where: { productId_warehouseId: { productId, warehouseId } },
    data:  { shortfallQty: { decrement: settle } },
  });

  return settle;
}
