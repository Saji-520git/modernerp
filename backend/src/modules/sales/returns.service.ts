import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../middleware/error-handler.js';
import { creditIncrementCents } from './return-credit.js';
import { refundUnitCents, cappedReturnTotalCents, cappedRefundCents } from './return-value.js';
import { loyaltyReturnDelta } from '../loyalty/loyalty-return.js';
import { loyaltyService } from '../loyalty/loyalty.service.js';
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

    // What each unit is actually worth back. The form used to multiply the
    // LIST price off the sale line, which over-refunded every discounted,
    // promoted or points-redeemed sale. Sent from here so the figure the
    // cashier sees is the same integer the server will store.
    const grossLinesCents = sale.lines.reduce((n, l) => n + l.lineTotalCents, 0);

    const linesWithAvailable = sale.lines.map((l) => ({
      ...l,
      qty: Number(l.qty),
      alreadyReturnedQty: returnedQty.get(l.productId) ?? 0,
      availableToReturn: Number(l.qty) - (returnedQty.get(l.productId) ?? 0),
      refundUnitCents: refundUnitCents({
        saleTotalCents:  sale.totalCents,
        grossLinesCents,
        lineTotalCents:  l.lineTotalCents,
        qtySold:         Number(l.qty),
      }),
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

    // ── Value the return from the ORIGINAL invoice, never from the client ────
    //
    // unitPriceCents and lineTotalCents arrive in the request and were trusted
    // outright: quantity was checked against the invoice but price never was,
    // so a return could be valued at any figure. They are now ignored.
    //
    // The value is prorated against what the customer was actually charged, so
    // a cart discount, a promotion, redeemed points and tax are all carried
    // through — the form used the list price and over-refunded every one of
    // them. See return-value.ts.
    const grossLinesCents = sale.lines.reduce((n, l) => n + l.lineTotalCents, 0);

    const pricedLines = input.lines.map((l) => {
      const saleLine = sale.lines.find((sl) => sl.productId === l.productId)!;
      const unitCents = refundUnitCents({
        saleTotalCents:  sale.totalCents,
        grossLinesCents,
        lineTotalCents:  saleLine.lineTotalCents,
        qtySold:         Number(saleLine.qty),
      });
      return {
        productId:      l.productId,
        qty:            l.qty,
        unitPriceCents: unitCents,
        lineTotalCents: Math.round(unitCents * l.qty),
      };
    });

    // Already-returned VALUE, so rounding across many partial returns can never
    // add up past the invoice.
    const priorReturnedValue = await prisma.saleReturn.aggregate({
      where: { saleId: input.saleId },
      _sum:  { totalCents: true },
    });
    const totalCents = cappedReturnTotalCents(
      pricedLines.reduce((n, l) => n + l.lineTotalCents, 0),
      sale.totalCents,
      priorReturnedValue._sum.totalCents ?? 0,
    );

    // Cash can never exceed the return's value, nor what the customer paid.
    // Previously bounded only by "integer >= 0": a Rs.100 return could hand
    // back Rs.10,000 and write a matching negative Payment row.
    const refundedCents = input.refundMethod === 'NONE'
      ? 0
      : cappedRefundCents(input.refundedCents, totalCents, sale.paidCents);

    // Which till this refund comes out of. Resolved before the transaction so
    // the lookup does not hold it open, and only for CASH: a store-credit or
    // card refund never touches the drawer, so tying it to a shift would make
    // the close subtract money that never left. Null when no shift is open,
    // which is the normal back-office case.
    const refundShiftId = input.refundMethod === 'CASH' && refundedCents > 0
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
          refundedCents,
          createdById: userId,
          lines: { create: pricedLines },
        },
        include: {
          lines: true,
          sale: { select: { id: true, number: true } },
          warehouse: { select: { id: true, name: true, code: true } },
          createdBy: { select: { id: true, fullName: true } },
        },
      });

      // 2. Add stock back (RETURN_IN) for each line
      for (const line of pricedLines) {
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
        // aggregate has batch backing and survives recomputeStockQty.
        //
        // Carry the ORIGIN batch's identity where the sale recorded one. Every
        // returned lot used to land with expiryDate, supplierId and cost all
        // empty, which had three consequences: the lot sat in stock valued at
        // zero, batch matching could not group it with the goods it came from,
        // and — worst for a grocery — FEFO sorts a null expiry LAST, so
        // returned perishables queued up behind fresher stock and were the last
        // thing sold rather than the first.
        //
        // SaleLine.batchId is populated only when the batch was picked by hand.
        // A FEFO sale records the quantity it took but not which lots it took
        // it from (deductBatchesFEFO returns a number), so for those the origin
        // is genuinely unknown and expiry stays null rather than being invented
        // — a guessed expiry date on perishable goods is worse than an absent
        // one. Cost still falls back to the product, so no lot is valued at zero.
        const originBatch = saleLine?.batchId
          ? await tx.stockBatch.findUnique({
              where:  { id: saleLine.batchId },
              select: { expiryDate: true, supplierId: true, unitCostCents: true, batchNumber: true },
            })
          : null;
        const productCost = await tx.product.findUnique({
          where: { id: line.productId }, select: { costCents: true },
        });

        await tx.stockBatch.create({
          data: {
            productId:      line.productId,
            warehouseId:    sale.warehouseId,
            purchaseLineId: null,
            qty:            baseQty,
            expiryDate:     originBatch?.expiryDate ?? null,
            supplierId:     originBatch?.supplierId ?? null,
            batchNumber:    originBatch?.batchNumber ?? null,
            unitCostCents:  originBatch?.unitCostCents ?? productCost?.costCents ?? 0,
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

      // 3. Handle cash/card/bank refund (NONE = settle on account — see step 4)
      const saleBefore = await tx.sale.findUnique({
        where:  { id: input.saleId },
        select: {
          paidCents: true, totalCents: true, customerId: true,
          pointsEarned: true, pointsRedeemed: true,
        },
      });
      let paidCentsAfterRefund = saleBefore?.paidCents ?? 0;

      if (input.refundMethod !== 'NONE' && refundedCents > 0) {
        // Reduce paidCents on original sale (customer was refunded). Cannot go below 0.
        const newPaidCents = Math.max(0, paidCentsAfterRefund - refundedCents);
        paidCentsAfterRefund = newPaidCents;
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
            amountCents: -refundedCents,
            method: refundPaymentMethod as any,
            createdById: userId,
            note: `Refund for return ${ret.number}`,
          },
        });
      }

      // 4. Park anything the customer has now overpaid as credit on their
      //    account. refundMethod NONE was documented as "store credit only",
      //    but nothing was ever written: the goods came back, the money stayed
      //    with the shop, and no liability was recorded anywhere. A customer
      //    handing back a paid-for item received nothing at all.
      //
      //    The amount is NOT the return total — see return-credit.ts. On an
      //    unpaid invoice the return cancels debt instead (the outstanding
      //    balance already nets returns), and crediting it as well would pay
      //    the customer twice.
      //
      //    Walk-in sales have no customer to hold a balance for, so there is
      //    nowhere to park it; the return still stands and the stock still
      //    comes back.
      // The aggregate includes the return just persisted above.
      const returnedAgg = await tx.saleReturn.aggregate({
        where: { saleId: input.saleId },
        _sum:  { totalCents: true },
      });
      const returnedAfter  = returnedAgg._sum.totalCents ?? 0;
      const returnedBefore = Math.max(0, returnedAfter - totalCents);
      const saleTotalCents = saleBefore?.totalCents ?? 0;

      // 3b. Re-derive the invoice's payment status against what is still owed.
      //
      // The purchase side has done this since returns were built there; the
      // sale side never did, so a fully-returned unpaid invoice stayed UNPAID
      // at its original value. It then kept consuming the customer's credit
      // limit and kept appearing in collection lists as money to chase.
      //
      // Same four branches as purchase-return.service, against the invoice
      // re-totalled net of every return:
      const effectiveTotalCents = Math.max(0, saleTotalCents - returnedAfter);
      const newPaymentStatus =
        effectiveTotalCents === 0
          ? 'PAID'
          : paidCentsAfterRefund >= effectiveTotalCents
            ? 'PAID'
            : paidCentsAfterRefund > 0
              ? 'PARTIAL'
              : 'UNPAID';

      // paymentStatus ONLY — totalCents and paidCents keep recording what was
      // billed and what was taken. The return is the document that explains the
      // difference; rewriting the invoice would erase it.
      await tx.sale.update({
        where: { id: input.saleId },
        data:  { paymentStatus: newPaymentStatus },
      });

      // 3c. Release any promotion this sale consumed, once the whole invoice
      //     has come back.
      //
      //     A promotion's usage is discrete: promotions.engine refuses a promo
      //     when timesUsed >= usageLimit, and checkout increments it by one per
      //     sale. A partially returned sale still happened, so it still counts;
      //     a fully returned one did not, and holding its slot would retire a
      //     limited offer early on business that was undone.
      //
      //     Edge-triggered on the invoice CROSSING into fully-returned, so a
      //     second return against the same sale cannot release it twice. The
      //     SalePromotion rows are left in place — they are the record of what
      //     was applied, and deleting them would erase why the invoice totalled
      //     what it did.
      const becameFullyReturned =
        saleTotalCents > 0 &&
        returnedBefore < saleTotalCents &&
        returnedAfter >= saleTotalCents;

      if (becameFullyReturned) {
        const applied = await tx.salePromotion.findMany({
          where:  { saleId: input.saleId },
          select: { promotionId: true },
        });
        for (const { promotionId } of applied) {
          const promo = await tx.promotion.findUnique({
            where: { id: promotionId }, select: { timesUsed: true },
          });
          if (!promo) continue;
          // Floored rather than a bare decrement: a counter edited by hand, or
          // a sale predating this release path, must not push it negative and
          // hand out more uses than the limit allows.
          await tx.promotion.update({
            where: { id: promotionId },
            data:  { timesUsed: Math.max(0, promo.timesUsed - 1) },
          });
        }
      }

      const customerId = saleBefore?.customerId ?? null;
      if (customerId) {
        // Credit is the DIFFERENCE between the invoice before and after this
        // return: crediting the cumulative figure would pay every earlier
        // return on this invoice a second time.

        const creditCents = creditIncrementCents(
          {
            saleTotalCents,
            returnedCentsIncludingThis: returnedBefore,
            // Pre-refund figure: any cash handed back belongs to THIS return.
            paidCentsAfterRefund:       saleBefore?.paidCents ?? 0,
          },
          {
            saleTotalCents,
            returnedCentsIncludingThis: returnedAfter,
            paidCentsAfterRefund,
          },
        );

        if (creditCents > 0) {
          await tx.customer.update({
            where: { id: customerId },
            data:  { creditBalanceCents: { increment: creditCents } },
          });
          await tx.customerCreditLedger.create({
            data: {
              customerId,
              amountCents: creditCents,          // positive = credit added
              reason:      'RETURN_CREDIT',
              refType:     'SaleReturn',
              refId:       ret.id,
              notes:       `Return ${ret.number} against ${ret.sale.number}`,
              createdBy:   userId,
            },
          });
        }

        // 5. Loyalty. Points earned on the sale are clawed back and points it
        //    consumed are handed back, both scaled to how much of the invoice
        //    has now come back. Without this a customer could buy, collect the
        //    points, return the goods and keep them — on a loop.
        //
        //    Same before/after shape as the credit above: the rule answers what
        //    the cumulative reversal should be, and only the difference is
        //    applied, so a second return cannot reverse the first one's points
        //    again.
        const loyalty = loyaltyReturnDelta({
          pointsEarnedOnSale:   saleBefore?.pointsEarned ?? 0,
          pointsRedeemedOnSale: saleBefore?.pointsRedeemed ?? 0,
          saleTotalCents,
          returnedCentsBefore:  returnedBefore,
          returnedCentsAfter:   returnedAfter,
        });
        await loyaltyService.reverseForReturn(tx, {
          customerId,
          saleId:        input.saleId,
          returnNumber:  ret.number,
          earnedReversal: loyalty.earnedReversal,
          redeemRestore:  loyalty.redeemRestore,
        });
      }

      return ret;
      });
    });
  },
};
