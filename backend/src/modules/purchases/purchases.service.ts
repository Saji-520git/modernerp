import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';
import { convertToBaseUnit } from '../../utils/unit-converter.js';
import { recomputeStockQty, settleShortfall } from '../../utils/stock-utils.js';
import { computeWAC } from '../../utils/cost.js';
import { findOrCreateBatch } from '../../utils/batch-matching.js';
import { recordStockMovement } from '../../utils/stock-movement.js';
import { createFullReceiptRecord } from './purchase-receipt.service.js';
import type { CreatePurchaseInput, UpdatePurchaseInput, ListPurchasesInput, FromAlertsInput } from './purchases.schema.js';
import { nextDocNumber, withNumberRetry } from '../../utils/doc-number.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

// Highest issued + 1, never a row count. Purchases soft-delete, so a count
// drops while the number it belonged to stays taken — the next PO would reuse
// it and die on the unique index. See utils/doc-number.ts.
async function generatePONumber(): Promise<string> {
  return nextDocNumber(prisma.purchase, `PO-${new Date().getFullYear()}-`);
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const purchaseService = {
  // ── Suppliers dropdown ────────────────────────────────────────────────────

  listSuppliers: async () => {
    return prisma.supplier.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, phone: true, email: true },
    });
  },

  // ── Products dropdown (for PO line items) ─────────────────────────────────

  listProducts: async () => {
    return prisma.product.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        sku: true,
        costCents: true,
        taxPercent: true,
        defaultSupplierId: true,
        unitId: true,
        baseUnitId: true,
        purchaseUnitId: true,
        unit:         { select: { shortCode: true } },
        baseUnit:     { select: { id: true, name: true, shortCode: true } },
        purchaseUnit: { select: { id: true, name: true, shortCode: true } },
        unitConversions: {
          where: { isActive: true },
          select: {
            fromUnitId: true, toUnitId: true, conversionQty: true, priceCents: true,
            fromUnit: { select: { id: true, name: true, shortCode: true } },
            toUnit:   { select: { id: true, name: true, shortCode: true } },
          },
        },
      },
    });
  },

  // ── List purchase orders ───────────────────────────────────────────────────

  listPurchases: async (input: ListPurchasesInput) => {
    const { search, status, supplierId, from, to, page, pageSize } = input;

    const where = {
      deletedAt: null,
      ...(status && { status }),
      ...(supplierId && { supplierId }),
      ...(from || to ? {
        date: {
          ...(from ? { gte: new Date(from) } : {}),
          ...(to ? { lte: new Date(to + 'T23:59:59Z') } : {}),
        },
      } : {}),
      ...(search && {
        OR: [
          { number: { contains: search, mode: 'insensitive' as const } },
          { supplier: { name: { contains: search, mode: 'insensitive' as const } } },
          { note: { contains: search, mode: 'insensitive' as const } },
        ],
      }),
    };

    const [total, data] = await prisma.$transaction([
      prisma.purchase.count({ where }),
      prisma.purchase.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          supplier:  { select: { id: true, name: true } },
          warehouse: { select: { id: true, name: true, code: true } },
          createdBy: { select: { id: true, fullName: true } },
          _count:    { select: { lines: true } },
          // Confirmed returns (Option B) — used to subtract return credit from the
          // displayed per-PO outstanding (list column + payment dropdown) without
          // ever mutating totalCents. Mirrors the getPurchase detail include.
          purchaseReturns: {
            where: { status: 'CONFIRMED', isActive: true },
            select: { totalCents: true },
          },
        },
        // paymentStatus is a scalar on Purchase — returned automatically
      }),
    ]);

    return { total, page, pageSize, data };
  },

  // ── Get single PO with all lines ──────────────────────────────────────────

  getPurchase: async (id: string) => {
    const purchase = await (prisma as any).purchase.findFirst({
      where: { id, deletedAt: null },
      include: {
        supplier: true,
        warehouse: { select: { id: true, name: true, code: true } },
        createdBy: { select: { id: true, fullName: true } },
        closedShortBy: { select: { id: true, fullName: true } },
        lines: {
          include: {
            product: {
              select: {
                id: true,
                name: true,
                sku: true,
                isBatchTracked: true,
                unit: { select: { shortCode: true } },
              },
            },
            // Purchased unit for this line (null = base unit) — used to show the
            // correct unit label on the PO detail modal instead of the base unit.
            unit: { select: { id: true, name: true, shortCode: true } },
          },
        },
        supplierPayments: {
          where: { isActive: true },
          orderBy: { createdAt: 'asc' },
          include: {
            createdByUser: { select: { id: true, fullName: true } },
          },
        },
        receipts: {
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
        },
        // Confirmed returns (Option B) — used to subtract return credit from the
        // displayed per-PO balance without ever mutating totalCents.
        purchaseReturns: {
          where: { status: 'CONFIRMED', isActive: true },
          select: { totalCents: true },
        },
      },
    });
    if (!purchase) throw new HttpError(404, 'Purchase order not found');
    return purchase;
  },

  // ── Create draft PO ───────────────────────────────────────────────────────

  createPurchase: async (input: CreatePurchaseInput, userId: string) => {
    // Validate supplier + warehouse exist
    const [supplier, warehouse] = await Promise.all([
      prisma.supplier.findUnique({ where: { id: input.supplierId } }),
      prisma.warehouse.findUnique({ where: { id: input.warehouseId } }),
    ]);
    if (!supplier) throw new HttpError(400, 'Supplier not found');
    if (!warehouse) throw new HttpError(400, 'Warehouse not found');
    if (!warehouse.isActive) throw new HttpError(400, 'Warehouse is not active');

    // Validate all products exist
    const productIds = [...new Set(input.lines.map((l) => l.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
    });
    if (products.length !== productIds.length) {
      throw new HttpError(400, 'One or more products not found or inactive');
    }

    // CHUNK 23d (v1.0.73): defense-in-depth COUNT-integer guard at DRAFT create.
    // No unit conversion happens here (qty is stored in the line's entry unit),
    // so we can only safely mirror confirmPurchase's base-unit check (chunk 23a)
    // for lines whose qty is ALREADY in base units — i.e. unitId is null. For
    // those lines create-time qty === confirm-time baseQty exactly, so the guard
    // is a zero-false-positive early mirror. Lines with a non-null unitId are
    // deferred to the confirm guard (23a), which runs the conversion first.
    // Purely additive: validation only, no change to line/total computation.
    const createLineMeta = await prisma.product.findMany({
      where: { id: { in: productIds } },
      select: {
        id: true,
        baseUnit: { select: { type: true, allowDecimal: true } },
        unit:     { select: { type: true, allowDecimal: true } },
      },
    });
    const createLineMetaMap = new Map(createLineMeta.map((p) => [p.id, p]));
    for (const line of input.lines) {
      if (line.unitId) continue; // qty not in base units; confirm guard (23a) authoritative
      const meta = createLineMetaMap.get(line.productId);
      const unitMeta = meta?.baseUnit ?? meta?.unit;
      if (unitMeta && (unitMeta.type === 'COUNT' || unitMeta.allowDecimal === false)) {
        if (!Number.isInteger(Number(line.qty))) {
          throw new HttpError(
            400,
            `Quantity for count-only products must be a whole number; got ${Number(line.qty)}`,
          );
        }
      }
    }

    // Compute line and order totals — no tax per business decision
    const computedLines = input.lines.map((line) => {
      const subtotal = Math.round(Number(line.qty) * line.unitCostCents);
      return { ...line, subtotalCents: subtotal, taxLineCents: 0, lineTotalCents: subtotal };
    });

    const subtotalCents = computedLines.reduce((s, l) => s + l.subtotalCents, 0);
    const taxCents = 0;
    const totalCents = subtotalCents;

    // The number is issued INSIDE the retry, as late as possible. Two writers
    // can read the same maximum before either has committed; the database
    // settles that on the unique index and the retry takes the next free
    // number rather than failing the document. Mirrors sales and pos.
    const purchase = await withNumberRetry(async () => prisma.purchase.create({
      data: {
        number: await generatePONumber(),
        supplierId: input.supplierId,
        warehouseId: input.warehouseId,
        date: input.date ? new Date(input.date) : new Date(),
        note: input.note,
        subtotalCents,
        taxCents,
        totalCents,
        status: 'DRAFT',
        createdById: userId,
        lines: {
          create: computedLines.map((l) => ({
            productId: l.productId,
            unitId: l.unitId ?? null,
            qty: l.qty,
            unitCostCents: l.unitCostCents,
            taxPercent: l.taxPercent,
            lineTotalCents: l.lineTotalCents,
            expiryDate: l.expiryDate ? new Date(l.expiryDate) : null,
          })),
        },
      },
      include: {
        supplier: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true, code: true } },
        lines: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
          },
        },
      },
    }));

    return purchase;
  },

  // ── Confirm PO → adds stock ────────────────────────────────────────────────

  // receiveMode: 'FULL' (default) = confirm AND receive all stock now at PO cost
  // (weighted-average) — the fast walk-in flow, behaviour-identical to before.
  // 'AWAIT_GRN' = confirm the order only (commitment); no stock/cost/receipt —
  // goods are received later via GRN with their actual cost + damage.
  confirmPurchase: async (id: string, userId?: string, receiveMode: 'FULL' | 'AWAIT_GRN' = 'FULL') => {
    const purchase = await (prisma as any).purchase.findFirst({
      where: { id, deletedAt: null },
      include: { lines: true },
    });
    if (!purchase) throw new HttpError(404, 'Purchase order not found');
    if (purchase.status !== 'DRAFT') {
      throw new HttpError(409, `Cannot confirm a ${purchase.status.toLowerCase()} order`);
    }

    await prisma.$transaction(async (tx) => {
      // 1. Mark as confirmed
      await tx.purchase.update({
        where: { id },
        data: { status: 'CONFIRMED' },
      });

      // AWAIT_GRN: stop here — no stock, no cost change, receivedQty stays 0,
      // deliveryStatus stays PENDING. Stock enters later via the GRN receipt.
      if (receiveMode === 'FULL') {
      // Pre-fetch every line's product once (avoids a findUnique per line inside the loop)
      const lineProductIds = purchase.lines.map((l: any) => l.productId);
      const lineProducts = await tx.product.findMany({
        where: { id: { in: lineProductIds } },
        select: {
          id: true,
          baseUnitId: true,
          unitId: true,
          priceCents: true,
          baseUnit: { select: { type: true, allowDecimal: true } },
          unit:     { select: { type: true, allowDecimal: true } },
        },
      });
      const lineProductMap = new Map(lineProducts.map((p) => [p.id, p]));

      // 2. For each line: resolve base qty, add stock + record movement + update cost
      for (const line of purchase.lines) {
        // Resolve how many base units this line represents
        let baseQty: Decimal;
        if (line.unitId) {
          const product = lineProductMap.get(line.productId);
          if (!product) throw new Error(`Product ${line.productId} not found`);
          const baseUnitId = product?.baseUnitId ?? product?.unitId ?? '';
          if (line.unitId !== baseUnitId) {
            const result = await convertToBaseUnit(
              line.productId,
              line.unitId,
              new Decimal(line.qty.toString()),
              tx as any,
            );
            baseQty = result.baseQty;
          } else {
            baseQty = new Decimal(line.qty.toString());
          }
        } else {
          baseQty = new Decimal(line.qty.toString());
        }

        // CHUNK 23a (v1.0.73): enforce integer for COUNT products on purchase
        // confirmation. Purchase lines DO have unit conversion (line.unitId can
        // differ from base), so the check fires on POST-conversion baseQty per
        // line. Resolves count-ness from `baseUnit ?? unit` — matches the
        // codebase convention and protects null-baseUnit products (43% of ACM
        // data). Mirrors chunks 9/10/20/21/22a. Note: baseQty is a Prisma
        // Decimal; Number.isInteger(Decimal) is always false, so coerce via
        // .toNumber(). The check sits inside the $transaction: an in-tx throw
        // rolls back safely with no partial-write risk (audit Task 11a).
        const confirmPurchaseLineMeta = lineProductMap.get(line.productId);
        const confirmPurchaseUnitMeta =
          confirmPurchaseLineMeta?.baseUnit ?? confirmPurchaseLineMeta?.unit;
        if (
          confirmPurchaseUnitMeta &&
          (confirmPurchaseUnitMeta.type === 'COUNT' ||
            confirmPurchaseUnitMeta.allowDecimal === false)
        ) {
          if (!Number.isInteger(baseQty.toNumber())) {
            throw new HttpError(
              400,
              `Quantity for count-only products must be a whole number; got ${baseQty.toNumber()}`,
            );
          }
        }

        // Derive the per-base-unit cost. The line stores the cost of ONE purchase
        // unit (e.g. 1 case @ Rs.62,500); stock is held in base units (e.g. boxes),
        // so the stored cost must be divided by the conversion factor.
        //   factor          = baseQty / qty   (e.g. 25 boxes / 1 case = 25)
        //   costPerBaseCents = unitCostCents / factor   (62,500 / 25 = 2,500)
        const lineQty = new Decimal(line.qty.toString());
        const factor = lineQty.isZero() ? new Decimal(1) : baseQty.div(lineQty);
        const costPerBaseCents = factor.isZero()
          ? line.unitCostCents
          : Math.round(line.unitCostCents / factor.toNumber());

        // Create PURCHASE_IN movement
        await recordStockMovement(tx, {
          productId: line.productId,
          warehouseId: purchase.warehouseId,
          type: 'PURCHASE_IN',
          qty: Number(baseQty),
          refType: 'Purchase',
          refId: id,
          note: `PO ${purchase.number}`,
        });

        // G1: weighted-average cost. Blend this receipt into the product's running
        // average. Read on-hand qty (all warehouses) + current avg FRESH — the
        // per-line recomputeStockQty below keeps these correct even when the same
        // product appears on multiple PO lines. Values read here are pre-receipt.
        const onHandAgg = await tx.stock.aggregate({
          where: { productId: line.productId },
          _sum:  { qty: true },
        });
        const existingQty      = Number(onHandAgg._sum.qty ?? 0);
        const curProd          = await tx.product.findUnique({
          where:  { id: line.productId },
          select: { costCents: true },
        });
        const existingAvgCents = curProd?.costCents ?? 0;
        const newAvgCents      = computeWAC(existingQty, existingAvgCents, baseQty.toNumber(), costPerBaseCents);

        // Update product's weighted-average cost + last cost + auto-reactivate if
        // inactive (physical stock means it should be sellable regardless of prior status).
        await tx.product.update({
          where: { id: line.productId },
          data: { costCents: newAvgCents, lastCostCents: costPerBaseCents, isActive: true },
        });

        // Create stock batch row — stamped with its own per-base-unit cost (G1),
        // selling price, and supplier; tracks expiry per batch. This quick
        // "confirm PO" path has no per-line form, so the selling price defaults
        // to the product's current price (customizing it happens via the
        // explicit GRN "Record Delivery" form instead). Merges into an existing
        // open batch when cost+price+supplier already match.
        const confirmSellPriceCents = confirmPurchaseLineMeta?.priceCents ?? 0;
        await findOrCreateBatch(tx, {
          productId:         line.productId,
          warehouseId:       purchase.warehouseId,
          purchaseLineId:    line.id,
          qty:               baseQty,
          unitCostCents:     costPerBaseCents,
          sellingPriceCents: confirmSellPriceCents,
          supplierId:        purchase.supplierId,
          expiryDate:        (line as any).expiryDate ?? null,
        });

        // Recompute aggregate Stock.qty from the batch rows. MUST run AFTER the
        // StockBatch.create above so the new batch is included in the sum. This
        // replaces the previous direct `increment` upsert and guarantees the
        // aggregate stays in lock-step with the batch source of truth (never
        // negative).
        await recomputeStockQty(tx, line.productId, purchase.warehouseId);

        // Pay off anything the counter sold past zero before this delivery.
        // Consumes the batch just created, through the ordinary FEFO path, so
        // the goods never appear on the shelf twice. No-ops when nothing is
        // owed, which is every case unless allowNegativeStock is on.
        await settleShortfall(tx, line.productId, purchase.warehouseId);

        // Set receivedQty INSIDE the confirm transaction so a purchase return is
        // always possible even if the post-transaction GRN record (createFullReceiptRecord)
        // fails. createFullReceiptRecord later sets the same absolute value — idempotent.
        await tx.purchaseLine.update({
          where: { id: line.id },
          data:  { receivedQty: line.qty },
        });
      }
      } // end if (receiveMode === 'FULL')
    });

    // ── FULL mode: create the GRN document for the auto full delivery.
    //    AWAIT_GRN records no receipt here — the user files GRN(s) manually.
    if (receiveMode === 'FULL' && userId) {
      await createFullReceiptRecord(id, purchase.lines, purchase.warehouseId, userId);
    }

    return prisma.purchase.findUnique({
      where: { id },
      include: {
        supplier: { select: { id: true, name: true } },
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
      },
    });
  },

  // ── Cancel PO (DRAFT only) ────────────────────────────────────────────────

  cancelPurchase: async (id: string) => {
    const purchase = await (prisma as any).purchase.findFirst({ where: { id, deletedAt: null } });
    if (!purchase) throw new HttpError(404, 'Purchase order not found');
    if (purchase.status !== 'DRAFT') {
      throw new HttpError(409, `Cannot cancel a ${purchase.status.toLowerCase()} order`);
    }
    return prisma.purchase.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  },

  // ── Close short (accept a shortfall and finish the order) ─────────────────
  //
  // A PO only reaches DELIVERED when every ordered unit has been received. Any
  // shortfall the supplier never makes good — damaged goods not replaced, a
  // discontinued line — would otherwise leave the order on PARTIAL forever.
  // Closing short finishes it while recording that it was short, so reports are
  // never told the supplier delivered in full.
  //
  // The payable is untouched: it follows received value, so the buyer still owes
  // exactly what arrived. Returns of goods already received remain possible.
  closeShort: async (id: string, userId: string, reason?: string) => {
    const purchase = await (prisma as any).purchase.findFirst({ where: { id, deletedAt: null } });
    if (!purchase) throw new HttpError(404, 'Purchase order not found');
    if (purchase.status !== 'CONFIRMED') {
      throw new HttpError(409, 'Only a confirmed purchase order can be closed short');
    }
    if (purchase.deliveryStatus === 'DELIVERED') {
      throw new HttpError(409, 'This order was delivered in full — there is nothing outstanding to close');
    }
    if (purchase.deliveryStatus === 'CLOSED_SHORT') {
      throw new HttpError(409, 'This order is already closed');
    }

    logger.info({ purchaseId: id, userId, reason }, 'Purchase order closed short');

    return prisma.purchase.update({
      where: { id },
      data: {
        deliveryStatus:    'CLOSED_SHORT',
        closedShortAt:     new Date(),
        closedShortById:   userId,
        closedShortReason: reason ?? null,
      },
    });
  },

  // ── Update PO (DRAFT only) ────────────────────────────────────────────────

  updatePurchase: async (id: string, input: import('./purchases.schema.js').UpdatePurchaseInput) => {
    const purchase = await (prisma as any).purchase.findFirst({
      where: { id, deletedAt: null },
      include: { lines: true },
    });
    if (!purchase) throw new HttpError(404, 'Purchase order not found');
    if (purchase.status !== 'DRAFT') {
      throw new HttpError(400, 'Cannot edit a confirmed or cancelled purchase');
    }

    const lines = input.lines ?? [];
    let subtotalCents = 0;

    for (const l of lines) {
      subtotalCents += Math.round(Number(l.qty) * l.unitCostCents);
    }
    const totalCents = subtotalCents; // No tax per business decision

    // CHUNK 23d (v1.0.73): defense-in-depth COUNT-integer guard at DRAFT update.
    // Same rationale as createPurchase — mirror confirmPurchase (23a) only for
    // null-unitId lines (qty already in base units, zero false-positive); defer
    // converted-unit lines to the confirm guard. Runs before the transaction so
    // a bad edit fails fast without opening a write tx. Purely additive.
    const updateProductIds = [...new Set(lines.map((l) => l.productId))];
    const updateLineMeta = await prisma.product.findMany({
      where: { id: { in: updateProductIds } },
      select: {
        id: true,
        baseUnit: { select: { type: true, allowDecimal: true } },
        unit:     { select: { type: true, allowDecimal: true } },
      },
    });
    const updateLineMetaMap = new Map(updateLineMeta.map((p) => [p.id, p]));
    for (const l of lines) {
      if (l.unitId) continue; // qty not in base units; confirm guard (23a) authoritative
      const meta = updateLineMetaMap.get(l.productId);
      const unitMeta = meta?.baseUnit ?? meta?.unit;
      if (unitMeta && (unitMeta.type === 'COUNT' || unitMeta.allowDecimal === false)) {
        if (!Number.isInteger(Number(l.qty))) {
          throw new HttpError(
            400,
            `Quantity for count-only products must be a whole number; got ${Number(l.qty)}`,
          );
        }
      }
    }

    return prisma.$transaction(async (tx) => {
      await tx.purchaseLine.deleteMany({ where: { purchaseId: id } });

      return tx.purchase.update({
        where: { id },
        data: {
          supplierId:    input.supplierId  ?? purchase.supplierId,
          warehouseId:   input.warehouseId ?? purchase.warehouseId,
          date:          input.date ? new Date(input.date) : purchase.date,
          note:          input.note ?? purchase.note,
          subtotalCents,
          taxCents:      0,
          totalCents,
          lines: {
            create: lines.map((l) => ({
              productId:     l.productId,
              unitId:        l.unitId ?? null,
              qty:           l.qty,
              unitCostCents: l.unitCostCents,
              taxPercent:    0,
              lineTotalCents: Math.round(Number(l.qty) * l.unitCostCents),
              expiryDate:    l.expiryDate ? new Date(l.expiryDate) : null,
            })),
          },
        },
        include: {
          supplier:  { select: { id: true, name: true } },
          warehouse: { select: { id: true, name: true, code: true } },
          createdBy: { select: { id: true, fullName: true } },
          lines: {
            include: {
              product: { select: { id: true, name: true, sku: true, unit: { select: { shortCode: true } } } },
            },
          },
        },
      });
    });
  },

  // ── Supplier payment ──────────────────────────────────────────────────────
  // Legacy recordSupplierPayment / listPurchasePayments removed.
  // The supplier-payments module (POST /api/v1/supplier-payments) is the sole
  // payment path: it correctly updates both paidCents AND paymentStatus and
  // writes to the supplier_payments table that the UI reads.

  // ── Auto-PO from low stock alerts ─────────────────────────────────────────

  fromAlerts: async (input: FromAlertsInput, userId: string) => {
    const [supplier, warehouse] = await Promise.all([
      prisma.supplier.findUnique({ where: { id: input.supplierId } }),
      prisma.warehouse.findUnique({ where: { id: input.warehouseId } }),
    ]);
    if (!supplier) throw new HttpError(400, 'Supplier not found');
    if (!warehouse) throw new HttpError(400, 'Warehouse not found');
    if (!warehouse.isActive) throw new HttpError(400, 'Warehouse is not active');

    const productIds = [...new Set(input.items.map((i) => i.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
      select: { id: true, costCents: true },
    });
    if (products.length !== productIds.length) {
      throw new HttpError(400, 'One or more products not found or inactive');
    }
    const costMap = new Map(products.map((p) => [p.id, p.costCents]));

    const computedLines = input.items.map((item) => {
      const unitCostCents = item.unitCostCents ?? costMap.get(item.productId) ?? 0;
      const lineTotalCents = Math.round(item.qty * unitCostCents);
      return { productId: item.productId, qty: item.qty, unitCostCents, lineTotalCents };
    });

    const totalCents = computedLines.reduce((s, l) => s + l.lineTotalCents, 0);

    // The number is issued INSIDE the retry, as late as possible. Two writers
    // can read the same maximum before either has committed; the database
    // settles that on the unique index and the retry takes the next free
    // number rather than failing the document. Mirrors sales and pos.
    return withNumberRetry(async () => prisma.purchase.create({
      data: {
        number: await generatePONumber(),
        supplierId:  input.supplierId,
        warehouseId: input.warehouseId,
        date:        new Date(),
        note:        input.note ?? `Auto-generated from low-stock alerts`,
        subtotalCents: totalCents,
        taxCents:      0,
        totalCents,
        status:     'DRAFT',
        sourceType: 'AUTO_PO',
        createdById: userId,
        lines: {
          create: computedLines.map((l) => ({
            productId:      l.productId,
            qty:            l.qty,
            unitCostCents:  l.unitCostCents,
            taxPercent:     0,
            lineTotalCents: l.lineTotalCents,
          })),
        },
      },
      include: {
        supplier:  { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true, code: true } },
        lines: {
          include: { product: { select: { id: true, name: true, sku: true } } },
        },
      },
    }));
  },

  deletePurchase: async (id: string, userId: string) => {
    const purchase = await (prisma as any).purchase.findFirst({ where: { id, deletedAt: null } });
    if (!purchase) throw new HttpError(404, 'Purchase order not found');
    if (purchase.status !== 'DRAFT') throw new HttpError(400, 'Only DRAFT purchase orders can be deleted');
    await (prisma as any).purchase.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: userId },
    });
    return { success: true };
  },
};
