import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';
import { convertToBaseUnit, convertFromBaseUnit } from '../../utils/unit-converter.js';
import { getBatchSummary, getBatchDetail, deductBatchesFEFO } from '../../utils/batch-expiry.js';
import { recomputeStockQty, repairNegativeStockQty } from '../../utils/stock-utils.js';
import type {
  StockListInput,
  AdjustmentInput,
  TransferInput,
  MovementsListInput,
} from './inventory.schema.js';

export const inventoryService = {
  // ─── Stock Levels ──────────────────────────────────────────────────────────

  async listStock(input: StockListInput) {
    const { search, productId, warehouseId, lowStockOnly, outStockOnly, page, pageSize } = input;

    // ── stock.findMany: one row per real Stock record — no phantom expansion ──
    // qty = 0 rows ARE included (sold-out products must appear).
    // Phantom rows created by ensureStockRecords are removed by cleanupPhantomStock
    // which runs on server startup.
    const rows = await prisma.stock.findMany({
      where: {
        product: { isActive: true },
        ...(productId   ? { productId }   : {}),
        ...(warehouseId ? { warehouseId } : {}),
        // NO qty filter — zero-stock rows must be visible
      },
      orderBy: { product: { name: 'asc' } },
      include: {
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            barcode: true,
            costCents: true,
            reorderLevel: true,
            reorderQty: true,
            unit: { select: { shortCode: true } },
            category: { select: { name: true } },
          },
        },
        warehouse: { select: { id: true, name: true, code: true } },
      },
    });

    // Apply name / SKU / barcode search filter (done in memory — avoids double query)
    const lc = search?.toLowerCase() ?? '';
    const searched = lc
      ? rows.filter(
          (r) =>
            r.product.name.toLowerCase().includes(lc) ||
            r.product.sku.toLowerCase().includes(lc) ||
            (r.product.barcode?.toLowerCase() ?? '').includes(lc),
        )
      : rows;

    // Enrich with batch expiry summary FIRST — isLowStock must use sellableQty
    const enriched = await Promise.all(
      searched.map(async (r) => {
        const batch = await getBatchSummary(r.product.id, r.warehouse.id);
        return {
          ...r,
          qty: Number(r.qty),
          ...batch,
          // Stock valuation: based on sellable qty × last cost
          stockValueCents: Math.floor(batch.sellableQty * r.product.costCents),
          isLowStock:
            batch.sellableQty > 0 &&
            r.product.reorderLevel > 0 &&
            batch.sellableQty <= r.product.reorderLevel,
        };
      }),
    );

    // Total stock value — sum over ALL enriched rows (before any filter)
    const totalStockValueCents = enriched.reduce((sum, r) => sum + r.stockValueCents, 0);

    // Apply post-enrichment filters (lowStockOnly / outStockOnly)
    const filtered = enriched
      .filter((r) => (lowStockOnly ? r.isLowStock : true))
      .filter((r) => (outStockOnly ? r.sellableQty <= 0 : true));

    const total = filtered.length;
    const skip  = (page - 1) * pageSize;
    const data  = filtered.slice(skip, skip + pageSize);

    return { total, page, pageSize, totalStockValueCents, data };
  },

  // ─── Batch detail for one product+warehouse ───────────────────────────────

  async getBatchDetail(productId: string, warehouseId: string) {
    return getBatchDetail(productId, warehouseId);
  },

  // ─── Expiring / expired products (for dashboard alert) ───────────────────

  async listExpiring() {
    // Get all stock rows with qty > 0, then filter by expiry status
    const rows = await prisma.stock.findMany({
      where: { qty: { gt: new Decimal(0) } },
      select: {
        product:   { select: { id: true, name: true, sku: true } },
        warehouse: { select: { id: true, name: true } },
        qty:       true,
      },
    });

    const results = await Promise.all(
      rows.map(async (r) => {
        const batch = await getBatchSummary(r.product.id, r.warehouse.id);
        return { product: r.product, warehouse: r.warehouse, totalQty: Number(r.qty), ...batch };
      }),
    );

    return results.filter(
      (r) => r.expiryStatus === 'expiring' || r.expiryStatus === 'has_expired_batch',
    );
  },

  // ─── Stock by units for a single product ──────────────────────────────────

  async getStockByUnits(productId: string) {
    const product = await prisma.product.findUnique({
      where: { id: productId },
      select: {
        id: true,
        name: true,
        sku: true,
        unit:        { select: { id: true, name: true, shortCode: true } },
        baseUnit:    { select: { id: true, name: true, shortCode: true } },
        purchaseUnit:{ select: { id: true, name: true, shortCode: true } },
        salesUnit:   { select: { id: true, name: true, shortCode: true } },
        unitConversions: {
          where: { isActive: true },
          include: {
            fromUnit: { select: { id: true, name: true, shortCode: true } },
            toUnit:   { select: { id: true, name: true, shortCode: true } },
          },
        },
        stock: {
          include: { warehouse: { select: { id: true, name: true, code: true } } },
        },
      },
    });
    if (!product) throw new HttpError(404, 'Product not found');

    const baseUnit = product.baseUnit ?? product.unit;

    // For each warehouse + each conversion unit, compute display qty
    const stockByWarehouse = await Promise.all(
      product.stock.map(async (s) => {
        const baseQty = new Decimal(s.qty.toString());
        const displayConversions: Array<{
          unitId: string; unitName: string; unitShort: string; qty: number; remainder: number;
        }> = [];

        // Compute qty in each "from" unit that maps TO base unit
        for (const conv of product.unitConversions.filter((c) => c.toUnitId === baseUnit.id)) {
          try {
            const result = await convertFromBaseUnit(productId, conv.fromUnitId, baseQty, prisma);
            displayConversions.push({
              unitId:    conv.fromUnit.id,
              unitName:  conv.fromUnit.name,
              unitShort: conv.fromUnit.shortCode,
              qty:       result.qty.toNumber(),
              remainder: result.remainder.toNumber(),
            });
          } catch {
            // ignore units that can't be resolved
          }
        }

        return {
          warehouseId:   s.warehouseId,
          warehouseName: s.warehouse.name,
          warehouseCode: s.warehouse.code,
          baseQty:       Number(s.qty),
          baseUnitId:    baseUnit.id,
          baseUnitName:  baseUnit.name,
          baseUnitShort: baseUnit.shortCode,
          displayConversions,
        };
      }),
    );

    return {
      productId:    product.id,
      productName:  product.name,
      productSku:   product.sku,
      baseUnit,
      stockByWarehouse,
    };
  },

  async getLowStock() {
    // Returns rows that are genuinely low on *sellable* stock (not expired-only or zero-stock).
    // Definition: sellableQty > 0 AND reorderLevel > 0 AND sellableQty <= reorderLevel.
    // This matches the KPI tile definition and the header alert count exactly.
    const rows = await prisma.stock.findMany({
      where: { product: { isActive: true } },
      select: {
        id: true,
        qty: true,
        product: {
          select: {
            id: true,
            name: true,
            sku: true,
            reorderLevel: true,
            unit: { select: { shortCode: true } },
            category: { select: { name: true } },
          },
        },
        warehouse: { select: { id: true, name: true, code: true } },
      },
      orderBy: { product: { name: 'asc' } },
    });

    // Enrich with batch summary so sellableQty is accurate
    const enriched = await Promise.all(
      rows.map(async (r) => {
        const batch = await getBatchSummary(r.product.id, r.warehouse.id);
        return {
          ...r,
          qty: Number(r.qty),
          ...batch,
          isLowStock:
            batch.sellableQty > 0 &&
            r.product.reorderLevel > 0 &&
            batch.sellableQty <= r.product.reorderLevel,
        };
      }),
    );

    return enriched.filter((r) => r.isLowStock);
  },

  // ─── Ensure every active product has a Stock record ─────────────────────────
  // Idempotent. Creates qty=0 rows for any (product, warehouse) pair that is
  // missing one so those products appear in the Stock Overview table.
  async ensureStockRecords() {
    const [products, warehouses] = await Promise.all([
      prisma.product.findMany({ where: { isActive: true }, select: { id: true } }),
      prisma.warehouse.findMany({ where: { isActive: true }, select: { id: true } }),
    ]);

    const pairs = products.flatMap((p) =>
      warehouses.map((w) => ({ productId: p.id, warehouseId: w.id, qty: 0 })),
    );

    const result = await prisma.stock.createMany({
      data: pairs,
      skipDuplicates: true, // INSERT … ON CONFLICT DO NOTHING
    });

    return { created: result.count };
  },

  // ─── Cleanup phantom stock records ────────────────────────────────────────
  // Safe to call repeatedly — fully idempotent.
  //
  // Deletes Stock rows ONLY when ALL four conditions are true:
  //   1. qty = 0
  //   2. No StockMovement for this productId + warehouseId
  //   3. No StockBatch for this productId + warehouseId
  //   4. No confirmed PurchaseLine that stocked this productId into this warehouseId
  //
  // Real zero-qty rows (sold-out products like rexidin) have movement history
  // and are therefore kept.  Only "ensureStockRecords" phantoms get removed.
  async cleanupPhantomStock() {
    // 1. Collect all zero-qty stock rows
    const zeroes = await prisma.stock.findMany({
      where: { qty: new Decimal(0) },
      select: { productId: true, warehouseId: true },
    });

    if (zeroes.length === 0) return { deleted: 0 };

    // 2. Which pairs have StockMovement history?
    const withMovements = await prisma.stockMovement.findMany({
      where: { OR: zeroes.map((z) => ({ productId: z.productId, warehouseId: z.warehouseId })) },
      select: { productId: true, warehouseId: true },
      distinct: ['productId', 'warehouseId'],
    });
    const movedSet = new Set(withMovements.map((m) => `${m.productId}:${m.warehouseId}`));

    // 3. Which pairs have StockBatch records?
    const withBatches = await (prisma as any).stockBatch.findMany({
      where: { OR: zeroes.map((z) => ({ productId: z.productId, warehouseId: z.warehouseId })) },
      select: { productId: true, warehouseId: true },
      distinct: ['productId', 'warehouseId'],
    }) as Array<{ productId: string; warehouseId: string }>;
    const batchSet = new Set(withBatches.map((b) => `${b.productId}:${b.warehouseId}`));

    // 4. Which pairs have a real PurchaseLine (i.e. the product was ever ordered into that warehouse)?
    const withPurchases = await prisma.purchaseLine.findMany({
      where: {
        OR: zeroes.map((z) => ({
          productId: z.productId,
          purchase: { warehouseId: z.warehouseId },
        })),
      },
      select: { productId: true, purchase: { select: { warehouseId: true } } },
      distinct: ['productId'],
    });
    const purchaseSet = new Set(
      withPurchases.map((pl) => `${pl.productId}:${pl.purchase.warehouseId}`),
    );

    // Keep only rows that have NONE of the above histories
    const phantoms = zeroes.filter((z) => {
      const key = `${z.productId}:${z.warehouseId}`;
      return !movedSet.has(key) && !batchSet.has(key) && !purchaseSet.has(key);
    });

    if (phantoms.length === 0) return { deleted: 0 };

    const result = await prisma.stock.deleteMany({
      where: { OR: phantoms.map((z) => ({ productId: z.productId, warehouseId: z.warehouseId })) },
    });

    if (result.count > 0) {
      logger.info({ deleted: result.count }, 'cleanupPhantomStock: removed phantom zero-qty stock records');
    }

    return { deleted: result.count };
  },

  // ─── FIX 5: Warn about inflated stock (no batch, only OUT movements) ────────
  // Logs a WARN for each Stock row where:
  //   - qty > 0
  //   - no StockBatch records exist for this product+warehouse
  //   - at least one OUT movement (SALE_OUT, TRANSFER_OUT, WRITE_OFF) exists
  //   - no IN movement (PURCHASE_IN, RETURN_IN, ADJUSTMENT with qty>0) exists
  // These records may have quantities inflated from before FEFO batch tracking.
  // Owner must correct via Adjust Stock — we never silently modify stock numbers.
  async warnInflatedStock() {
    const candidates = await prisma.stock.findMany({
      where: { qty: { gt: new Decimal(0) } },
      select: {
        productId: true,
        warehouseId: true,
        qty: true,
        product: { select: { name: true, sku: true } },
        warehouse: { select: { name: true } },
      },
    });

    for (const s of candidates) {
      // Check for batch records
      const batchCount = await (prisma as any).stockBatch.count({
        where: { productId: s.productId, warehouseId: s.warehouseId },
      }) as number;
      if (batchCount > 0) continue; // has batch tracking — fine

      // Check for any IN movement
      const inMove = await prisma.stockMovement.findFirst({
        where: {
          productId: s.productId,
          warehouseId: s.warehouseId,
          type: { in: ['PURCHASE_IN', 'RETURN_IN', 'ADJUSTMENT'] },
          qty: { gt: new Decimal(0) },
        },
        select: { id: true },
      });
      if (inMove) continue; // has real inbound movement — fine

      // Check for at least one OUT movement
      const outMove = await prisma.stockMovement.findFirst({
        where: {
          productId: s.productId,
          warehouseId: s.warehouseId,
          type: { in: ['SALE_OUT', 'TRANSFER_OUT', 'WRITE_OFF'] },
        },
        select: { id: true },
      });
      if (!outMove) continue; // no out movements — seeded stock, not inflated

      logger.debug(
        {
          productId: s.productId,
          productName: s.product.name,
          sku: s.product.sku,
          warehouseId: s.warehouseId,
          warehouseName: s.warehouse.name,
          qty: Number(s.qty),
        },
        'Stock history incomplete (seed data or manual adjust)',
      );
    }
  },

  async getWarehouses() {
    return prisma.warehouse.findMany({
      where:   { isActive: true },
      select:  { id: true, name: true, code: true, city: true, type: true, isDefault: true, isActive: true },
      orderBy: [{ isDefault: 'desc' }, { name: 'asc' }],
    });
  },

  // ─── Adjustments ───────────────────────────────────────────────────────────

  async createAdjustment(input: AdjustmentInput, userId: string) {
    const { productId, warehouseId, qty, reason } = input;

    // Check product exists
    const product = await prisma.product.findFirst({
      where: { id: productId, isActive: true },
      select: { name: true },
    });
    if (!product) throw new HttpError(404, 'Product not found or inactive');

    // Check warehouse exists
    const warehouse = await prisma.warehouse.findFirst({
      where: { id: warehouseId, isActive: true },
      select: { name: true },
    });
    if (!warehouse) throw new HttpError(404, 'Warehouse not found');

    // Get current stock
    const current = await prisma.stock.findUnique({
      where: { productId_warehouseId: { productId, warehouseId } },
    });
    const currentQty = current ? Number(current.qty) : 0;
    // Note: negative adjustments are FLOORED at 0 inside the transaction below
    // (Stock.qty can never go below 0). We no longer reject here — the pre-tx
    // currentQty could itself be stale/drifted, so the authoritative clamp is
    // computed from a fresh in-transaction read.

    logger.info({ productId, warehouseId, qty, reason }, 'Stock adjustment starting');

    const result = await prisma.$transaction(async (tx) => {
      // ── Resolve adjustment qty into the product's BASE unit (v1.0.72) ───────
      // The UI submits qty already in base units (no unit selector), but an
      // optional input.unitId lets unit-aware callers submit in a packaging unit
      // (e.g. boxes). Convert to base BEFORE any stock or P&L arithmetic so both
      // stay correct. Sign is preserved; convertToBaseUnit needs a positive
      // magnitude. No unitId, or unitId === baseUnitId, means "already base" →
      // behaves identically to the pre-v1.0.72 path.
      const adjProductUnit = await tx.product.findUnique({
        where:  { id: productId },
        select: { baseUnitId: true },
      });
      const effectiveUnitId = input.unitId ?? adjProductUnit?.baseUnitId ?? null;

      let signedBaseQty: number;
      if (!effectiveUnitId || effectiveUnitId === adjProductUnit?.baseUnitId) {
        signedBaseQty = Number(qty);
      } else {
        const magnitude = Math.abs(Number(qty));
        const unitRow = await tx.unit.findUnique({
          where:  { id: effectiveUnitId },
          select: { type: true, allowDecimal: true },
        });
        if (unitRow && (unitRow.type === 'COUNT' || unitRow.allowDecimal === false)) {
          if (!Number.isInteger(magnitude)) {
            throw new HttpError(
              400,
              `Quantity for count-only units must be a whole number; got ${magnitude}`,
            );
          }
        }
        const { baseQty: baseMagnitude } = await convertToBaseUnit(
          productId,
          effectiveUnitId,
          new Decimal(magnitude),
          tx,
        );
        signedBaseQty = Number(baseMagnitude) * Math.sign(Number(qty));
      }

      // ── FIX (v1.0.57): floor at 0 using a FRESH in-transaction read ─────────
      // Stock.qty is Decimal(18,4); convert with Number() for the arithmetic.
      const currentStockRow = await tx.stock.findUnique({
        where:  { productId_warehouseId: { productId, warehouseId } },
        select: { qty: true },
      });
      const freshCurrentQty = Number(currentStockRow?.qty ?? 0);
      const baseQty = Math.abs(signedBaseQty);

      // SIGN-ROUTER — keep stock batch-consistent without wiping legacy (no-batch)
      // stock. Negative = decrease → FEFO-deduct (mirror POS/write-off) with a
      // legacy floored fork. Positive = increase → create a lot (mirror sale-return)
      // and set ADDITIVELY (never recompute — a blind recompute would zero a legacy
      // product's pre-existing unbacked aggregate).
      let stock;
      if (signedBaseQty < 0) {
        // DECREASE — FEFO-deduct, mirror POS/write-off. Legacy fork protects no-batch stock.
        const deducted = await deductBatchesFEFO(tx, productId, warehouseId, baseQty, false);
        if (deducted > 0) {
          await recomputeStockQty(tx, productId, warehouseId);
        } else {
          const newQty = Math.max(0, freshCurrentQty - baseQty);
          await tx.stock.upsert({
            where:  { productId_warehouseId: { productId, warehouseId } },
            update: { qty: newQty },
            create: { productId, warehouseId, qty: 0 },
          });
        }
        // Row is guaranteed to exist: both sub-branches above (recompute upsert
        // / legacy floored upsert) create or update it. Assert non-null for TS.
        stock = (await tx.stock.findUnique({
          where: { productId_warehouseId: { productId, warehouseId } },
        }))!;
      } else {
        // INCREASE — create a lot (mirror sale-return), then set ADDITIVELY.
        // NOT recompute: a blind recompute would wipe a legacy product's
        // pre-existing unbacked aggregate. Additive is correct for BOTH batched
        // (fresh already == batch sum) and legacy (preserves the aggregate).
        await tx.stockBatch.create({
          data: { productId, warehouseId, purchaseLineId: null, qty: baseQty, expiryDate: null },
        });
        const newQty = Math.max(0, freshCurrentQty + baseQty);
        stock = await tx.stock.upsert({
          where:  { productId_warehouseId: { productId, warehouseId } },
          update: { qty: newQty },
          create: { productId, warehouseId, qty: newQty },
        });
      }

      // Record movement
      const movement = await tx.stockMovement.create({
        data: {
          productId,
          warehouseId,
          type: 'ADJUSTMENT',
          qty: signedBaseQty,
          refType: 'Adjustment',
          note: reason,
        },
      });

      // ── FIX 1: offsetting P&L record (loss/gain) ───────────────────────────
      // A stock adjustment changes inventory value, so it must hit P&L. A
      // reduction (qty < 0) is a loss expense; an increase (qty > 0) is a gain.
      const adjProduct = await (tx as any).product.findUnique({
        where: { id: productId },
        select: { costCents: true, name: true },
      });

      const valueCents = Math.abs(
        Math.round(signedBaseQty * (adjProduct?.costCents ?? 0)),
      );

      if (valueCents > 0) {
        const categoryName = signedBaseQty < 0
          ? 'Stock Adjustment Loss'
          : 'Stock Adjustment Gain';
        const categoryColor = signedBaseQty < 0 ? '#f97316' : '#22c55e';

        // ExpenseCategory.name is unique, but findFirst + create keeps the
        // soft-delete (deletedAt) filter explicit and matches the write-off path.
        let adjCategory = await (tx as any).expenseCategory.findFirst({
          where: { name: categoryName, deletedAt: null },
          select: { id: true },
        });
        if (!adjCategory) {
          adjCategory = await (tx as any).expenseCategory.create({
            data: { name: categoryName, color: categoryColor, isActive: true },
            select: { id: true },
          });
        }

        const expenseData: any = {
          categoryId:    adjCategory.id,
          amount:        valueCents,
          description:
            `Stock ${signedBaseQty < 0 ? 'loss' : 'gain'}: ` +
            `${adjProduct?.name} × ${Math.abs(signedBaseQty)} — ${reason}`,
          date:          new Date(),
          paymentMethod: 'CASH',
          reference:     `ADJ-${Date.now()}`,
          isRecurring:   false,
          createdById:   userId,
        };

        await (tx as any).expense.create({ data: expenseData });
      }

      return { stock, movement };
    });

    logger.info({ productId, newQty: Number(result.stock.qty) }, 'Stock adjustment completed');

    return {
      message: 'Adjustment applied',
      productName: product.name,
      warehouseName: warehouse.name,
      previousQty: currentQty,
      adjustment: qty,
      newQty: Number(result.stock.qty),
    };
  },

  // ─── Transfers ─────────────────────────────────────────────────────────────

  async createTransfer(input: TransferInput, userId: string) {
    const { productId, fromWarehouseId, toWarehouseId, qty, note } = input;

    // Check product
    const product = await prisma.product.findFirst({
      where: { id: productId, isActive: true },
      select: { name: true },
    });
    if (!product) throw new HttpError(404, 'Product not found or inactive');

    // Check source stock
    const sourceStock = await prisma.stock.findUnique({
      where: { productId_warehouseId: { productId, warehouseId: fromWarehouseId } },
    });
    const available = sourceStock ? Number(sourceStock.qty) : 0;
    if (available < qty) {
      throw new HttpError(
        400,
        `Insufficient stock in source warehouse. Available: ${available}, requested: ${qty}`,
      );
    }

    // Verify both warehouses exist
    const [fromWh, toWh] = await Promise.all([
      prisma.warehouse.findFirst({ where: { id: fromWarehouseId }, select: { name: true } }),
      prisma.warehouse.findFirst({ where: { id: toWarehouseId }, select: { name: true } }),
    ]);
    if (!fromWh) throw new HttpError(404, 'Source warehouse not found');
    if (!toWh) throw new HttpError(404, 'Destination warehouse not found');

    logger.info({ productId, fromWarehouseId, toWarehouseId, qty }, 'Stock transfer starting');

    await prisma.$transaction(async (tx) => {
      // Decrement source
      await tx.stock.update({
        where: { productId_warehouseId: { productId, warehouseId: fromWarehouseId } },
        data: { qty: { decrement: qty } },
      });

      // Increment destination (upsert — may not exist yet)
      await tx.stock.upsert({
        where: { productId_warehouseId: { productId, warehouseId: toWarehouseId } },
        update: { qty: { increment: qty } },
        create: { productId, warehouseId: toWarehouseId, qty },
      });

      // TRANSFER_OUT movement
      await tx.stockMovement.create({
        data: {
          productId,
          warehouseId: fromWarehouseId,
          type: 'TRANSFER_OUT',
          qty: -qty,
          refType: 'Transfer',
          note: note ?? `Transfer to ${toWh.name}`,
        },
      });

      // TRANSFER_IN movement
      await tx.stockMovement.create({
        data: {
          productId,
          warehouseId: toWarehouseId,
          type: 'TRANSFER_IN',
          qty,
          refType: 'Transfer',
          note: note ?? `Transfer from ${fromWh.name}`,
        },
      });
    });

    logger.info({ productId, qty }, 'Stock transfer completed');

    return {
      message: 'Transfer completed',
      productName: product.name,
      qty,
      from: fromWh.name,
      to: toWh.name,
    };
  },

  // ─── Movement History ──────────────────────────────────────────────────────

  // ─── Write-Off ────────────────────────────────────────────────────────────
  // Write off a specific batch (expired or damaged stock). Records a WRITE_OFF
  // StockMovement and decrements both the StockBatch row and the Stock total.

  async writeOff(input: import('./inventory.schema.js').WriteOffInput, userId: string) {
    const { batchId, warehouseId, qty, reason } = input;

    // Load the batch
    const batch = await (prisma as any).stockBatch.findFirst({
      where: { id: batchId, warehouseId },
      select: { id: true, productId: true, qty: true, expiryDate: true,
                product: { select: { name: true, costCents: true, unit: { select: { shortCode: true } } } } },
    }) as {
      id: string; productId: string;
      qty: { toNumber: () => number };
      expiryDate: Date | null;
      product: { name: string; costCents: number; unit: { shortCode: string } };
    } | null;

    if (!batch) throw new HttpError(404, 'Batch not found');

    const batchQty = batch.qty.toNumber();
    if (qty > batchQty) {
      throw new HttpError(400, `Write-off qty (${qty}) exceeds batch qty (${batchQty})`);
    }

    const lossCents = Math.round(qty * batch.product.costCents);

    logger.info({ batchId, productId: batch.productId, warehouseId, qty, reason }, 'Write-off starting');

    // ── Generate WO reference number ─────────────────────────────────────────
    const year    = new Date().getFullYear();
    const woPrefix = `WO-${year}-`;
    const woCount  = await (prisma as any).expense.count({
      where: { reference: { startsWith: woPrefix } },
    });
    const woReference = `${woPrefix}${String(woCount + 1).padStart(4, '0')}`;

    // ── Find or create "Stock Write-Off" expense category ────────────────────
    let expenseCategory = await (prisma as any).expenseCategory.findFirst({
      where: { name: 'Stock Write-Off', deletedAt: null },
      select: { id: true },
    });
    if (!expenseCategory) {
      expenseCategory = await (prisma as any).expenseCategory.create({
        data: { name: 'Stock Write-Off', color: '#ef4444', isActive: true },
        select: { id: true },
      });
    }

    let expenseId: string | null = null;

    await prisma.$transaction(async (tx) => {
      // Deduct from batch
      await (tx as any).stockBatch.update({
        where: { id: batchId },
        data:  { qty: { decrement: qty } },
      });

      // Recompute aggregate stock from the (already-decremented) batch rows.
      // The batch is the source of truth, so Stock.qty can never go negative.
      await recomputeStockQty(tx, batch.productId, warehouseId);

      // Record movement with batchId link
      await tx.stockMovement.create({
        data: {
          productId:   batch.productId,
          warehouseId,
          type:        'WRITE_OFF',
          qty:         -qty,
          refType:     'WriteOff',
          batchId,
          note:        reason,
        },
      });

      // Record expense for the loss
      const expense = await (tx as any).expense.create({
        data: {
          categoryId:    expenseCategory.id,
          amount:        lossCents,
          description:   `Write-off: ${batch.product.name} × ${qty} ${batch.product.unit.shortCode} — ${reason}`,
          date:          new Date(),
          paymentMethod: 'CASH',
          reference:     woReference,
          isRecurring:   false,
          createdById:   userId,
        },
        select: { id: true },
      });
      expenseId = expense.id as string;
    });

    logger.info({ batchId, qty, lossCents, woReference }, 'Write-off completed');

    return {
      batchId,
      productId: batch.productId,
      warehouseId,
      qty,
      lossCents,
      reason,
      expense: { id: expenseId!, amount: lossCents, reference: woReference },
    };
  },

  // ─── Repair drifted/negative Stock.qty ─────────────────────────────────────
  // One-shot maintenance: recompute every negative Stock.qty from its positive
  // StockBatch sum (floored at 0). Returns how many rows were repaired.
  async repairStockQty() {
    return repairNegativeStockQty();
  },

  async listMovements(input: MovementsListInput) {
    const { productId, warehouseId, type, from, to, page, pageSize } = input;
    const skip = (page - 1) * pageSize;

    const where = {
      ...(productId ? { productId } : {}),
      ...(warehouseId ? { warehouseId } : {}),
      ...(type ? { type } : {}),
      ...(from || to
        ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } }
        : {}),
    };

    const [total, data] = await prisma.$transaction([
      prisma.stockMovement.count({ where }),
      prisma.stockMovement.findMany({
        where,
        skip,
        take: pageSize,
        orderBy: { createdAt: 'desc' },
        select: {
          id: true,
          type: true,
          qty: true,
          refType: true,
          refId: true,
          note: true,
          createdAt: true,
          product: { select: { id: true, name: true, sku: true } },
          warehouse: { select: { id: true, name: true, code: true } },
        },
      }),
    ]);

    return {
      total,
      page,
      pageSize,
      data: data.map((m) => ({ ...m, qty: Number(m.qty) })),
    };
  },
};
