import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';
import { convertToBaseUnit } from '../../utils/unit-converter.js';

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
  qty:            number;
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

      // 2a. Create receipt line document
      await tx.purchaseReceiptLine.create({
        data: {
          receiptId:     receipt.id,
          purchaseLineId: rl.purchaseLineId,
          productId:     poLine.productId,
          qty:           qtyDec,
          batchNumber:   rl.batchNumber ?? null,
          expiryDate:    rl.expiryDate ? new Date(rl.expiryDate) : null,
        },
      });

      // 2b. Upsert stock (base units)
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

      // 2d. Stock batch (for FEFO expiry tracking)
      await (tx as any).stockBatch.create({
        data: {
          productId:      poLine.productId,
          warehouseId:    purchase.warehouseId,
          purchaseLineId: rl.purchaseLineId,
          qty:            baseQty,
          batchNumber:    rl.batchNumber ?? null,
          expiryDate:     rl.expiryDate ? new Date(rl.expiryDate) : (poLine.expiryDate ?? null),
        },
      });

      // 2e. Update PurchaseLine.receivedQty
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
  }, { timeout: 60_000 });

  // Return the new receipt with lines
  return getReceiptById(receiptNumber, true);
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
