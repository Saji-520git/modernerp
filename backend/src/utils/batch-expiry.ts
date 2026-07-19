import type { Prisma } from '@prisma/client';
import { prisma } from '../config/prisma.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export type ExpiryStatus = 'none' | 'ok' | 'expiring' | 'has_expired_batch';

export interface BatchSummary {
  sellableQty:      number;   // qty with no expiry OR expiry > today
  expiredQty:       number;   // qty with expiry <= today
  expiringSoonQty:  number;   // subset of sellable: expiring within 30 days
  nearestExpiry:    Date | null; // min(expiryDate) among non-expired batches
  expiryStatus:     ExpiryStatus;
}

// ─── Helper ───────────────────────────────────────────────────────────────────

export async function getBatchSummary(
  productId: string,
  warehouseId: string,
): Promise<BatchSummary> {
  const batches = await (prisma as any).stockBatch.findMany({
    where: { productId, warehouseId, qty: { gt: 0 } },
    select: { qty: true, expiryDate: true },
  }) as Array<{ qty: { toNumber: () => number }; expiryDate: Date | null }>;

  if (batches.length === 0) {
    // No batch rows — product was stocked before batch tracking was introduced.
    // Fall back to the stock table so POS shows the real qty instead of OUT.
    const stockRow = await prisma.stock.findUnique({
      where: { productId_warehouseId: { productId, warehouseId } },
      select: { qty: true },
    });
    const qty = stockRow ? Number(stockRow.qty) : 0;
    return { sellableQty: qty, expiredQty: 0, expiringSoonQty: 0, nearestExpiry: null, expiryStatus: 'none' };
  }

  const today          = new Date();
  const soonThreshold  = new Date(today);
  soonThreshold.setDate(soonThreshold.getDate() + 30);

  let sellableQty     = 0;
  let expiredQty      = 0;
  let expiringSoonQty = 0;
  let nearestExpiry: Date | null = null;
  let hasExpiry       = false;

  for (const b of batches) {
    const qty = b.qty.toNumber();
    if (b.expiryDate === null) {
      sellableQty += qty;
    } else {
      hasExpiry = true;
      if (b.expiryDate <= today) {
        expiredQty += qty;
      } else {
        sellableQty += qty;
        if (!nearestExpiry || b.expiryDate < nearestExpiry) nearestExpiry = b.expiryDate;
        if (b.expiryDate <= soonThreshold) expiringSoonQty += qty;
      }
    }
  }

  let expiryStatus: ExpiryStatus;
  if (!hasExpiry) {
    expiryStatus = 'none';
  } else if (expiredQty > 0) {
    expiryStatus = 'has_expired_batch';
  } else if (expiringSoonQty > 0) {
    expiryStatus = 'expiring';
  } else {
    expiryStatus = 'ok';
  }

  return { sellableQty, expiredQty, expiringSoonQty, nearestExpiry, expiryStatus };
}

// ─── Batch list for a product+warehouse (detail view) ────────────────────────

export interface BatchDetail {
  id:            string;
  qty:           number;
  unitCostCents: number;         // this batch's own cost, per base unit — cost visibility
  batchNumber:   string | null;
  expiryDate:    Date | null;
  receivedAt:    Date;
  status:        'expired' | 'expiring_soon' | 'ok' | 'no_expiry';
}

export async function getBatchDetail(
  productId: string,
  warehouseId: string,
): Promise<BatchDetail[]> {
  const batches = await (prisma as any).stockBatch.findMany({
    where: { productId, warehouseId, qty: { gt: 0 } },
    orderBy: [{ expiryDate: 'asc' }, { receivedAt: 'asc' }],
    select: { id: true, qty: true, unitCostCents: true, batchNumber: true, expiryDate: true, receivedAt: true },
  }) as Array<{ id: string; qty: { toNumber: () => number }; unitCostCents: number; batchNumber: string | null; expiryDate: Date | null; receivedAt: Date }>;

  const today         = new Date();
  const soonThreshold = new Date(today);
  soonThreshold.setDate(soonThreshold.getDate() + 30);

  return batches.map((b) => {
    let status: BatchDetail['status'] = 'no_expiry';
    if (b.expiryDate) {
      if (b.expiryDate <= today)          status = 'expired';
      else if (b.expiryDate <= soonThreshold) status = 'expiring_soon';
      else                                status = 'ok';
    }
    return { id: b.id, qty: b.qty.toNumber(), unitCostCents: b.unitCostCents, batchNumber: b.batchNumber, expiryDate: b.expiryDate, receivedAt: b.receivedAt, status };
  });
}

// ─── FEFO batch deduction (within a Prisma transaction) ──────────────────────
//
// Deducts `qty` units from StockBatch rows in First-Expired-First-Out order.
// Batches with no expiry date are consumed last (after all dated batches).
// Only touches batches whose expiry is null or in the future (skips expired).
// If no batch rows exist for this product+warehouse the function is a no-op
// (the product was stocked before batch tracking — Stock table is sole source).
//
// Returns the number of base units actually deducted from batches (may be less
// than `qty` when batches are missing; caller should fall back to Stock table).

export async function deductBatchesFEFO(
  tx: Prisma.TransactionClient,
  productId:    string,
  warehouseId:  string,
  qty:          number,
  includeExpired = false,   // true = WARN/ALLOW policy; false = BLOCK (default)
): Promise<number> {
  const where = includeExpired
    ? { productId, warehouseId, qty: { gt: 0 } }
    : {
        productId,
        warehouseId,
        qty: { gt: 0 },
        OR: [
          { expiryDate: null },
          { expiryDate: { gt: new Date() } },
        ],
      };

  const batches = await (tx as any).stockBatch.findMany({
    where,
    select: { id: true, qty: true, expiryDate: true },
  }) as Array<{ id: string; qty: { toNumber: () => number }; expiryDate: Date | null }>;

  if (batches.length === 0) return 0;   // no batch tracking → caller handles stock table

  // Sort: earliest expiry first, nulls (no expiry) last
  batches.sort((a, b) => {
    if (a.expiryDate === null && b.expiryDate === null) return 0;
    if (a.expiryDate === null) return 1;
    if (b.expiryDate === null) return -1;
    return a.expiryDate.getTime() - b.expiryDate.getTime();
  });

  let remaining = qty;
  for (const batch of batches) {
    if (remaining <= 0) break;
    const batchQty = batch.qty.toNumber();
    const deduct   = Math.min(batchQty, remaining);
    await (tx as any).stockBatch.update({
      where: { id: batch.id },
      data:  { qty: { decrement: deduct } },
    });
    remaining -= deduct;
  }

  return qty - remaining;   // units actually deducted
}
