import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../middleware/error-handler.js';
import { convertToBaseUnit } from '../../utils/unit-converter.js';
import { recomputeStockQty, settleShortfall } from '../../utils/stock-utils.js';
import { recordStockMovement } from '../../utils/stock-movement.js';
import { resolveOpenShiftId } from '../pos/resolve-shift.js';
import type { CreateReturnInput, ListReturnsInput } from './returns.schema.js';
import { nextDocNumber, withNumberRetry } from '../../utils/doc-number.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Highest issued + 1, never a row count — see utils/doc-number.ts.
async function generateReturnNumber(): Promise<string> {
  return nextDocNumber(prisma.saleReturn, `CRN-${new Date().getFullYear()}-`);
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const returnsService = {
  // ── List returns ───────────────────────────────────────────────────────────

  list: async (input: ListReturnsInput) => {
    const { search, saleId, customerId, from, to, page, pageSize } = input;

    const where = {
      ...(saleId     && { saleId }),
      ...(customerId && { sale: { customerId } }),
      ...(from || to ? {
        createdAt: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to ? { lte: new Date(to + 'T23:59:59Z') } : {}),
        },
      } : {}),
      ...(search && {
        OR: [
          { number: { contains: search, mode: 'insensitive' as const } },
          { sale: { number: { contains: search, mode: 'insensitive' as const } } },
          { reason: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [total, data] = await prisma.$transaction([
      prisma.saleReturn.count({ where }),
      prisma.saleReturn.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          sale: { select: { id: true, number: true, customer: { select: { name: true } } } },
          warehouse: { select: { id: true, name: true, code: true } },
          createdBy: { select: { id: true, fullName: true } },
          _count: { select: { lines: true } },
        },
      }),
    ]);

    return { total, page, pageSize, data };
  },

  // ── Get single return with lines ───────────────────────────────────────────

  getOne: async (id: string) => {
    const ret = await prisma.saleReturn.findUnique({
      where: { id },
      include: {
        sale: { select: { id: true, number: true, customer: { select: { name: true } } } },
        warehouse: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, fullName: true } },
        lines: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                unit: { select: { shortCode: true } },
              },
            },
          },
        },
      },
    });
    if (!ret) throw new HttpError(404, 'Return not found');
    return ret;
  },

  // ── Get original sale with lines (for the create-return form) ─────────────

  getSaleForReturn: async (saleId: string) => {
    const sale = await prisma.sale.findUnique({
      where: { id: saleId, status: 'CONFIRMED' },
      include: {
        customer: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true, code: true } },
        lines: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                unit: { select: { shortCode: true } },
              },
            },
          },
        },
        // Include existing returns to calculate already-returned quantities
        returns: {
          include: { lines: { select: { productId: true, qty: true } } },
        },
      },
    });
    if (!sale) throw new HttpError(404, 'Confirmed invoice not found');

    // Calculate already-returned qty per product
    const returnedQty = new Map<string, number>();
    for (const ret of sale.returns) {
      for (const line of ret.lines) {
        const prev = returnedQty.get(line.productId) ?? 0;
        returnedQty.set(line.productId, prev + Number(line.qty));
      }
    }

    const linesWithAvailable = sale.lines.map((l) => ({
      ...l,
      qty: Number(l.qty),
      alreadyReturnedQty: returnedQty.get(l.productId) ?? 0,
      availableToReturn: Number(l.qty) - (returnedQty.get(l.productId) ?? 0),
    }));

    return {
      ...sale,
      lines: linesWithAvailable,
    };
  },

  // ── Create return → reverse stock ─────────────────────────────────────────

  create: async (input: CreateReturnInput, userId: string) => {
    // Validate original sale
    const sale = await prisma.sale.findUnique({
      where: { id: input.saleId, status: 'CONFIRMED' },
      include: {
        lines: true,
        returns: { include: { lines: { select: { productId: true, qty: true } } } },
      },
    });
    if (!sale) throw new HttpError(404, 'Confirmed invoice not found');

    // Calculate already-returned qty per product
    const returnedQty = new Map<string, number>();
    for (const ret of sale.returns) {
      for (const line of ret.lines) {
        const prev = returnedQty.get(line.productId) ?? 0;
        returnedQty.set(line.productId, prev + Number(line.qty));
      }
    }

    // Validate each return line
    for (const rLine of input.lines) {
      const saleLine = sale.lines.find((l) => l.productId === rLine.productId);
      if (!saleLine) {
        throw new HttpError(400, `Product ${rLine.productId} not on original invoice`);
      }
      const originalQty = Number(saleLine.qty);
      const alreadyReturned = returnedQty.get(rLine.productId) ?? 0;
      const available = originalQty - alreadyReturned;
      if (rLine.qty > available) {
        const product = await prisma.product.findUnique({
          where: { id: rLine.productId },
          select: { name: true },
        });
        throw new HttpError(
          400,
          `Cannot return ${rLine.qty} of "${product?.name}" — only ${available} available to return`,
        );
      }
    }

    const totalCents = input.lines.reduce((s, l) => s + l.lineTotalCents, 0);

    // Which till this refund comes out of. Resolved before the transaction so
    // the lookup does not hold it open, and only for CASH: a store-credit or
    // card refund never touches the drawer, so tying it to a shift would make
    // the close subtract money that never left. Null when no shift is open,
    // which is the normal back-office case.
    const refundShiftId = input.refundMethod === 'CASH' && input.refundedCents > 0
      ? await resolveOpenShiftId(userId, sale.warehouseId)
      : null;

    // Number issued inside the retry, wrapping the whole transaction: a return
    // can be raised at the till as well as the back office, so two can collide,
    // and re-reading the maximum after the database rejects one is the only way
    // to settle it. Retrying the transaction as a unit keeps the stock and
    // refund writes together with the number they were issued under.
    return withNumberRetry(async () => {
      const number = await generateReturnNumber();
      return prisma.$transaction(async (tx) => {
      // 1. Create return record + lines
      const ret = await tx.saleReturn.create({
        data: {
          number,
          saleId: input.saleId,
          warehouseId: sale.warehouseId,
          shiftId: refundShiftId,
          reason: input.reason,
          totalCents,
          refundMethod: input.refundMethod,
          refundedCents: input.refundedCents,
          createdById: userId,
          lines: {
            create: input.lines.map((l) => ({
              productId: l.productId,
              qty: l.qty,
              unitPriceCents: l.unitPriceCents,
              lineTotalCents: l.lineTotalCents,
            })),
          },
        },
        include: {
          lines: true,
          sale: { select: { id: true, number: true } },
          warehouse: { select: { id: true, name: true, code: true } },
          createdBy: { select: { id: true, fullName: true } },
        },
      });

      // 2. Add stock back (RETURN_IN) for each line
      for (const line of input.lines) {
        // Sale-return qty is stored in SALE units (validated against SaleLine.qty).
        // Stock / StockBatch are held in BASE units, so convert the RETURNED qty —
        // NOT saleLine.baseQty, which is the full sold amount — so partial returns
        // scale correctly. A null unitId on the original sale line means it was
        // already in base units. saleLine is guaranteed non-null here: the
        // validation loop above threw if the product was not on the invoice.
        const saleLine = sale.lines.find((l) => l.productId === line.productId);
        const rawQty  = new Decimal(line.qty.toString());      // sale units
        const baseQty = saleLine?.unitId
          ? (await convertToBaseUnit(line.productId, saleLine.unitId, rawQty, tx as any)).baseQty
          : rawQty;                                            // null unitId → already base
        const baseQtyNum = Number(baseQty);

        // Create a StockBatch lot for the returned goods in BASE units so the
        // aggregate has batch backing and survives recomputeStockQty. Returned
        // goods have no purchase origin (purchaseLineId null) and unknown expiry
        // (null → FEFO sorts it last). Replaces the bare stock.upsert(increment),
        // which left the returned qty with no batch row behind it.
        await tx.stockBatch.create({
          data: {
            productId:      line.productId,
            warehouseId:    sale.warehouseId,
            purchaseLineId: null,
            qty:            baseQty,
            expiryDate:     null,
          },
        });
        await recomputeStockQty(tx, line.productId, sale.warehouseId);

        // If the counter owes units, the returned goods pay that down before
        // they count as stock on hand. Putting them on a shelf the shop is
        // already short from would restock units it never had — the customer
        // handing one back is the shortfall arriving, just from the other
        // direction. No-op when nothing is owed.
        await settleShortfall(tx, line.productId, sale.warehouseId);

        // Stock movement (BASE units, consistent with PURCHASE_IN / sale deduction)
        await recordStockMovement(tx, {
          productId: line.productId,
          warehouseId: sale.warehouseId,
          type: 'RETURN_IN',
          qty: baseQtyNum,
          refType: 'SaleReturn',
          refId: ret.id,
          note: `Return ${ret.number} (from ${ret.sale.number})`,
        });
      }

      // 3. Handle cash/card/bank refund (NONE = store credit only — no payment movement)
      if (input.refundMethod !== 'NONE' && input.refundedCents > 0) {
        // Reduce paidCents on original sale (customer was refunded). Cannot go below 0.
        const currentSale = await tx.sale.findUnique({
          where: { id: input.saleId },
          select: { paidCents: true },
        });
        const newPaidCents = Math.max(0, (currentSale?.paidCents ?? 0) - input.refundedCents);
        await tx.sale.update({
          where: { id: input.saleId },
          data: { paidCents: newPaidCents },
        });

        // Negative-amount Payment row documents cash going back to the customer.
        // Payment.method is the PaymentMethod enum (no "BANK" member) → map BANK→BANK_TRANSFER.
        const refundPaymentMethod = input.refundMethod === 'BANK' ? 'BANK_TRANSFER' : input.refundMethod;
        await tx.payment.create({
          data: {
            saleId: input.saleId,
            amountCents: -input.refundedCents,
            method: refundPaymentMethod as any,
            createdById: userId,
            note: `Refund for return ${ret.number}`,
          },
        });
      }

      return ret;
      });
    });
  },
};
