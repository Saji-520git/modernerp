import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';
import { convertToBaseUnit, getUnitPrice } from '../../utils/unit-converter.js';
import { getBatchSummary, deductBatchesFEFO } from '../../utils/batch-expiry.js';
import { recomputeStockQty } from '../../utils/stock-utils.js';
import { isModuleEnabled } from '../../config/modules.js';
import { promotionsService } from '../promotions/promotions.service.js';
import { computePromotions, type AppliedPromo } from '../promotions/promotions.engine.js';
import { loyaltyService } from '../loyalty/loyalty.service.js';
import { planRedemption, pointsForAmount } from '../loyalty/loyalty.calc.js';
import { SETTINGS_ID } from '../settings/settings.service.js';
import type { CheckoutInput, ProductSearchInput, ListSalesInput, SaveDraftInput, OpenShiftInput, CloseShiftInput, ForceCloseShiftInput, ListShiftsInput } from './pos.schema.js';

// ─── Sale number generator ────────────────────────────────────────────────────

async function generateSaleNumber(): Promise<string> {
  const year   = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  const count  = await prisma.sale.count({ where: { number: { startsWith: prefix } } });
  return `${prefix}${String(count + 1).padStart(4, '0')}`;
}

// ─── Credit helpers ───────────────────────────────────────────────────────────

async function getCustomerCreditBalance(customerId: string): Promise<number> {
  const result = await prisma.sale.aggregate({
    where: { customerId, status: 'CONFIRMED', paymentStatus: { in: ['UNPAID', 'PARTIAL'] } },
    _sum: { totalCents: true, paidCents: true },
  });
  return Math.max(0, (result._sum.totalCents ?? 0) - (result._sum.paidCents ?? 0));
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const posService = {

  // ── Products ──────────────────────────────────────────────────────────────

  async searchProducts(input: ProductSearchInput) {
    const { search, warehouseId, categoryId, brandId, page, pageSize } = input;
    const skip = (page - 1) * pageSize;

    const where = {
      isActive: true,
      ...(categoryId ? { categoryId } : {}),
      ...(brandId ? { brandId } : {}),
      ...(search ? {
        OR: [
          { name:    { contains: search, mode: 'insensitive' as const } },
          { sku:     { contains: search, mode: 'insensitive' as const } },
          { barcode: search },
        ],
      } : {}),
    };

    const [total, products] = await prisma.$transaction([
      prisma.product.count({ where }),
      prisma.product.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { name: 'asc' },
        select: {
          id: true,
          sku: true,
          barcode: true,
          name: true,
          receiptName: true,
          categoryId: true,
          priceCents: true,
          costCents: true,
          defaultDiscountCents: true,
          serviceChargeCents: true,
          serviceChargeLabel: true,
          serviceChargeMode: true,
          taxPercent: true,
          imageUrl: true,
          expiryDate: true,
          expiryAlertDays: true,
          unitId: true,
          baseUnitId: true,
          purchaseUnitId: true,
          salesUnitId: true,
          unit:         { select: { id: true, shortCode: true, name: true, allowDecimal: true } },
          baseUnit:     { select: { id: true, shortCode: true, name: true, allowDecimal: true } },
          salesUnit:    { select: { id: true, shortCode: true, name: true, allowDecimal: true } },
          unitConversions: {
            where: { isActive: true },
            select: {
              id: true,
              fromUnitId: true,
              toUnitId: true,
              conversionQty: true,
              priceCents: true,
              discountType: true,
              discountValue: true,
              fromUnit: { select: { id: true, name: true, shortCode: true, allowDecimal: true } },
              toUnit:   { select: { id: true, name: true, shortCode: true } },
            },
          },
          stock: warehouseId
            ? { where: { warehouseId }, select: { qty: true } }
            : { select: { qty: true, warehouseId: true } },
        },
      }),
    ]);

    // Enrich each product with batch expiry summary
    const data = await Promise.all(
      products.map(async (p) => {
        const warehouseIdForBatch = input.warehouseId ?? null;
        if (!warehouseIdForBatch) return { ...p, batchSummary: null };
        const batchSummary = await getBatchSummary(p.id, warehouseIdForBatch);
        return { ...p, batchSummary };
      }),
    );

    return { total, page, pageSize, data };
  },

  // ── Warehouses ─────────────────────────────────────────────────────────────

  async getWarehouses() {
    return prisma.warehouse.findMany({
      where: { isActive: true },
      select: { id: true, name: true, code: true },
      orderBy: { name: 'asc' },
    });
  },

  // ── Checkout ───────────────────────────────────────────────────────────────

  async checkout(
    input: CheckoutInput,
    userId: string,
    canAdjustPrice: boolean,
    canSellOnCredit: boolean,
    canManageCredit: boolean,
  ) {
    const { warehouseId, customerId, paymentMethod, cartDiscountCents = 0, cartDiscountPercent = 0, cashAmountCents, note, items, draftId, isStaffSale = false, redeemPoints = 0 } = input;

    // Split payment (cash + credit): recorded as CREDIT with the cash portion paid up-front.
    // The remainder becomes the customer's outstanding balance.
    const splitCashCents = paymentMethod === 'CREDIT' && (cashAmountCents ?? 0) > 0 ? (cashAmountCents as number) : 0;

    // Credit sale validation
    if (paymentMethod === 'CREDIT') {
      if (!canSellOnCredit) throw new HttpError(403, 'You do not have permission to make credit sales');
      if (!customerId) throw new HttpError(400, 'Credit sales require a customer');

      const customer = await prisma.customer.findUnique({ where: { id: customerId } });
      if (!customer?.creditEnabled) throw new HttpError(400, 'This customer does not have credit enabled');

      if (customer.creditLimitCents > 0) {
        const existing = await getCustomerCreditBalance(customerId);
        // We'll compute the new sale total after product lookup — do a pre-check with a rough estimate.
        // For split payments only the credit portion (total − cash paid now) counts against the limit.
        const roughTotal = items.reduce((s, i) => s + i.qty * (i.unitPriceCents ?? 0), 0) - splitCashCents;

        const alertThreshold = Math.round(customer.creditLimitCents * (customer.creditAlertPct / 100));
        const newBalance = existing + roughTotal;

        if (newBalance > customer.creditLimitCents) {
          throw new HttpError(
            400,
            `Credit limit exceeded. Limit: Rs. ${(customer.creditLimitCents / 100).toFixed(2)}. Used: Rs. ${(existing / 100).toFixed(2)}. This sale would exceed by Rs. ${((newBalance - customer.creditLimitCents) / 100).toFixed(2)}.`,
          );
        }
        if (newBalance > alertThreshold && newBalance <= customer.creditLimitCents) {
          logger.warn({ customerId, newBalance, limit: customer.creditLimitCents }, 'Customer near credit limit');
        }
      }
    }

    // 0. Load app settings — resolve expiredStockPolicy
    //    New field (BLOCK/WARN/ALLOW) takes precedence.
    //    Legacy boolean fallback: blockExpiredSales=true→BLOCK, false→ALLOW.
    const appSettings = await prisma.appSettings.findUnique({ where: { id: SETTINGS_ID } });
    const expiredStockPolicy: 'BLOCK' | 'WARN' | 'ALLOW' = (() => {
      const p = (appSettings as any)?.expiredStockPolicy as string | undefined;
      if (p === 'WARN' || p === 'ALLOW') return p;
      if (p === 'BLOCK') return 'BLOCK';
      // legacy fallback
      return appSettings?.blockExpiredSales !== false ? 'BLOCK' : 'ALLOW';
    })();

    // Discount policy (server-authoritative — do not trust the client):
    //   posAllowDiscount        → cashier may key a manual discount at checkout
    //   posApplyDefaultDiscount → product/unit preset discounts apply
    // Cart-level discount is always manual, so it is forced to 0 when manual is
    // off. A per-line discount can be either a preset OR a cashier edit, so it is
    // only forced to 0 when BOTH are off (the strict "no discounts" configuration);
    // otherwise it is trusted (preserves presets, and per-line edits when allowed).
    const posAllowManual  = appSettings?.posAllowDiscount !== false;
    const posApplyDefault = (appSettings as { posApplyDefaultDiscount?: boolean } | null)?.posApplyDefaultDiscount !== false;
    const forceZeroLineDiscount = !posAllowManual && !posApplyDefault;

    const checkoutWarnings: string[] = [];

    // 1. Load products
    const productIds = items.map((i) => i.productId);
    const products   = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
      include: { stock: { where: { warehouseId } } },
    });

    if (products.length !== productIds.length) {
      const found   = new Set(products.map((p) => p.id));
      const missing = productIds.find((id) => !found.has(id));
      throw new HttpError(404, `Product not found or inactive: ${missing}`);
    }

    // 2. Resolve base quantities (apply unit conversion if unitId is provided)
    const resolvedItems = await Promise.all(
      items.map(async (item) => {
        // ── Trust boundary note (v1.0.72) ─────────────────────────────────
        // For COUNT-only units (allowDecimal === false), the frontend
        // (POSPage.tsx commitEdit) rounds qty to integer before submission.
        // This service accepts the resulting integer qty without re-checking.
        //
        // If this service is ever exposed to non-React clients (multi-tenant
        // API, mobile app, external integration), add per-line integer
        // validation here: when the effective unit's allowDecimal is false,
        // reject the line if Number.isInteger(item.qty) === false.
        //
        // Backend Zod (.min(0.0001)) already blocks zero and negatives.
        // ──────────────────────────────────────────────────────────────────
        const product = products.find((p) => p.id === item.productId)!;
        const baseUnitId = product.baseUnitId ?? product.unitId;

        let baseQty: number;
        let effectiveUnitId = item.unitId ?? baseUnitId;

        if (item.unitId && item.unitId !== baseUnitId) {
          const result = await convertToBaseUnit(
            item.productId,
            item.unitId,
            new Decimal(item.qty),
            prisma,
          );
          baseQty = result.baseQty.toNumber();
        } else {
          baseQty = item.qty;
          effectiveUnitId = baseUnitId;
        }

        return { ...item, baseQty, effectiveUnitId, baseUnitId };
      }),
    );

    // 3. Stock check — use sellableQty (non-expired) if batches exist
    for (const item of resolvedItems) {
      const product = products.find((p) => p.id === item.productId)!;
      const totalAvailable = product.stock[0] ? Number(product.stock[0].qty) : 0;

      // Check sellable (non-expired) qty from batches
      const batchData = await getBatchSummary(item.productId, warehouseId);
      // If no batches exist at all (no expiry tracking), fall back to total stock
      const available = batchData.expiryStatus === 'none'
        ? totalAvailable
        : batchData.sellableQty;

      // Apply expiredStockPolicy when all available stock is expired
      if (batchData.expiryStatus !== 'none' && available === 0 && batchData.expiredQty > 0) {
        if (expiredStockPolicy === 'BLOCK') {
          throw new HttpError(
            400,
            `"${product.name}" is expired and cannot be sold. Write off expired stock or change the Expired Stock Policy in Settings.`,
          );
        } else if (expiredStockPolicy === 'WARN') {
          checkoutWarnings.push(`"${product.name}" contains expired batches — sold with manager approval`);
          // Fall through: allow stock deduction using total (includes expired)
        }
        // ALLOW: no action
      }

      // For WARN/ALLOW when only expired stock remains, use total qty (includes expired) as available
      const effectiveAvailable = (expiredStockPolicy !== 'BLOCK' && available === 0 && batchData.expiredQty > 0)
        ? totalAvailable
        : available;

      if (effectiveAvailable < item.baseQty) {
        const msg = batchData.expiredQty > 0
          ? `Insufficient stock for "${product.name}". Available: ${effectiveAvailable}, requested: ${item.baseQty}`
          : `Insufficient stock for "${product.name}". Available: ${effectiveAvailable}, requested: ${item.baseQty}`;
        throw new HttpError(400, msg);
      }
    }

    // 4. Compute line totals
    // Calculation order (per spec):
    //   lineSubtotal = unitPrice × qty
    //   lineDiscount = item.discountCents (capped at lineSubtotal)
    //   lineAfterDisc = lineSubtotal - lineDiscount
    //   cartSubtotal = Σ lineAfterDisc
    //   cartDiscount = percent? floor(cartSubtotal × pct/100) : min(cents, cartSubtotal)
    //   taxableAmount = cartSubtotal - cartDiscount
    //   effectiveTax  = floor(grossTax × taxableAmount / cartSubtotal)   (proportional scaling)
    //   grandTotal    = taxableAmount + effectiveTax
    // Pass 1 — resolve price + manual (line) discount per line (pre-promotion).
    const preLines = await Promise.all(
      resolvedItems.map(async (item) => {
        const product = products.find((p) => p.id === item.productId)!;

        // Resolve price for the unit being used
        let unitPrice: number;
        if (canAdjustPrice && item.unitPriceCents !== undefined) {
          unitPrice = item.unitPriceCents;
        } else if (item.unitId && item.unitId !== item.baseUnitId) {
          unitPrice = await getUnitPrice(item.productId, item.unitId, product.priceCents, prisma);
        } else {
          unitPrice = product.priceCents;
        }

        const lineSubtotal   = Math.round(unitPrice * item.qty);
        // Strict "no discounts" config → force 0; else cap at line subtotal.
        const manualDiscount = forceZeroLineDiscount ? 0 : Math.min(item.discountCents, lineSubtotal);
        return { item, product, unitPrice, lineSubtotal, manualDiscount, lineAfterManual: lineSubtotal - manualDiscount };
      }),
    );

    // Promotion step — server-authoritative, only when the module is enabled.
    // Each promo resolves to an additional per-line discount that folds into the
    // existing math below. Disabled/no-match → zero, i.e. byte-identical to before.
    const promoEnabled = isModuleEnabled(appSettings?.moduleFlags, 'promotions');
    let promoLineDiscounts: Record<string, number> = {};
    const appliedPromos: AppliedPromo[] = [];
    if (promoEnabled) {
      const promoLines = preLines.map((pl, idx) => ({
        lineKey:              String(idx),
        productId:            pl.item.productId,
        categoryId:           pl.product.categoryId ?? null,
        brandId:              pl.product.brandId ?? null,
        qty:                  pl.item.qty,
        lineAfterManualCents: pl.lineAfterManual,
      }));
      const promoCartSubtotal = preLines.reduce((s, pl) => s + pl.lineAfterManual, 0);
      const activePromos = await promotionsService.getActiveInputs();
      const promoResult = computePromotions(promoLines, promoCartSubtotal, activePromos, new Date());
      promoLineDiscounts = promoResult.lineDiscounts;
      appliedPromos.push(...promoResult.applied);
    }

    // Pass 2 — fold promo discount into the line discount, then tax + cart totals.
    let cartSubtotalCents = 0;
    let grossTaxCents     = 0;

    const lineData = preLines.map((pl, idx) => {
      const promoDiscount = promoLineDiscounts[String(idx)] ?? 0;
      const lineDiscount  = Math.min(pl.manualDiscount + promoDiscount, pl.lineSubtotal); // still capped at line
      const lineAfterDisc = pl.lineSubtotal - lineDiscount;
      const lineTax       = Math.floor(lineAfterDisc * (pl.product.taxPercent / 100));

      cartSubtotalCents += lineAfterDisc;
      grossTaxCents     += lineTax;

      return {
        productId:      pl.item.productId,
        qty:            pl.item.qty,
        unitPriceCents: pl.unitPrice,
        taxPercent:     pl.product.taxPercent,
        discountCents:  lineDiscount,
        lineTotalCents: pl.lineSubtotal, // gross (unitPrice × qty, before discount)
        unitId:         pl.item.unitId ?? null,
        baseQty:        pl.item.baseQty !== pl.item.qty ? pl.item.baseQty : null,
      };
    });

    // Cart-level discount (re-derive from percent if provided, otherwise use cents).
    // Cart discount is always manual → forced to 0 when manual discount is off.
    const computedCartDiscount = !posAllowManual
      ? 0
      : cartDiscountPercent > 0
        ? Math.floor(cartSubtotalCents * cartDiscountPercent / 100)
        : Math.min(cartDiscountCents, cartSubtotalCents);

    const taxableAmount = cartSubtotalCents - computedCartDiscount;

    // Scale tax proportionally across the cart discount
    const effectiveTaxCents = cartSubtotalCents > 0
      ? Math.floor(grossTaxCents * taxableAmount / cartSubtotalCents)
      : 0;

    // Gross subtotal = Σ (unitPrice × qty) across all lines, before any discounts
    const grossSubtotalCents = lineData.reduce((s, l) => s + l.lineTotalCents, 0);
    const subtotalCents = grossSubtotalCents;
    const taxCents      = effectiveTaxCents;
    let   discountCents = computedCartDiscount;
    let   totalCents    = taxableAmount + effectiveTaxCents;

    // ── Loyalty: redeem points as a discount + compute points earned ──────────
    // Only when the module is enabled AND a customer is attached. Walk-in / off /
    // config-disabled → redeemedPoints = earnedPoints = 0 → byte-identical to before.
    const loyaltyEnabled = isModuleEnabled(appSettings?.moduleFlags, 'loyalty');
    let redeemedPoints = 0;
    let earnedPoints   = 0;
    if (loyaltyEnabled && customerId) {
      const cfg = await loyaltyService.getConfig();
      if (cfg.isEnabled) {
        const rates = {
          isEnabled: cfg.isEnabled, pointsPerAmount: cfg.pointsPerAmount,
          pointValueCents: cfg.pointValueCents, minRedeemPoints: cfg.minRedeemPoints,
        };
        if (redeemPoints > 0) {
          const cust = await prisma.customer.findUnique({ where: { id: customerId }, select: { loyaltyPoints: true } });
          const plan = planRedemption(redeemPoints, cust?.loyaltyPoints ?? 0, totalCents, rates);
          if (plan.error) throw new HttpError(400, plan.error);
          redeemedPoints = plan.points;
          discountCents += plan.discountCents;
          totalCents    -= plan.discountCents;
        }
        earnedPoints = pointsForAmount(totalCents, rates); // earn on the net amount paid
      }
    }
    // Split (cash + credit): cash portion paid now; otherwise full credit = 0 paid, all else = paid in full.
    const isSplitCredit = splitCashCents > 0;
    const paidCents     = isSplitCredit
      ? Math.min(splitCashCents, totalCents)
      : (paymentMethod === 'CREDIT' ? 0 : totalCents);
    // Only set paymentStatus on the split path — leave CASH / full-CREDIT flows untouched (DB default UNPAID).
    const splitPaymentStatus: 'PARTIAL' | 'PAID' | null = isSplitCredit
      ? (paidCents >= totalCents ? 'PAID' : 'PARTIAL')
      : null;
    const number     = await generateSaleNumber();

    // Verify an open shift exists for this user+warehouse before entering the transaction
    const shift = await prisma.posShift.findFirst({
      where: { userId, warehouseId, status: 'OPEN' },
    });
    if (!shift) {
      throw new HttpError(400, 'No open shift. Please open a shift before making sales.');
    }

    // Fetch warehouse name for receipt
    const warehouseRow = await prisma.warehouse.findUnique({
      where: { id: warehouseId },
      select: { name: true },
    });
    const warehouseName = warehouseRow?.name ?? '';

    logger.info({ number, totalCents, items: items.length, shiftId: shift.id }, 'POS checkout starting');

    const sale = await prisma.$transaction(async (tx) => {
      const created = await tx.sale.create({
        data: {
          number,
          warehouseId,
          customerId,
          isPos: true,
          status: 'CONFIRMED',
          paymentMethod,
          subtotalCents,
          taxCents,
          discountCents,
          totalCents,
          paidCents,
          pointsEarned:   earnedPoints,
          pointsRedeemed: redeemedPoints,
          ...(splitPaymentStatus ? { paymentStatus: splitPaymentStatus } : {}),
          note: isStaffSale ? `[Staff Sale]${note ? ` ${note}` : ''}` : (note ?? null),
          createdById: userId,
          shiftId: shift.id,
          lines: { create: lineData },
        },
        include: {
          lines: { include: { product: { select: { id: true, name: true, sku: true, receiptName: true, unit: { select: { shortCode: true, name: true } } } }, unit: { select: { shortCode: true, name: true } } } },
          customer: { select: { id: true, name: true, phone: true } },
          createdBy: { select: { fullName: true } },
        },
      });

      // Record applied promotions (audit trail) + bump usage counters.
      if (appliedPromos.length > 0) {
        await tx.salePromotion.createMany({
          data: appliedPromos.map((a) => ({
            saleId: created.id, promotionId: a.promotionId, label: a.label, discountCents: a.discountCents,
          })),
        });
        for (const a of appliedPromos) {
          await tx.promotion.update({ where: { id: a.promotionId }, data: { timesUsed: { increment: 1 } } });
        }
      }

      // Loyalty ledger — redeem then earn, update customer balance (module-gated).
      if (customerId && (redeemedPoints > 0 || earnedPoints > 0)) {
        await loyaltyService.recordForSale(tx, { customerId, saleId: created.id, redeemedPoints, earnedPoints });
      }

      // Stock deduction — always in base units.
      // Lock the row first (SELECT FOR UPDATE) so concurrent checkouts for the same
      // product+warehouse are serialised and cannot both pass the qty check.
      for (const item of resolvedItems) {
        const locked = await tx.$queryRaw<{ qty: number }[]>`
          SELECT qty::float AS qty FROM "Stock"
          WHERE "productId" = ${item.productId} AND "warehouseId" = ${warehouseId}
          FOR UPDATE
        `;
        const currentQty = locked[0]?.qty ?? 0;
        if (currentQty < item.baseQty) {
          const product = products.find((p) => p.id === item.productId)!;
          throw new HttpError(
            400,
            `Insufficient stock for "${product.name}". Available: ${currentQty}, requested: ${item.baseQty}`,
          );
        }

        // Deduct from StockBatch rows in FEFO order (earliest expiry first).
        // If no batch rows exist (pre-batch-tracking stock), this is a no-op and
        // returns 0 units deducted.
        const deductedFromBatches = await deductBatchesFEFO(
          tx, item.productId, warehouseId, item.baseQty, expiredStockPolicy !== 'BLOCK',
        );

        if (deductedFromBatches > 0) {
          // Batch-tracked product: batches are the source of truth. Recompute the
          // aggregate Stock.qty from the (already-decremented) batch sum so it can
          // never go negative. (Replaces the old `decrement` upsert whose `create`
          // branch wrote a negative qty — a bug.)
          await recomputeStockQty(tx, item.productId, warehouseId);
        } else {
          // No batch rows existed (pre-batch-tracking stock) — FEFO was a no-op,
          // so the batch sum is 0 and recompute would WIPE legitimate stock.
          // Keep the legacy aggregate decrement, floored at 0.
          const cur = await tx.stock.findUnique({
            where:  { productId_warehouseId: { productId: item.productId, warehouseId } },
            select: { qty: true },
          });
          const newQty = Math.max(0, Number(cur?.qty ?? 0) - Number(item.baseQty));
          await tx.stock.upsert({
            where:  { productId_warehouseId: { productId: item.productId, warehouseId } },
            update: { qty: newQty },
            create: { productId: item.productId, warehouseId, qty: 0 },
          });
        }
        await tx.stockMovement.create({
          data: {
            productId: item.productId,
            warehouseId,
            type:    'SALE_OUT',
            qty:     -item.baseQty,
            refType: 'Sale',
            refId:   created.id,
            note:    `POS checkout ${number}`,
          },
        });
      }

      // Delete draft if provided
      if (draftId) {
        await tx.posDraft.deleteMany({ where: { id: draftId, createdById: userId } });
      }

      // Increment shift running totals in real-time
      await tx.posShift.update({
        where: { id: shift.id },
        data: {
          totalSalesCents: { increment: totalCents },
          saleCount:       { increment: 1 },
        },
      });

      return created;
    });

    logger.info({ saleId: sale.id, number: sale.number }, 'POS checkout completed');

    return {
      warnings: checkoutWarnings.length > 0 ? checkoutWarnings : undefined,
      promotions: appliedPromos.length > 0 ? appliedPromos : undefined,
      loyalty: (redeemedPoints > 0 || earnedPoints > 0)
        ? { earned: earnedPoints, redeemed: redeemedPoints }
        : undefined,
      receipt: {
        id:            sale.id,
        number:        sale.number,
        date:          sale.date,
        cashier:       sale.createdBy.fullName,
        customer:      sale.customer ?? null,
        paymentMethod: sale.paymentMethod,
        isCreditSale:  paymentMethod === 'CREDIT',
        isStaffSale,
        warehouseName,
        lines: sale.lines.map((l) => ({
          product:        l.product,
          qty:            Number(l.qty),
          unitPriceCents: l.unitPriceCents,
          taxPercent:     l.taxPercent,
          discountCents:  l.discountCents,
          lineTotalCents: l.lineTotalCents,
          unitShortCode:  l.unit?.shortCode ?? l.product.unit?.shortCode ?? '',
        })),
        subtotalCents:  sale.subtotalCents,
        taxCents:       sale.taxCents,
        discountCents:  sale.discountCents,
        totalCents:     sale.totalCents,
        paidCents:      sale.paidCents,
      },
    };
  },

  // ── Receipt ────────────────────────────────────────────────────────────────

  async getReceipt(id: string) {
    const sale = await prisma.sale.findFirst({
      where: { id, isPos: true },
      include: {
        lines: { include: { product: { select: { id: true, name: true, sku: true, receiptName: true, unit: { select: { shortCode: true, name: true } } } }, unit: { select: { shortCode: true, name: true } } } },
        customer: { select: { id: true, name: true, phone: true } },
        createdBy: { select: { fullName: true } },
        warehouse: { select: { name: true } },
      },
    });
    if (!sale) throw new HttpError(404, 'Receipt not found');
    // Same shape as checkout's `receipt` payload so the POS ReceiptModal can
    // re-open a past sale (Reprint Last Receipt) with no client special-casing.
    return {
      id:            sale.id,
      number:        sale.number,
      date:          sale.date,
      cashier:       sale.createdBy?.fullName ?? '',
      customer:      sale.customer ?? null,
      paymentMethod: sale.paymentMethod,
      isCreditSale:  sale.paymentMethod === 'CREDIT',
      isStaffSale:   sale.note?.startsWith('[Staff Sale]') ?? false,
      warehouseName: sale.warehouse?.name ?? '',
      lines: sale.lines.map((l) => ({
        product:        l.product,
        qty:            Number(l.qty),
        unitPriceCents: l.unitPriceCents,
        taxPercent:     l.taxPercent,
        discountCents:  l.discountCents,
        lineTotalCents: l.lineTotalCents,
        unitShortCode:  l.unit?.shortCode ?? l.product.unit?.shortCode ?? '',
      })),
      subtotalCents: sale.subtotalCents,
      taxCents:      sale.taxCents,
      discountCents: sale.discountCents,
      totalCents:    sale.totalCents,
      paidCents:     sale.paidCents,
    };
  },

  // ── Sales history ──────────────────────────────────────────────────────────

  async listSales(input: ListSalesInput) {
    const { page, pageSize, search, from, to } = input;
    const skip = (page - 1) * pageSize;

    const where = {
      isPos: true,
      ...(search ? {
        OR: [
          { number:   { contains: search, mode: 'insensitive' as const } },
          { customer: { name: { contains: search, mode: 'insensitive' as const } } },
        ],
      } : {}),
      ...(from || to ? { date: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
    };

    const [total, data] = await prisma.$transaction([
      prisma.sale.count({ where }),
      prisma.sale.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          number: true,
          date: true,
          totalCents: true,
          paidCents: true,
          paymentMethod: true,
          customer: { select: { name: true } },
          createdBy: { select: { fullName: true } },
          _count: { select: { lines: true } },
        },
      }),
    ]);

    return { total, page, pageSize, data };
  },

  // ── Drafts ────────────────────────────────────────────────────────────────

  async listDrafts(userId: string) {
    return prisma.posDraft.findMany({
      where: { createdById: userId },
      include: {
        customer:  { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true, code: true } },
        items: {
          include: {
            product: { select: { id: true, name: true, sku: true, priceCents: true, unit: { select: { shortCode: true } } } },
          },
        },
      },
      orderBy: { updatedAt: 'desc' },
    });
  },

  async saveDraft(input: SaveDraftInput, userId: string) {
    const { id, label, warehouseId, customerId, paymentMethod, discountCents, note, items } = input;

    const draftData = {
      label:         label ?? null,
      warehouseId,
      customerId:    customerId ?? null,
      paymentMethod,
      discountCents,
      note:          note ?? null,
      createdById:   userId,
    };

    const itemsData = items.map((i) => ({
      productId:      i.productId,
      qty:            i.qty,
      unitPriceCents: i.unitPriceCents,
    }));

    if (id) {
      // Update existing draft — replace all items
      const existing = await prisma.posDraft.findFirst({ where: { id, createdById: userId } });
      if (!existing) throw new HttpError(404, 'Draft not found');

      return prisma.$transaction(async (tx) => {
        await tx.posDraftItem.deleteMany({ where: { draftId: id } });
        return tx.posDraft.update({
          where: { id },
          data: {
            ...draftData,
            items: { create: itemsData },
          },
          include: {
            customer:  { select: { id: true, name: true } },
            warehouse: { select: { id: true, name: true, code: true } },
            items: { include: { product: { select: { id: true, name: true, sku: true, priceCents: true, unit: { select: { shortCode: true } } } } } },
          },
        });
      });
    }

    // Create new draft
    return prisma.posDraft.create({
      data: {
        ...draftData,
        items: { create: itemsData },
      },
      include: {
        customer:  { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true, code: true } },
        items: { include: { product: { select: { id: true, name: true, sku: true, priceCents: true, unit: { select: { shortCode: true } } } } } },
      },
    });
  },

  async deleteDraft(id: string, userId: string) {
    const existing = await prisma.posDraft.findFirst({ where: { id, createdById: userId } });
    if (!existing) throw new HttpError(404, 'Draft not found');
    await prisma.posDraft.delete({ where: { id } });
    return { success: true };
  },

  // ── Shift management ──────────────────────────────────────────────────────

  async openShift(userId: string, input: OpenShiftInput) {
    const openingCashCents = Math.round(input.openingCash * 100);
    const existing = await prisma.posShift.findFirst({
      where: { userId, warehouseId: input.warehouseId, status: 'OPEN' },
    });
    if (existing) throw new HttpError(409, 'A shift is already open for this warehouse');

    const shift = await prisma.posShift.create({
      data: { userId, warehouseId: input.warehouseId, openingCashCents, status: 'OPEN' },
      include: {
        user:      { select: { id: true, fullName: true } },
        warehouse: { select: { id: true, name: true, code: true } },
      },
    });
    logger.info({ shiftId: shift.id, userId, warehouseId: input.warehouseId }, 'POS shift opened');
    return shift;
  },

  async getCurrentShift(userId: string, warehouseId?: string) {
    return prisma.posShift.findFirst({
      where: {
        userId,
        status: 'OPEN',
        ...(warehouseId ? { warehouseId } : {}),
      },
      include: {
        user:      { select: { id: true, fullName: true } },
        warehouse: { select: { id: true, name: true, code: true } },
      },
    });
  },

  async closeShift(userId: string, input: CloseShiftInput) {
    const closingCashCents = Math.round(input.closingCash * 100);
    const shift = await prisma.posShift.findFirst({
      where: { id: input.shiftId, userId, status: 'OPEN' },
    });
    if (!shift) throw new HttpError(404, 'No open shift found');

    // Aggregate linked sales by payment method
    const salesByMethod = await prisma.$queryRaw<
      { paymentMethod: string; total: bigint; cnt: bigint }[]
    >`
      SELECT "paymentMethod", SUM("totalCents")::bigint AS total, COUNT(*)::bigint AS cnt
      FROM "Sale"
      WHERE "shiftId" = ${shift.id} AND status = 'CONFIRMED'
      GROUP BY "paymentMethod"
    `;

    let cashSalesCents    = 0;
    let cardSalesCents    = 0;
    let bankTransferCents = 0;
    let qrPayCents        = 0;
    let creditSalesCents  = 0;
    let totalSalesCents   = 0;
    let saleCount         = 0;

    for (const row of salesByMethod) {
      const amount = Number(row.total);
      const count  = Number(row.cnt);
      totalSalesCents += amount;
      saleCount       += count;
      switch (row.paymentMethod) {
        case 'CASH':          cashSalesCents    = amount; break;
        case 'CARD':          cardSalesCents    = amount; break;
        case 'BANK_TRANSFER': bankTransferCents = amount; break;
        case 'QR_PAY':        qrPayCents        = amount; break;
        case 'CREDIT':        creditSalesCents  = amount; break;
      }
    }

    const expectedCashCents = shift.openingCashCents + cashSalesCents;
    const varianceCents     = closingCashCents - expectedCashCents;

    const closed = await prisma.posShift.update({
      where: { id: shift.id },
      data: {
        closedAt: new Date(),
        status:   'CLOSED',
        closingCashCents,
        cashSalesCents,
        cardSalesCents,
        bankTransferCents,
        qrPayCents,
        creditSalesCents,
        totalSalesCents,
        saleCount,
        expectedCashCents,
        varianceCents,
        note: input.note ?? null,
      },
      include: {
        user:      { select: { id: true, fullName: true } },
        warehouse: { select: { id: true, name: true, code: true } },
      },
    });
    logger.info({ shiftId: shift.id, userId, totalSalesCents, varianceCents }, 'POS shift closed');
    return closed;
  },

  async forceCloseShift(adminUserId: string, shiftId: string, input: ForceCloseShiftInput) {
    const shift = await prisma.posShift.findFirst({
      where: { id: shiftId, status: 'OPEN' },
    });
    if (!shift) throw new HttpError(404, 'Shift not found or already closed');

    // Aggregate linked sales same as closeShift
    const salesByMethod = await prisma.$queryRaw<
      { paymentMethod: string; total: bigint; cnt: bigint }[]
    >`
      SELECT "paymentMethod", SUM("totalCents")::bigint AS total, COUNT(*)::bigint AS cnt
      FROM "Sale"
      WHERE "shiftId" = ${shiftId} AND status = 'CONFIRMED'
      GROUP BY "paymentMethod"
    `;

    let cashSalesCents    = 0;
    let cardSalesCents    = 0;
    let bankTransferCents = 0;
    let qrPayCents        = 0;
    let creditSalesCents  = 0;
    let totalSalesCents   = 0;
    let saleCount         = 0;

    for (const row of salesByMethod) {
      const amount = Number(row.total);
      const count  = Number(row.cnt);
      totalSalesCents += amount;
      saleCount       += count;
      switch (row.paymentMethod) {
        case 'CASH':          cashSalesCents    = amount; break;
        case 'CARD':          cardSalesCents    = amount; break;
        case 'BANK_TRANSFER': bankTransferCents = amount; break;
        case 'QR_PAY':        qrPayCents        = amount; break;
        case 'CREDIT':        creditSalesCents  = amount; break;
      }
    }

    const expectedCashCents = shift.openingCashCents + cashSalesCents;

    const closed = await prisma.posShift.update({
      where: { id: shiftId },
      data: {
        closedAt:         new Date(),
        status:           'CLOSED',
        cashSalesCents,
        cardSalesCents,
        bankTransferCents,
        qrPayCents,
        creditSalesCents,
        totalSalesCents,
        saleCount,
        expectedCashCents,
        forceClosedById:  adminUserId,
        note:             input.note ?? null,
      },
      include: {
        user:          { select: { id: true, fullName: true } },
        warehouse:     { select: { id: true, name: true, code: true } },
        forceClosedBy: { select: { id: true, fullName: true } },
      },
    });
    logger.info({ shiftId, adminUserId, totalSalesCents }, 'POS shift force-closed');
    return closed;
  },

  async listShifts(input: ListShiftsInput) {
    const { page, pageSize, warehouseId, userId, status, from, to } = input;
    const skip = (page - 1) * pageSize;

    const where = {
      ...(warehouseId ? { warehouseId }         : {}),
      ...(userId      ? { userId }               : {}),
      ...(status      ? { status }               : {}),
      ...(from || to  ? { openedAt: {
        ...(from ? { gte: from } : {}),
        ...(to   ? { lte: to }   : {}),
      }} : {}),
    };

    const [total, data] = await prisma.$transaction([
      prisma.posShift.count({ where }),
      prisma.posShift.findMany({
        where,
        skip,
        take:    pageSize,
        orderBy: { openedAt: 'desc' },
        include: {
          user:          { select: { id: true, fullName: true } },
          warehouse:     { select: { id: true, name: true, code: true } },
          forceClosedBy: { select: { id: true, fullName: true } },
        },
      }),
    ]);

    return { total, page, pageSize, data };
  },

  async getShift(id: string) {
    const shift = await prisma.posShift.findFirst({
      where: { id },
      include: {
        user:          { select: { id: true, fullName: true } },
        warehouse:     { select: { id: true, name: true, code: true } },
        forceClosedBy: { select: { id: true, fullName: true } },
        sales: {
          where: { status: { not: 'CANCELLED' } },
          select: {
            id: true, number: true, totalCents: true, paymentMethod: true,
            createdAt: true,
            customer:  { select: { name: true } },
          },
          orderBy: { createdAt: 'asc' },
        },
      },
    });
    if (!shift) throw new HttpError(404, 'Shift not found');
    return shift;
  },

  // ── Customer credit info ───────────────────────────────────────────────────

  async getCustomerCredit(customerId: string) {
    const customer = await prisma.customer.findUnique({ where: { id: customerId } });
    if (!customer) throw new HttpError(404, 'Customer not found');
    if (!customer.creditEnabled) return { creditEnabled: false, balance: 0, limit: 0, available: 0, alertPct: 80 };

    const balance = await getCustomerCreditBalance(customerId);
    const limit   = customer.creditLimitCents;
    const available = limit > 0 ? Math.max(0, limit - balance) : Infinity;

    return {
      creditEnabled:   true,
      balance,
      limit,
      available:       limit > 0 ? available : -1, // -1 = unlimited
      alertPct:        customer.creditAlertPct,
      settleDays:      customer.creditSettleDays,
      isNearLimit:     limit > 0 && balance >= Math.round(limit * (customer.creditAlertPct / 100)),
      isOverLimit:     limit > 0 && balance >= limit,
    };
  },
};
