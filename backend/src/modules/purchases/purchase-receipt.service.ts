import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';
import { convertToBaseUnit } from '../../utils/unit-converter.js';
import { computeWAC } from '../../utils/cost.js';
import { findOrCreateBatch } from '../../utils/batch-matching.js';
import { recordStockMovement } from '../../utils/stock-movement.js';

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
  sellingPriceCents?: number;  // selling price for this batch; defaults to the product's current price
  damagedQty?:    number;      // damaged qty — recorded only, NOT added to stock — G2
  damagedAccepted?:     boolean; // accept damaged (pay for it) vs reject (unpaid, default) — G3
  damagedUnitCostCents?: number; // negotiated cost per damaged unit when accepted — G3
  damagedSellingPriceCents?: number; // price the accepted damaged batch sells at
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
  if (purchase.deliveryStatus === 'CLOSED_SHORT') {
    throw new HttpError(409, 'This purchase order was closed short — no further deliveries can be recorded against it');
  }
  if (lines.length === 0) throw new HttpError(400, 'At least one line is required');

  // Structural validation only — the receiving-allowance check needs to read
  // committed receipt rows, so it runs inside the transaction below.
  const lineMap = new Map<string, any>(purchase.lines.map((l: any) => [l.id, l]));
  for (const rl of lines) {
    const poLine = lineMap.get(rl.purchaseLineId);
    if (!poLine) {
      throw new HttpError(400, `Purchase line ${rl.purchaseLineId} not found on this PO`);
    }
    if (rl.qty <= 0) {
      throw new HttpError(400, 'Received qty must be greater than 0');
    }
  }

  const receiptNumber = await generateGRNNumber();

  await prisma.$transaction(async (tx) => {
    // 0. Receiving allowance — how much of each ordered line may still be received.
    //
    // Derived from what has actually been logged on receipt lines, NOT from
    // PurchaseLine.receivedQty. That counter deliberately tracks the GOOD qty
    // only (damaged units don't fulfil the order), so using it as the allowance
    // meant every damaged unit handed its allowance straight back and the same
    // remainder could be spent without limit — a PO for 2 accepted 5.
    //
    // Quantities are totalled per purchase line first, so submitting the same
    // line twice in one receipt can't slip two half-checks through. The whole
    // check runs inside the transaction so two concurrent receipts can't both
    // read a stale total and both pass.
    const requestedByLine = new Map<string, number>();
    for (const rl of lines) {
      requestedByLine.set(
        rl.purchaseLineId,
        (requestedByLine.get(rl.purchaseLineId) ?? 0) + rl.qty,
      );
    }
    for (const [purchaseLineId, requestedQty] of requestedByLine) {
      const poLine = lineMap.get(purchaseLineId)!;
      const logged = await tx.purchaseReceiptLine.aggregate({
        where: { purchaseLineId },
        _sum:  { qty: true },
      });
      const alreadyLogged = Number(logged._sum.qty ?? 0);
      const remaining     = Number(poLine.qty) - alreadyLogged;
      if (requestedQty > remaining + 0.0001) {
        const product = await tx.product.findUnique({
          where:  { id: poLine.productId },
          select: { name: true },
        });
        throw new HttpError(
          400,
          `"${product?.name ?? 'Line'}" exceeds the ordered quantity — ordered ${Number(poLine.qty)}, already received ${alreadyLogged}, trying to receive ${requestedQty}.`,
        );
      }
    }

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
        priceCents: true,
        baseUnit: { select: { type: true, allowDecimal: true } },
        unit:     { select: { type: true, allowDecimal: true } },
      },
    });
    const receiptProductMetaMap = new Map(receiptProducts.map((p) => [p.id, p]));

    // 2. Process each receipt line
    for (const rl of lines) {
      const poLine   = lineMap.get(rl.purchaseLineId)!;
      // Option B: `qty` is the TOTAL received; damaged is a subset of it; the
      // GOOD qty (total − damaged) is what enters stock and is charged at the
      // good unit cost. Accepted damaged is charged separately (see payable calc).
      const qtyDec        = new Decimal(rl.qty.toString());
      const damagedQtyDec = new Decimal((rl.damagedQty ?? 0).toString());
      if (damagedQtyDec.greaterThan(qtyDec)) {
        throw new HttpError(
          400,
          `Damaged qty (${damagedQtyDec.toNumber()}) cannot exceed received qty (${qtyDec.toNumber()})`,
        );
      }
      const goodQtyDec = qtyDec.minus(damagedQtyDec);

      // Resolve the TOTAL received in base units → gives the purchase→base factor
      // (qtyDec > 0 always), from which the GOOD base qty is derived for stock.
      let baseTotal: Decimal;
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
          baseTotal = result.baseQty;
        } else {
          baseTotal = qtyDec;
        }
      } else {
        baseTotal = qtyDec;
      }
      // base-per-purchase-unit factor, then the GOOD qty in base units (enters stock).
      const factor   = qtyDec.isZero() ? new Decimal(1) : baseTotal.div(qtyDec);
      const baseGood = goodQtyDec.mul(factor);

      // CHUNK 23c (v1.0.73): enforce integer for COUNT products on GRN receipt.
      // Checked on the GOOD base qty — what actually enters stock. An in-tx throw
      // rolls back the just-created GRN header + any prior lines (no partial write).
      const receiptLineMeta = receiptProductMetaMap.get(poLine.productId);
      const receiptUnitMeta = receiptLineMeta?.baseUnit ?? receiptLineMeta?.unit;
      if (
        receiptUnitMeta &&
        (receiptUnitMeta.type === 'COUNT' || receiptUnitMeta.allowDecimal === false)
      ) {
        if (!Number.isInteger(baseGood.toNumber())) {
          throw new HttpError(
            400,
            `Quantity for count-only products must be a whole number; got ${baseGood.toNumber()}`,
          );
        }
      }

      // G2: actual cost at receipt (defaults to the PO line cost), and its
      // per-BASE-unit equivalent (stock/batches are held in base units).
      const receiptUnitCost = rl.unitCostCents ?? poLine.unitCostCents;
      const costPerBaseCents = factor.isZero()
        ? receiptUnitCost
        : Math.round(receiptUnitCost / factor.toNumber());
      // Selling price at receipt (defaults to the product's current price),
      // converted to its per-BASE-unit equivalent the same way cost is —
      // this batch's own price, shown/used when THIS batch is sold.
      const receiptSellPrice = rl.sellingPriceCents ?? receiptLineMeta?.priceCents ?? 0;
      const sellPricePerBaseCents = factor.isZero()
        ? receiptSellPrice
        : Math.round(receiptSellPrice / factor.toNumber());
      // Damaged pricing (G3): accept only makes sense with damaged qty > 0.
      const damagedAccepted  = (rl.damagedAccepted ?? false) && damagedQtyDec.greaterThan(0);
      // Cost per accepted damaged unit — defaults to the good receipt cost.
      const damagedUnitCost  = damagedAccepted
        ? (rl.damagedUnitCostCents ?? receiptUnitCost)
        : null;
      // Price the accepted damaged batch is sold at — defaults to the good
      // selling price when the receiver hasn't set a reduced one.
      const damagedSellPrice = damagedAccepted
        ? (rl.damagedSellingPriceCents ?? receiptSellPrice)
        : null;

      // Accepted damaged goods are kept and PAID for, so they belong in stock —
      // as their own batch, at the negotiated cost and their own lower selling
      // price, so they can be sold at a discount. Rejected damaged is not paid
      // for and never enters stock.
      const baseDamagedAccepted = damagedAccepted
        ? damagedQtyDec.mul(factor)
        : new Decimal(0);
      const damagedCostPerBaseCents = damagedUnitCost == null ? 0
        : (factor.isZero() ? damagedUnitCost  : Math.round(damagedUnitCost  / factor.toNumber()));
      const damagedSellPerBaseCents = damagedSellPrice == null ? 0
        : (factor.isZero() ? damagedSellPrice : Math.round(damagedSellPrice / factor.toNumber()));
      // Everything from this line that actually enters stock.
      const baseReceived = baseGood.plus(baseDamagedAccepted);

      // 2a. Create receipt line document (with actual cost + damaged + note — G2/G3)
      await tx.purchaseReceiptLine.create({
        data: {
          receiptId:     receipt.id,
          purchaseLineId: rl.purchaseLineId,
          productId:     poLine.productId,
          qty:           qtyDec,
          unitCostCents: receiptUnitCost,
          sellingPriceCents: receiptSellPrice,
          damagedQty:    damagedQtyDec,
          damagedAccepted,
          damagedUnitCostCents: damagedUnitCost,
          damagedSellingPriceCents: damagedSellPrice,
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
      // Good and accepted-damaged arrived at different costs, so they are blended
      // in separately. Damaged is normally much cheaper and must pull the average
      // down — ignoring it would leave the product's cost reading too high.
      let avgCents   = curProd?.costCents ?? 0;
      let runningQty = existingQty;
      if (baseGood.greaterThan(0)) {
        avgCents   = computeWAC(runningQty, avgCents, baseGood.toNumber(), costPerBaseCents);
        runningQty += baseGood.toNumber();
      }
      if (baseDamagedAccepted.greaterThan(0)) {
        avgCents   = computeWAC(runningQty, avgCents, baseDamagedAccepted.toNumber(), damagedCostPerBaseCents);
        runningQty += baseDamagedAccepted.toNumber();
      }
      await tx.product.update({
        where: { id: poLine.productId },
        data:  {
          costCents: avgCents,
          // lastCost tracks the latest GOOD purchase cost — a receipt that was
          // entirely damaged shouldn't overwrite it with a distressed price.
          ...(baseGood.greaterThan(0) ? { lastCostCents: costPerBaseCents } : {}),
          isActive: true,
        },
      });

      // 2b. Upsert stock (base units) — good PLUS accepted damaged. Rejected
      // damaged is not paid for and never enters stock.
      if (baseReceived.greaterThan(0)) {
        await tx.stock.upsert({
          where: {
            productId_warehouseId: {
              productId:   poLine.productId,
              warehouseId: purchase.warehouseId,
            },
          },
          create: { productId: poLine.productId, warehouseId: purchase.warehouseId, qty: baseReceived },
          update: { qty: { increment: baseReceived } },
        });
      }

      // 2c. Stock movements — good and accepted-damaged are logged separately so
      // the ledger shows what arrived under each cost. Nothing is logged when a
      // quantity is zero: a movement that moved nothing is noise.
      if (baseGood.greaterThan(0)) {
        await recordStockMovement(tx, {
          productId:   poLine.productId,
          warehouseId: purchase.warehouseId,
          type:        'PURCHASE_IN',
          qty:         baseGood,
          refType:     'PurchaseReceipt',
          refId:       receipt.id,
          note:        `GRN ${receiptNumber}`,
        });
      }
      if (baseDamagedAccepted.greaterThan(0)) {
        await recordStockMovement(tx, {
          productId:   poLine.productId,
          warehouseId: purchase.warehouseId,
          type:        'PURCHASE_IN',
          qty:         baseDamagedAccepted,
          refType:     'PurchaseReceipt',
          refId:       receipt.id,
          note:        `GRN ${receiptNumber} — damaged accepted`,
        });
      }

      // 2d. Stock batches (FEFO expiry tracking) — stamped with their own cost,
      // selling price, and supplier. Merges into an existing open batch when
      // those already match; otherwise starts a new one. Damaged is always its
      // own batch: isDamaged is part of the matching key.
      if (baseGood.greaterThan(0)) {
        await findOrCreateBatch(tx, {
          productId:         poLine.productId,
          warehouseId:       purchase.warehouseId,
          purchaseLineId:    rl.purchaseLineId,
          qty:               baseGood,
          unitCostCents:     costPerBaseCents,
          sellingPriceCents: sellPricePerBaseCents,
          supplierId:        purchase.supplierId,
          isDamaged:         false,
          batchNumber:       rl.batchNumber ?? null,
          expiryDate:        rl.expiryDate ? new Date(rl.expiryDate) : (poLine.expiryDate ?? null),
        });
      }
      if (baseDamagedAccepted.greaterThan(0)) {
        await findOrCreateBatch(tx, {
          productId:         poLine.productId,
          warehouseId:       purchase.warehouseId,
          purchaseLineId:    rl.purchaseLineId,
          qty:               baseDamagedAccepted,
          unitCostCents:     damagedCostPerBaseCents,
          sellingPriceCents: damagedSellPerBaseCents,
          supplierId:        purchase.supplierId,
          isDamaged:         true,
          batchNumber:       rl.batchNumber ?? null,
          expiryDate:        rl.expiryDate ? new Date(rl.expiryDate) : (poLine.expiryDate ?? null),
        });
      }

      // 2e. Update PurchaseLine.receivedQty (GOOD qty received against the order —
      // damaged units don't fulfil the order, so only good counts toward delivery).
      await tx.purchaseLine.update({
        where: { id: rl.purchaseLineId },
        data:  { receivedQty: { increment: goodQtyDec } },
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
        (rl."qty" - rl."damagedQty") * COALESCE(NULLIF(rl."unitCostCents", 0), pl."unitCostCents")
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
