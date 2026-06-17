import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../middleware/error-handler.js';
import { convertToBaseUnit } from '../../utils/unit-converter.js';
import { recomputeStockQty } from '../../utils/stock-utils.js';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreateReturnLineInput {
  purchaseLineId: string;
  qty:            number;
}

export interface CreateReturnInput {
  purchaseId: string;
  reason?:    string;
  lines:      CreateReturnLineInput[];
  createdBy:  string;
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function nextReturnNumber(): Promise<string> {
  const year   = new Date().getFullYear();
  const prefix = `PRET-${year}-`;
  const last   = await (prisma as any).purchaseReturn.findFirst({
    where:   { number: { startsWith: prefix } },
    orderBy: { number: 'desc' },
    select:  { number: true },
  });
  const seq = last ? parseInt(last.number.slice(prefix.length), 10) + 1 : 1;
  return `${prefix}${String(seq).padStart(4, '0')}`;
}

const RETURN_INCLUDE = {
  purchase:  { select: { id: true, number: true } },
  supplier:  { select: { id: true, name: true } },
  warehouse: { select: { id: true, name: true, code: true } },
  createdBy: { select: { id: true, fullName: true } },
  lines: {
    include: {
      product:      { select: { id: true, name: true, sku: true } },
      purchaseLine: { select: { id: true, qty: true, receivedQty: true, returnedQty: true } },
    },
  },
} as const;

// ─── Service ──────────────────────────────────────────────────────────────────

export const purchaseReturnService = {

  // ── Create draft return ─────────────────────────────────────────────────────

  async createReturn(input: CreateReturnInput) {
    const { purchaseId, reason, lines, createdBy } = input;

    if (!lines || lines.length === 0) throw new HttpError(400, 'At least one line is required');

    const purchase = await (prisma as any).purchase.findUnique({
      where:   { id: purchaseId },
      include: {
        lines: true,
        supplier: true,
      },
    });
    if (!purchase)                         throw new HttpError(404, 'Purchase not found');
    if (purchase.status !== 'CONFIRMED')   throw new HttpError(400, 'Purchase must be CONFIRMED to create a return');

    // Validate each return line
    let totalCents = 0;
    const validatedLines: Array<{
      purchaseLineId: string;
      productId:      string;
      qty:            number;
      unitCostCents:  number;
      lineTotalCents: number;
    }> = [];

    for (const line of lines) {
      const pl = purchase.lines.find((l: any) => l.id === line.purchaseLineId);
      if (!pl) throw new HttpError(400, `Purchase line ${line.purchaseLineId} not found on this PO`);

      const maxReturnable = Number(pl.receivedQty) - Number(pl.returnedQty);
      if (line.qty <= 0)            throw new HttpError(400, `Qty must be positive (line ${pl.id})`);
      if (line.qty > maxReturnable) throw new HttpError(400,
        `Cannot return ${line.qty} — only ${maxReturnable.toFixed(4)} returnable on line ${pl.id}`);

      const lineTotalCents = Math.round(line.qty * pl.unitCostCents);
      totalCents += lineTotalCents;

      validatedLines.push({
        purchaseLineId: pl.id,
        productId:      pl.productId,
        qty:            line.qty,
        unitCostCents:  pl.unitCostCents,
        lineTotalCents,
      });
    }

    const number = await nextReturnNumber();

    const ret = await (prisma as any).purchaseReturn.create({
      data: {
        number,
        purchaseId,
        supplierId:  purchase.supplierId,
        warehouseId: purchase.warehouseId,
        status:      'DRAFT',
        reason:      reason ?? null,
        totalCents,
        createdById: createdBy,
        lines: {
          create: validatedLines.map((l) => ({
            purchaseLineId: l.purchaseLineId,
            productId:      l.productId,
            qty:            l.qty,
            unitCostCents:  l.unitCostCents,
            lineTotalCents: l.lineTotalCents,
          })),
        },
      },
      include: RETURN_INCLUDE,
    });

    return ret;
  },

  // ── Confirm return → deduct stock + update returnedQty ─────────────────────

  async confirmReturn(id: string) {
    const ret = await (prisma as any).purchaseReturn.findUnique({
      where:   { id },
      include: { lines: { include: { purchaseLine: true, product: true } } },
    });
    if (!ret)                   throw new HttpError(404, 'Return not found');
    if (ret.status !== 'DRAFT') throw new HttpError(400, 'Only DRAFT returns can be confirmed');
    if (!ret.isActive)          throw new HttpError(400, 'Return has been deleted');

    return prisma.$transaction(async (tx) => {
      for (const line of ret.lines) {
        // Return qty is stored in PURCHASE units (validated against receivedQty,
        // which is recorded in purchase units). Stock.qty and StockBatch.qty are
        // held in BASE units, so convert before touching stock. A null unitId on
        // the origin purchase line means the line was already in base units.
        const rawQty  = new Decimal(line.qty.toString());          // purchase units
        const baseQty = line.purchaseLine.unitId
          ? (await convertToBaseUnit(line.productId, line.purchaseLine.unitId, rawQty, tx as any)).baseQty
          : rawQty;                                                // null unitId → already base
        const baseQtyNum = Number(baseQty);

        // 1. Create RETURN_OUT stock movement (BASE units, consistent with PURCHASE_IN)
        await tx.stockMovement.create({
          data: {
            productId:   line.productId,
            warehouseId: ret.warehouseId,
            type:        'RETURN_OUT',
            qty:         baseQtyNum,
            refType:     'PurchaseReturn',
            refId:       ret.id,
            note:        `PRET ${ret.number}`,
          },
        });

        // 2. Decrement the ORIGIN StockBatch row(s) — those created from this
        //    purchase line — by the base qty, oldest received first. Never write a
        //    negative batch row. Shortfall case: if the surviving batches sum to
        //    less than baseQty (e.g. the received stock was already sold or written
        //    off), decrement only what remains and leave the shortfall — the
        //    recompute below re-derives the aggregate from whatever rows survive.
        let remaining = baseQtyNum;
        const originBatches = await tx.stockBatch.findMany({
          where:   { purchaseLineId: line.purchaseLineId, qty: { gt: 0 } },
          orderBy: { receivedAt: 'asc' },
        });
        for (const batch of originBatches) {
          if (remaining <= 0) break;
          const deduct = Math.min(Number(batch.qty), remaining);
          await tx.stockBatch.update({
            where: { id: batch.id },
            data:  { qty: { decrement: deduct } },
          });
          remaining -= deduct;
        }

        // 3. Re-derive aggregate Stock.qty from the surviving positive batch rows
        //    (BASE units, floored at >= 0). Replaces the old direct decrement
        //    upsert, which could seed a negative Stock row and mixed purchase/base
        //    units.
        await recomputeStockQty(tx, line.productId, ret.warehouseId);

        // 4. Update purchaseLine.returnedQty — kept in PURCHASE units to stay
        //    consistent with receivedQty (used by createReturn's maxReturnable).
        await tx.purchaseLine.update({
          where: { id: line.purchaseLineId },
          data:  { returnedQty: { increment: rawQty } },
        });
      }

      // 4. Mark return CONFIRMED
      const confirmed = await (tx as any).purchaseReturn.update({
        where:   { id },
        data:    { status: 'CONFIRMED' },
        include: RETURN_INCLUDE,
      });

      // Step 5: Re-derive purchase paymentStatus after this return is confirmed.
      // We include the current return manually rather than re-querying to avoid
      // transaction ordering issues.

      // Load all previously confirmed returns for this PO (NOT including current
      // one since it may not be visible yet in tx)
      const previousReturns = await (tx as any).purchaseReturn.findMany({
        where: {
          purchaseId: ret.purchaseId,
          status:     'CONFIRMED',
          id:         { not: ret.id },
        },
        select: { totalCents: true },
      });

      // Add current return's value manually
      const totalReturnedCents =
        previousReturns.reduce((sum: number, r: any) => sum + r.totalCents, 0) + ret.totalCents;

      // Load parent purchase current state
      const parentPurchase = await tx.purchase.findUnique({
        where:  { id: ret.purchaseId },
        select: { totalCents: true, paidCents: true },
      });
      if (!parentPurchase) throw new Error('Parent purchase not found');

      // Effective amount still owed (Option B — totalCents itself is never mutated)
      const effectiveTotalCents = Math.max(
        0,
        parentPurchase.totalCents - totalReturnedCents,
      );

      // Derive new payment status (4-branch — Option B).
      //  1. effectiveTotal === 0  → nothing owed (all goods returned) → PAID
      //  2. paid >= effectiveTotal → fully covered (incl. overpaid)    → PAID
      //  3. paid  >  0             → some paid, balance remains         → PARTIAL
      //  4. otherwise                                                   → UNPAID
      const newPaymentStatus =
        effectiveTotalCents === 0
          ? 'PAID'
          : parentPurchase.paidCents >= effectiveTotalCents
            ? 'PAID'
            : parentPurchase.paidCents > 0
              ? 'PARTIAL'
              : 'UNPAID';

      // Update paymentStatus ONLY — never change totalCents or paidCents
      await tx.purchase.update({
        where: { id: ret.purchaseId },
        data:  { paymentStatus: newPaymentStatus },
      });

      return confirmed;
    });
  },

  // ── Cancel return (DRAFT only) ──────────────────────────────────────────────

  async cancelReturn(id: string) {
    const ret = await (prisma as any).purchaseReturn.findUnique({
      where:  { id },
      select: { status: true, isActive: true },
    });
    if (!ret)                   throw new HttpError(404, 'Return not found');
    if (ret.status !== 'DRAFT') throw new HttpError(400, 'Only DRAFT returns can be cancelled');

    return (prisma as any).purchaseReturn.update({
      where:   { id },
      data:    { status: 'CANCELLED' },
      include: RETURN_INCLUDE,
    });
  },

  // ── Soft-delete (DRAFT only) ────────────────────────────────────────────────

  async deleteReturn(id: string) {
    const ret = await (prisma as any).purchaseReturn.findUnique({
      where:  { id },
      select: { status: true, isActive: true },
    });
    if (!ret)                   throw new HttpError(404, 'Return not found');
    if (!ret.isActive)          throw new HttpError(400, 'Already deleted');
    if (ret.status !== 'DRAFT') throw new HttpError(400, 'Only DRAFT returns can be deleted');

    return (prisma as any).purchaseReturn.update({
      where:   { id },
      data:    { isActive: false },
      include: RETURN_INCLUDE,
    });
  },

  // ── List returns ────────────────────────────────────────────────────────────

  async listReturns(purchaseId?: string, supplierId?: string) {
    return (prisma as any).purchaseReturn.findMany({
      where:   {
        isActive: true,
        ...(purchaseId ? { purchaseId } : {}),
        ...(supplierId ? { supplierId } : {}),
      },
      orderBy: { createdAt: 'desc' },
      include: {
        purchase:  { select: { id: true, number: true } },
        supplier:  { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, fullName: true } },
        _count:    { select: { lines: true } },
      },
    });
  },

  // ── Get single return ───────────────────────────────────────────────────────

  async getReturn(id: string) {
    const ret = await (prisma as any).purchaseReturn.findFirst({
      where:   { id, isActive: true },
      include: RETURN_INCLUDE,
    });
    if (!ret) throw new HttpError(404, 'Return not found');
    return ret;
  },

  // ── Debit note data (for PDF) ───────────────────────────────────────────────

  async getDebitNoteData(id: string) {
    const ret = await (prisma as any).purchaseReturn.findFirst({
      where: { id, isActive: true },
      include: {
        purchase:  { select: { id: true, number: true, date: true } },
        supplier:  true,
        warehouse: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, fullName: true } },
        lines: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
          },
        },
      },
    });
    if (!ret) throw new HttpError(404, 'Return not found');
    return ret;
  },
};
