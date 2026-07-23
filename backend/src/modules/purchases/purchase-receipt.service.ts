import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';
import { convertToBaseUnit } from '../../utils/unit-converter.js';
import { computeWAC } from '../../utils/cost.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function generateGRNNumber(): Promise<string> {
  const year   = new Date().getFullYear();
  const prefix = `GRN-${year}-`;
  const count  = await prisma.purchaseReceipt.count({
    where: { receiptNumber: { startsWith: prefix } },
  });
  return `${prefix}${String(count + 1).padStart(4, '0')}`;
}

export interface ReceiptLineInput {
  purchaseLineId: string;
  qty:            number;      // GOOD qty received (enters stock). Same unit as the PO line.
  unitCostCents?: number;      // actual cost per purchase unit at receipt; defaults to the PO line cost — G2
  damagedQty?:    number;      // damaged qty — recorded only, NOT added to stock — G2
  damagedAccepted?:     boolean; // accept damaged (pay for it) vs reject (unpaid, default) — G3
  damagedUnitCostCents?: number; // negotiated cost per damaged unit when accepted — G3
  note?:          string;      // per-line receiving note — G2
  batchNumber?:   string;
  expiryDate?:    string; // ISO date string
}

// ─── createReceipt ────────────────────────────────────────────────────────────
// Called from the API for partial (or full) delivery recordings.
// Adds stock, creates StockMovement, creates StockBatch, updates receivedQty
// and recalculates deliveryStatus.

export async function createReceipt(
  purchaseId: string,
  lines:      ReceiptLineInput[],
  userId:     string,
  notes?:     string,
) {
  // Validate purchase
  const purchase = await (prisma as any).purchase.findFirst({
    where:   { id: purchaseId, deletedAt: null },
    include: { lines: true },
  });
  if (!purchase) throw new HttpError(404, 'Purchase order not found');
  if (purchase.status !== 'CONFIRMED') {
    throw new HttpError(409, 'Can only record a delivery on a CONFIRMED purchase order');
  }
  if (lines.length === 0) throw new HttpError(400, 'At least one line is required');

  // Validate each receipt line against the PO lines
  const lineMap = new Map<string, any>(purchase.lines.map((l: any) => [l.id, l]));
  for (const rl of lines) {
    const poLine = lineMap.get(rl.purchaseLineId);
    if (!poLine) {
      throw new HttpError(400, `Purchase line ${rl.purchaseLineId} not found on this PO`);
    }
    if (rl.qty <= 0) {
      throw new HttpError(400, 'Received qty must be greater than 0');
    }
    const remaining = Number(poLine.qty) - Number(poLine.receivedQty);
    if (rl.qty > remaining + 0.0001) {
      throw new HttpError(
        400,
        `Line for product exceeds remaining qty (ordered ${Number(poLine.qty)}, already received ${Number(poLine.receivedQty)}, trying to receive ${rl.qty})`,
      );
    }
  }

  const receiptNumber = await generateGRNNumber();

  await prisma.$transaction(async (tx) => {
    // 1. Create the GRN header
    const receipt = await tx.purchaseReceipt.create({
      data: {
        receiptNumber,
        purchaseId,
        warehouseId:  purchase.warehouseId,
        receivedById: userId,
        notes:        notes ?? null,
      },
    });

    // CHUNK 23c (v1.0.73): pre-fetch each receipt line's product unit metadata
    // once, so the COUNT-integer guard below can resolve count-ness for EVERY
    // line — including lines with a null unitId (which skip the per-line
    // findUnique in the conversion block). Mirrors confirmPurchase's
    // lineProductMap (chunk 23a). Purely additive: the existing conversion /
    // stock logic and the per-line findUnique are left untouched.
    const receiptProductIds = [
      ...new Set(lines.map((rl) => lineMap.get(rl.purchaseLineId)!.productId)),
    ];
    const receiptProducts = await tx.product.findMany({
      where: { id: { in: receiptProductIds } },
      select: {
        id: true,
        baseUnit: { select: { type: true, allowDecimal: true } },
        unit:     { select: { type: true, allowDecimal: true } },
      },
    });
    const receiptProductMetaMap = new Map(receiptProducts.map((p) => [p.id, p]));

    // 2. Process each receipt line
    for (const rl of lines) {
      const poLine   = lineMap.get(rl.purchaseLineId)!;
      const qtyDec   = new Decimal(rl.qty.toString());

      // Resolve base qty for stock operations
      let baseQty: Decimal;
      if (poLine.unitId) {
        const product = await tx.product.findUnique({
          where:  { id: poLine.productId },
          select: { baseUnitId: true, unitId: true },
        });
        const baseUnitId = product?.baseUnitId ?? product?.unitId ?? '';
        if (poLine.unitId !== baseUnitId) {
          const result = await convertToBaseUnit(
            poLine.productId,
            poLine.unitId,
            qtyDec,
            tx as any,
          );
          baseQty = result.baseQty;
        } else {
          baseQty = qtyDec;
        }
      } else {
        baseQty = qtyDec;
      }

      // CHUNK 23c (v1.0.73): enforce integer for COUNT products on GRN receipt.
      // Receipt lines DO have unit conversion (poLine.unitId can differ from the
      // base unit), so the check fires on POST-conversion baseQty per line.
      // Resolves count-ness from `baseUnit ?? unit` — matches the codebase
      // convention and protects null-baseUnit products (43% of ACM data).
      // Mirrors chunk 23a (confirmPurchase). baseQty is a Prisma Decimal;
      // Number.isInteger(Decimal) is always false, so coerce via .toNumber().
      // The check sits inside the $transaction: an in-tx throw rolls back the
      // just-created GRN header + any prior lines safely (no partial write).
      const receiptLineMeta = receiptProductMetaMap.get(poLine.productId);
      const receiptUnitMeta = receiptLineMeta?.baseUnit ?? receiptLineMeta?.unit;
      if (
        receiptUnitMeta &&
        (receiptUnitMeta.type === 'COUNT' || receiptUnitMeta.allowDecimal === false)
      ) {
        if (!Number.isInteger(baseQty.toNumber())) {
          throw new HttpError(
            400,
            `Quantity for count-only products must be a whole number; got ${baseQty.toNumber()}`,
          );
        }
      }

      // G2: actual cost at receipt (defaults to the PO line cost), and its
      // per-BASE-unit equivalent (stock/batches are held in base units).
      const receiptUnitCost = rl.unitCostCents ?? poLine.unitCostCents;
      const factor          = baseQty.isZero() || qtyDec.isZero()
        ? new Decimal(1)
        : baseQty.div(qtyDec);
      const costPerBaseCents = factor.isZero()
        ? receiptUnitCost
        : Math.round(receiptUnitCost / factor.toNumber());
      const damagedQtyDec    = new Decimal((rl.damagedQty ?? 0).toString());
      // Damaged pricing (G3): accept only makes sense with damaged qty > 0.
      const damagedAccepted  = (rl.damagedAccepted ?? false) && damagedQtyDec.greaterThan(0);
      // Cost per accepted damaged unit — defaults to the good receipt cost.
      const damagedUnitCost  = damagedAccepted
        ? (rl.damagedUnitCostCents ?? receiptUnitCost)
        : null;

      // 2a. Create receipt line document (with actual cost + damaged + note — G2/G3)
      await tx.purchaseReceiptLine.create({
        data: {
          receiptId:     receipt.id,
          purchaseLineId: rl.purchaseLineId,
          productId:     poLine.productId,
          qty:           qtyDec,
          unitCostCents: receiptUnitCost,
          damagedQty:    damagedQtyDec,
          damagedAccepted,
          damagedUnitCostCents: damagedUnitCost,
          note:          rl.note ?? null,
          batchNumber:   rl.batchNumber ?? null,
          expiryDate:    rl.expiryDate ? new Date(rl.expiryDate) : null,
        },
      });

      // G2: weighted-average cost — blend this receipt in using on-hand qty read
      // FRESH (pre-receipt), then update the product's average + last cost.
      const onHandAgg = await tx.stock.aggregate({
        where: { productId: poLine.productId },
        _sum:  { qty: true },
      });
      const existingQty      = Number(onHandAgg._sum.qty ?? 0);
      const curProd          = await tx.product.findUnique({
        where:  { id: poLine.productId },
        select: { costCents: true },
      });
      const newAvgCents      = computeWAC(existingQty, curProd?.costCents ?? 0, baseQty.toNumber(), costPerBaseCents);
      await tx.product.update({
        where: { id: poLine.productId },
        data:  { costCents: newAvgCents, lastCostCents: costPerBaseCents, isActive: true },
      });

      // 2b. Upsert stock (base units) — GOOD qty only; damaged does NOT enter stock.
      await tx.stock.upsert({
        where: {
          productId_warehouseId: {
            productId:   poLine.productId,
            warehouseId: purchase.warehouseId,
          },
        },
        create: { productId: poLine.productId, warehouseId: purchase.warehouseId, qty: baseQty },
        update: { qty: { increment: baseQty } },
      });

      // 2c. Stock movement
      await tx.stockMovement.create({
        data: {
          productId:   poLine.productId,
          warehouseId: purchase.warehouseId,
          type:        'PURCHASE_IN',
          qty:         baseQty,
          refType:     'PurchaseReceipt',
          refId:       receipt.id,
          note:        `GRN ${receiptNumber}`,
        },
      });

      // 2d. Stock batch (FEFO expiry tracking) — stamped with its own cost (G2)
      await (tx as any).stockBatch.create({
        data: {
          productId:      poLine.productId,
          warehouseId:    purchase.warehouseId,
          purchaseLineId: rl.purchaseLineId,
          qty:            baseQty,
          unitCostCents:  costPerBaseCents,
          batchNumber:    rl.batchNumber ?? null,
          expiryDate:     rl.expiryDate ? new Date(rl.expiryDate) : (poLine.expiryDate ?? null),
        },
      });

      // 2e. Update PurchaseLine.receivedQty (good qty received against the order)
      await tx.purchaseLine.update({
        where: { id: rl.purchaseLineId },
        data:  { receivedQty: { increment: qtyDec } },
      });
    }

    // 3. Recalculate deliveryStatus on the Purchase
    const updatedLines = await tx.purchaseLine.findMany({ where: { purchaseId } });
    const allDelivered = updatedLines.every(
      (l: any) => Number(l.receivedQty) >= Number(l.qty) - 0.0001,
    );
    const anyReceived = updatedLines.some((l: any) => Number(l.receivedQty) > 0);
    const newStatus = allDelivered ? 'DELIVERED' : anyReceived ? 'PARTIAL' : 'PENDING';

    await tx.purchase.update({
      where: { id: purchaseId },
      data:  { deliveryStatus: newStatus as any },
    });

    // Supplier payable follows delivered value — recompute after this receipt.
    await recomputeReceivedValue(tx, purchaseId);
  }, { timeout: 60_000 });

  // Return the new receipt with lines
  return getReceiptById(receiptNumber, true);
}

// ─── recomputeReceivedValue ───────────────────────────────────────────────────
// Purchase.receivedValueCents = Σ received value across all GRN receipts, which
// drives the supplier payable:
//   good qty × good cost
//   + (damaged accepted ? damaged qty × damaged cost : 0)   ← reject = unpaid
// Good cost falls back to the PO line cost when a legacy/auto line has cost 0;
// damaged cost falls back to the good cost when accepted without a set price.
export async function recomputeReceivedValue(tx: any, purchaseId: string): Promise<number> {
  const rows = await tx.$queryRawUnsafe(
    `SELECT COALESCE(ROUND(SUM(
        rl."qty" * COALESCE(NULLIF(rl."unitCostCents", 0), pl."unitCostCents")
        + CASE WHEN rl."damagedAccepted"
               THEN rl."damagedQty" * COALESCE(rl."damagedUnitCostCents", NULLIF(rl."unitCostCents", 0), pl."unitCostCents")
               ELSE 0 END
     ))::int, 0) AS v
     FROM "purchase_receipt_lines" rl
     JOIN "purchase_receipts" r  ON rl."receiptId"      = r."id"
     JOIN "PurchaseLine"       pl ON rl."purchaseLineId" = pl."id"
     WHERE r."purchaseId" = $1`,
    purchaseId,
  );
  const v = Number(rows?.[0]?.v ?? 0);
  await tx.purchase.update({ where: { id: purchaseId }, data: { receivedValueCents: v } });
  return v;
}

// ─── createFullReceiptRecord ──────────────────────────────────────────────────
// Called by confirmPurchase AFTER it has already added stock.
// Creates only the GRN document + updates receivedQty + sets DELIVERED.
// Does NOT add stock (stock was already added by confirmPurchase).

export async function createFullReceiptRecord(
  purchaseId: string,
  purchaseLines: any[],
  warehouseId:   string,
  userId:        string,
): Promise<void> {
  try {
    const receiptNumber = await generateGRNNumber();

    await prisma.$transaction(async (tx) => {
      const receipt = await tx.purchaseReceipt.create({
        data: {
          receiptNumber,
          purchaseId,
          warehouseId,
          receivedById: userId,
          notes: 'Auto-created on PO confirmation',
        },
      });

      for (const line of purchaseLines) {
        await tx.purchaseReceiptLine.create({
          data: {
            receiptId:      receipt.id,
            purchaseLineId: line.id,
            productId:      line.productId,
            qty:            new Decimal(line.qty.toString()),
            unitCostCents:  line.unitCostCents ?? 0,   // full delivery = ordered cost
            expiryDate:     (line as any).expiryDate ?? null,
          },
        });

        await tx.purchaseLine.update({
          where: { id: line.id },
          data:  { receivedQty: line.qty },
        });
      }

      await tx.purchase.update({
        where: { id: purchaseId },
        data:  { deliveryStatus: 'DELIVERED' as any },
      });

      // FULL delivery = ordered value; keep the payable in step.
      await recomputeReceivedValue(tx, purchaseId);
    });
  } catch (err) {
    // Non-fatal: don't fail the whole confirm if receipt creation fails
    logger.warn({ err, purchaseId }, 'Failed to create full receipt record after confirmation');
  }
}

// ─── listReceipts ─────────────────────────────────────────────────────────────

export async function listReceipts(purchaseId: string) {
  const purchase = await (prisma as any).purchase.findFirst({
    where: { id: purchaseId, deletedAt: null },
  });
  if (!purchase) throw new HttpError(404, 'Purchase order not found');

  return prisma.purchaseReceipt.findMany({
    where:   { purchaseId },
    orderBy: { createdAt: 'asc' },
    include: {
      receivedBy: { select: { id: true, fullName: true } },
      lines: {
        include: {
          product:     { select: { id: true, name: true, sku: true } },
          purchaseLine: { select: { id: true, qty: true, receivedQty: true } },
        },
      },
    },
  });
}

// ─── getReceiptById ───────────────────────────────────────────────────────────

export async function getReceiptById(receiptIdOrNumber: string, byNumber = false) {
  const where = byNumber
    ? { receiptNumber: receiptIdOrNumber }
    : { id: receiptIdOrNumber };

  const receipt = await prisma.purchaseReceipt.findFirst({
    where,
    include: {
      receivedBy: { select: { id: true, fullName: true } },
      purchase: {
        select: {
          id: true, number: true,
          supplier: { select: { id: true, name: true } },
          warehouse: { select: { id: true, name: true, code: true } },
        },
      },
      lines: {
        include: {
          product:     { select: { id: true, name: true, sku: true } },
          purchaseLine: { select: { id: true, qty: true, receivedQty: true, unitCostCents: true } },
        },
      },
    },
  });
  if (!receipt) throw new HttpError(404, 'Receipt not found');
  return receipt;
}
