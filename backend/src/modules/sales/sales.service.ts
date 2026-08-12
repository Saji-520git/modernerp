import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';
import { convertToBaseUnit } from '../../utils/unit-converter.js';
import { deductBatchesFEFO } from '../../utils/batch-expiry.js';
import { recomputeStockQty } from '../../utils/stock-utils.js';
import { recordStockMovement } from '../../utils/stock-movement.js';
import type { CreateSaleInput, ListSalesInput, RecordPaymentInput } from './sales.schema.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function generateInvoiceNumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `INV-${year}-`;
  // Count ALL sales (POS + invoices) to share the number sequence
  const count = await prisma.sale.count({
    where: { number: { startsWith: prefix } },
  });
  return `${prefix}${String(count + 1).padStart(4, '0')}`;
}

// ─── Service ──────────────────────────────────────────────────────────────────

export const salesService = {
  // ── Customers dropdown ─────────────────────────────────────────────────────

  listCustomers: async () => {
    return prisma.customer.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, name: true, phone: true, email: true },
    });
  },

  // ── Products with current stock for a warehouse ────────────────────────────

  listProducts: async (warehouseId?: string) => {
    const products = await prisma.product.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: {
        id: true,
        name: true,
        sku: true,
        priceCents: true,
        taxPercent: true,
        isBatchTracked: true,
        unitId: true,
        baseUnitId: true,
        salesUnitId: true,
        unit:      { select: { id: true, shortCode: true, name: true, allowDecimal: true } },
        baseUnit:  { select: { id: true, shortCode: true, name: true, allowDecimal: true } },
        salesUnit: { select: { id: true, shortCode: true, name: true, allowDecimal: true } },
        unitConversions: {
          where: { isActive: true },
          select: {
            id: true,
            fromUnitId: true,
            toUnitId: true,
            conversionQty: true,
            priceCents: true,
            fromUnit: { select: { id: true, name: true, shortCode: true, allowDecimal: true } },
            toUnit:   { select: { id: true, name: true, shortCode: true } },
          },
        },
        stock: warehouseId
          ? { where: { warehouseId }, select: { qty: true } }
          : { select: { qty: true, warehouseId: true } },
      },
    });

    return products.map((p) => ({
      ...p,
      stockQty: p.stock.reduce((sum, s) => sum + Number(s.qty), 0),
    }));
  },

  // ── List sales (all types: POS + invoices) ────────────────────────────────

  listSales: async (input: ListSalesInput) => {
    const { search, status, paymentMethod, customerId, warehouseId, from, to, includePos, page, pageSize } = input;

    const where: Record<string, unknown> = { deletedAt: null };

    // isPos filter: default includes all (POS + invoices)
    if (includePos === 'false') where.isPos = false;

    if (status) where.status = status;
    if (paymentMethod) where.paymentMethod = paymentMethod;
    if (customerId) where.customerId = customerId;
    if (warehouseId) where.warehouseId = warehouseId;
    if (from || to) {
      where.date = {
        ...(from ? { gte: new Date(from) } : {}),
        ...(to   ? { lte: new Date(to + 'T23:59:59Z') } : {}),
      };
    }
    if (search) {
      where.OR = [
        { number: { contains: search, mode: 'insensitive' } },
        { customer: { name: { contains: search, mode: 'insensitive' } } },
        { note: { contains: search, mode: 'insensitive' } },
      ];
    }

    const [total, data] = await prisma.$transaction([
      prisma.sale.count({ where: where as any }),
      prisma.sale.findMany({
        where: where as any,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * pageSize,
        take: pageSize,
        include: {
          customer: { select: { id: true, name: true, phone: true } },
          warehouse: { select: { id: true, name: true, code: true } },
          createdBy: { select: { id: true, fullName: true } },
          _count: { select: { lines: true } },
          // Option B — totalCents is never mutated; consumers subtract this to
          // get the effective outstanding. Mirrors purchases.listPurchases.
          returns: { select: { totalCents: true } },
        },
      }),
    ]);

    return { total, page, pageSize, data };
  },

  // ── Get single sale/invoice with lines ─────────────────────────────────────

  getSale: async (id: string) => {
    const sale = await (prisma as any).sale.findFirst({
      where: { id, deletedAt: null },
      include: {
        customer: true,
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
        customerPayments: {
          where:   { isActive: true },
          orderBy: { paymentDate: 'asc' },
          include: { createdByUser: { select: { id: true, fullName: true } } },
        },
      },
    });
    if (!sale) throw new HttpError(404, 'Invoice not found');
    return sale;
  },

  // ── Create draft invoice ───────────────────────────────────────────────────

  createSale: async (input: CreateSaleInput, userId: string) => {
    // Validate warehouse
    const warehouse = await prisma.warehouse.findUnique({
      where: { id: input.warehouseId },
    });
    if (!warehouse) throw new HttpError(400, 'Warehouse not found');
    if (!warehouse.isActive) throw new HttpError(400, 'Warehouse is not active');

    // Validate customer if provided
    if (input.customerId) {
      const customer = await prisma.customer.findUnique({
        where: { id: input.customerId },
      });
      if (!customer) throw new HttpError(400, 'Customer not found');
    }

    // Validate all products exist and are active
    const productIds = [...new Set(input.lines.map((l) => l.productId))];
    const products = await prisma.product.findMany({
      where: { id: { in: productIds }, isActive: true },
    });
    if (products.length !== productIds.length) {
      throw new HttpError(400, 'One or more products not found or inactive');
    }

    const number = await generateInvoiceNumber();

    // Compute line and order totals (all integer cents). Totals stay computed on
    // the DISPLAY qty × DISPLAY unit price (e.g. 2 boxes × box-price) — unchanged.
    // Additionally resolve baseQty via unit conversion when a non-base unit is
    // selected, so confirmSale deducts stock in base units (mirrors POS pattern).
    const computedLines = await Promise.all(
      input.lines.map(async (line) => {
        const product = products.find((p) => p.id === line.productId)!;
        const baseUnitId = product.baseUnitId ?? product.unitId;
        let baseQty = line.qty;
        if (line.unitId && line.unitId !== baseUnitId) {
          const r = await convertToBaseUnit(line.productId, line.unitId, new Decimal(line.qty), prisma);
          baseQty = r.baseQty.toNumber();
        }
        const subtotal = Math.round(line.qty * line.unitPriceCents);
        const tax = Math.round(subtotal * (line.taxPercent / 100));
        const lineTotal = subtotal + tax - line.discountCents;
        return {
          ...line,
          baseQty,
          subtotalCents: subtotal,
          taxLineCents: tax,
          lineTotalCents: Math.max(0, lineTotal),
        };
      }),
    );

    const subtotalCents = computedLines.reduce((s, l) => s + l.subtotalCents, 0);
    const taxCents = computedLines.reduce((s, l) => s + l.taxLineCents, 0);
    const discountCents = computedLines.reduce((s, l) => s + l.discountCents, 0);
    const totalCents = subtotalCents + taxCents - discountCents;

    return prisma.sale.create({
      data: {
        number,
        isPos: false,
        customerId: input.customerId || null,
        warehouseId: input.warehouseId,
        date: input.date ? new Date(input.date) : new Date(),
        note: input.note,
        subtotalCents,
        taxCents,
        discountCents,
        totalCents,
        paidCents: 0,
        status: 'DRAFT',
        paymentMethod: 'CASH',
        createdById: userId,
        lines: {
          create: computedLines.map((l) => ({
            productId: l.productId,
            qty: l.qty,
            unitPriceCents: l.unitPriceCents,
            taxPercent: l.taxPercent,
            discountCents: l.discountCents,
            lineTotalCents: l.lineTotalCents,
            unitId: l.unitId ?? null,
            baseQty: l.baseQty !== l.qty ? l.baseQty : null,
            batchId: l.batchId ?? null,
          })),
        },
      },
      include: {
        customer: { select: { id: true, name: true } },
        warehouse: { select: { id: true, name: true, code: true } },
        lines: {
          include: {
            product: { select: { id: true, name: true, sku: true } },
          },
        },
      },
    });
  },

  // ── Confirm invoice → deduct stock ─────────────────────────────────────────

  confirmSale: async (id: string) => {
    const sale = await (prisma as any).sale.findFirst({
      where: { id, isPos: false, deletedAt: null },
      include: {
        lines: {
          include: {
            product: {
              select: {
                baseUnit: { select: { type: true, allowDecimal: true } },
                unit:     { select: { type: true, allowDecimal: true } },
              },
            },
          },
        },
      },
    });
    if (!sale) throw new HttpError(404, 'Invoice not found');
    if (sale.status !== 'DRAFT') {
      throw new HttpError(409, `Cannot confirm a ${sale.status.toLowerCase()} invoice`);
    }

    logger.info({ saleId: id, number: sale.number, lines: sale.lines.length }, 'Confirming invoice');

    // Manually-picked batches (multi-batch products) — validate existence and
    // ownership up front; qty/expiry are re-checked under lock inside the
    // transaction below (mirrors POS checkout's batchMap pattern).
    const saleBatchIdSet = new Set<string>();
    for (const l of sale.lines) {
      if (l.batchId) saleBatchIdSet.add(l.batchId as string);
    }
    const saleBatchIds: string[] = Array.from(saleBatchIdSet);
    const saleBatchMap = new Map<string, { id: string; productId: string; warehouseId: string; qty: any; expiryDate: Date | null }>();
    if (saleBatchIds.length > 0) {
      const batchRows = await prisma.stockBatch.findMany({ where: { id: { in: saleBatchIds } } });
      for (const b of batchRows) saleBatchMap.set(b.id, b as any);
      for (const line of sale.lines) {
        if (!(line as any).batchId) continue;
        const batch = saleBatchMap.get((line as any).batchId);
        if (!batch || batch.productId !== line.productId || batch.warehouseId !== sale.warehouseId) {
          throw new HttpError(400, `Selected batch is invalid for one of this invoice's lines — re-select the batch and try again.`);
        }
      }
    }

    // CHUNK 22a (v1.0.73): enforce integer qty for COUNT products on sale
    // confirmation. Count-ness is resolved from the BASE unit (`baseUnit ??
    // unit`), so the value validated must be the BASE quantity: for a line
    // with a non-base unit selected, baseQty holds the converted count; for
    // legacy/no-unit lines baseQty is null and `baseQty ?? qty` falls back to
    // qty (which IS the base qty there) — byte-identical to the pre-unit
    // behaviour. Resolves count-ness from `baseUnit ?? unit` — matches the
    // codebase convention and protects null-baseUnit products (43% of ACM
    // data). Mirrors chunks 9/10/20/21. Note: Decimal → Number.isInteger is
    // always false, so coerce via Number(...). The interpolated value reports
    // the same base quantity that was checked (approved exception, Flag A).
    for (const line of sale.lines) {
      const saleBaseUnitMeta = line.product?.baseUnit ?? line.product?.unit;
      if (saleBaseUnitMeta && (saleBaseUnitMeta.type === 'COUNT' || saleBaseUnitMeta.allowDecimal === false)) {
        if (!Number.isInteger(Number(line.baseQty ?? line.qty))) {
          throw new HttpError(
            400,
            `Quantity for count-only products must be a whole number; got ${Number(line.baseQty ?? line.qty)}`,
          );
        }
      }
    }

    await prisma.$transaction(async (tx) => {
      // Lock each stock row with SELECT FOR UPDATE before checking or decrementing.
      // This serialises concurrent confirmations for the same product+warehouse so the
      // check and the decrement see the same committed value — preventing overselling.
      for (const line of sale.lines) {
        const locked = await tx.$queryRaw<{ qty: number }[]>`
          SELECT qty::float AS qty FROM "Stock"
          WHERE "productId" = ${line.productId} AND "warehouseId" = ${sale.warehouseId}
          FOR UPDATE
        `;
        const available = locked[0]?.qty ?? 0;
        // Availability is checked against the BASE quantity (null baseQty →
        // qty, which is base for legacy/no-unit lines). Must mirror the base
        // qty deducted below, else a non-base unit (e.g. 2 boxes) would be
        // checked against display qty instead of base qty (24 pcs).
        const needed    = Number(line.baseQty ?? line.qty);
        if (available < needed) {
          const product = await tx.product.findUnique({
            where: { id: line.productId },
            select: { name: true },
          });
          throw new HttpError(
            400,
            `Insufficient stock for "${product?.name}": available ${available}, needed ${needed}`,
          );
        }

        // Manually-picked batch: qty is capped to that specific batch, not the
        // product's aggregate stock (mirrors POS checkout).
        const lineBatchId = (line as any).batchId as string | null;
        if (lineBatchId) {
          const batch = saleBatchMap.get(lineBatchId)!;
          const batchQty = Number(batch.qty);
          if (batchQty < needed) {
            const product = await tx.product.findUnique({ where: { id: line.productId }, select: { name: true } });
            throw new HttpError(
              400,
              `Selected batch for "${product?.name}" only has ${batchQty} available (requested ${needed}). Pick a different batch or reduce the quantity.`,
            );
          }
          if (batch.expiryDate && batch.expiryDate <= new Date()) {
            const product = await tx.product.findUnique({ where: { id: line.productId }, select: { name: true } });
            throw new HttpError(400, `Selected batch for "${product?.name}" is expired and cannot be sold.`);
          }
        }
      }

      // Confirm the invoice
      await tx.sale.update({ where: { id }, data: { status: 'CONFIRMED' } });

      // Deduct stock + write SALE_OUT movements (row is still locked for this transaction)
      for (const line of sale.lines) {
        // Mirror POS checkout exactly: deduct from StockBatch rows in FEFO order,
        // then reconcile the aggregate Stock.qty. When a non-base sales unit was
        // selected, baseQty holds the converted count; otherwise baseQty is null
        // and line.qty IS the base qty (null baseQty → qty is base). includeExpired
        // = false (BLOCK default — confirmSale has no expiredStockPolicy in scope).
        const baseQty = Number(line.baseQty ?? line.qty);
        const lineBatchId = (line as any).batchId as string | null;

        if (lineBatchId) {
          // Manually-picked batch: deduct from exactly that row, re-checked
          // under lock (mirrors POS checkout — no FEFO fallback).
          const batchLocked = await tx.$queryRaw<{ qty: number }[]>`
            SELECT qty::float AS qty FROM "stock_batches" WHERE id = ${lineBatchId} FOR UPDATE
          `;
          const lockedBatchQty = batchLocked[0]?.qty ?? 0;
          if (lockedBatchQty < baseQty) {
            const product = await tx.product.findUnique({ where: { id: line.productId }, select: { name: true } });
            throw new HttpError(
              400,
              `Selected batch for "${product?.name}" no longer has enough stock (available: ${lockedBatchQty}, requested: ${baseQty}).`,
            );
          }
          await tx.stockBatch.update({ where: { id: lineBatchId }, data: { qty: { decrement: baseQty } } });
          await recomputeStockQty(tx, line.productId, sale.warehouseId);
        } else {
          const deducted = await deductBatchesFEFO(tx, line.productId, sale.warehouseId, baseQty, false);
          if (deducted > 0) {
            // Batch-tracked product: batches are the source of truth. Recompute the
            // aggregate from the (already-decremented) batch sum so it can never go
            // negative. Replaces the old raw `decrement: line.qty` upsert.
            await recomputeStockQty(tx, line.productId, sale.warehouseId);
          } else {
            // No batch rows existed (pre-batch-tracking stock) — FEFO was a no-op,
            // so the batch sum is 0 and recompute would WIPE legitimate stock.
            // Keep the legacy aggregate decrement, floored at 0.
            const cur = await tx.stock.findUnique({
              where:  { productId_warehouseId: { productId: line.productId, warehouseId: sale.warehouseId } },
              select: { qty: true },
            });
            const newQty = Math.max(0, Number(cur?.qty ?? 0) - baseQty);
            await tx.stock.upsert({
              where:  { productId_warehouseId: { productId: line.productId, warehouseId: sale.warehouseId } },
              update: { qty: newQty },
              create: { productId: line.productId, warehouseId: sale.warehouseId, qty: 0 },
            });
          }
        }
        // Log the BASE quantity that was actually deducted. null baseQty → qty,
        // byte-identical for legacy/no-unit lines. Stored negative: SALE_OUT
        // removes stock, and recordStockMovement derives the sign from the type.
        await recordStockMovement(tx, {
          productId:   line.productId,
          warehouseId: sale.warehouseId,
          type:        'SALE_OUT',
          qty:         Number(line.baseQty ?? line.qty),
          refType:     'Sale',
          refId:       id,
          batchId:     lineBatchId,
          note:        `Invoice ${sale.number}`,
        });
      }
    });

    logger.info({ saleId: id, number: sale.number }, 'Invoice confirmed');

    return prisma.sale.findUnique({
      where: { id },
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
      },
    });
  },

  // ── Update invoice (DRAFT only) ───────────────────────────────────────────

  updateSale: async (id: string, input: import('./sales.schema.js').UpdateSaleInput) => {
    const sale = await (prisma as any).sale.findFirst({ where: { id, isPos: false, deletedAt: null }, include: { lines: true } });
    if (!sale) throw new HttpError(404, 'Invoice not found');
    if (sale.status !== 'DRAFT') throw new HttpError(400, 'Cannot edit a confirmed or cancelled invoice');

    const lines = input.lines ?? [];
    let subtotalCents = 0;
    for (const l of lines) {
      subtotalCents += Math.round(l.qty * l.unitPriceCents) - (l.discountCents ?? 0);
    }
    const discountCents = input.discountCents ?? sale.discountCents;
    const totalCents = Math.max(0, subtotalCents - discountCents);

    // Resolve baseQty per line (unit conversion) — same treatment as createSale.
    // Load only the unit-role fields needed to know each product's base unit.
    const productIds = [...new Set(lines.map((l) => l.productId))];
    const lineProducts = productIds.length
      ? await prisma.product.findMany({
          where: { id: { in: productIds } },
          select: { id: true, baseUnitId: true, unitId: true },
        })
      : [];
    const computedLines = await Promise.all(
      lines.map(async (l) => {
        const product = lineProducts.find((p) => p.id === l.productId);
        const baseUnitId = product?.baseUnitId ?? product?.unitId;
        let baseQty = l.qty;
        if (l.unitId && baseUnitId && l.unitId !== baseUnitId) {
          const r = await convertToBaseUnit(l.productId, l.unitId, new Decimal(l.qty), prisma);
          baseQty = r.baseQty.toNumber();
        }
        return { ...l, baseQty };
      }),
    );

    return prisma.$transaction(async (tx) => {
      await tx.saleLine.deleteMany({ where: { saleId: id } });
      return tx.sale.update({
        where: { id },
        data: {
          customerId:   input.customerId !== undefined ? (input.customerId ?? null) : sale.customerId,
          warehouseId:  input.warehouseId ?? sale.warehouseId,
          date:         input.date ? new Date(input.date) : sale.date,
          note:         input.note !== undefined ? (input.note ?? null) : sale.note,
          discountCents,
          subtotalCents,
          totalCents,
          lines: {
            create: computedLines.map((l) => ({
              productId:     l.productId,
              qty:           l.qty,
              unitPriceCents:l.unitPriceCents,
              taxPercent:    l.taxPercent,
              discountCents: l.discountCents ?? 0,
              lineTotalCents: Math.round(l.qty * l.unitPriceCents) - (l.discountCents ?? 0),
              unitId:        l.unitId ?? null,
              baseQty:       l.baseQty !== l.qty ? l.baseQty : null,
              batchId:       l.batchId ?? null,
            })),
          },
        },
        include: {
          customer:  { select: { id: true, name: true } },
          warehouse: { select: { id: true, name: true, code: true } },
          createdBy: { select: { id: true, fullName: true } },
          lines: { include: { product: { select: { id: true, name: true, sku: true, unit: { select: { shortCode: true } } } } } },
        },
      });
    });
  },

  // ── Cancel invoice (DRAFT only) ────────────────────────────────────────────

  cancelSale: async (id: string) => {
    const sale = await (prisma as any).sale.findFirst({ where: { id, isPos: false, deletedAt: null } });
    if (!sale) throw new HttpError(404, 'Invoice not found');
    if (sale.status !== 'DRAFT') {
      throw new HttpError(409, `Cannot cancel a ${sale.status.toLowerCase()} invoice`);
    }
    return prisma.sale.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });
  },

  // ── Record payment (creates Payment row + increments paidCents) ──────────

  recordPayment: async (id: string, input: RecordPaymentInput, userId: string) => {
    const sale = await (prisma as any).sale.findFirst({ where: { id, deletedAt: null } });
    if (!sale) throw new HttpError(404, 'Sale not found');
    if (sale.status !== 'CONFIRMED') throw new HttpError(400, 'Can only record payment on confirmed invoices');
    if (input.paidCents <= 0) throw new HttpError(400, 'Payment amount must be greater than 0');

    // Sales returns reduce what the customer effectively owes (v1.0.54).
    // effectiveTotal = totalCents - sum(returns); cap payment at effectiveTotal - paidCents.
    // SaleReturn has no soft-delete. If voiding is added: add isActive:true filter here.
    const returnsAgg = await prisma.saleReturn.aggregate({
      where: { saleId: id },
      _sum: { totalCents: true },
    });
    const returnedCents = returnsAgg._sum.totalCents ?? 0;
    const effectiveTotal = Math.max(0, sale.totalCents - returnedCents);
    const outstanding = effectiveTotal - sale.paidCents;
    if (outstanding <= 0) {
      throw new HttpError(400, 'This invoice has been fully paid or refunded. No payment due.');
    }
    if (input.paidCents > outstanding) {
      throw new HttpError(400, `Payment exceeds outstanding balance of Rs.${(outstanding / 100).toFixed(2)}`);
    }

    return prisma.$transaction(async (tx) => {
      await tx.payment.create({
        data: {
          saleId:      id,
          amountCents: input.paidCents,
          method:      input.paymentMethod,
          createdById: userId,
        },
      });
      return tx.sale.update({
        where: { id },
        data: { paidCents: { increment: input.paidCents }, paymentMethod: input.paymentMethod },
      });
    });
  },

  // ── List payments for a sale ──────────────────────────────────────────────

  listPayments: async (id: string) => {
    const sale = await (prisma as any).sale.findFirst({ where: { id, deletedAt: null } });
    if (!sale) throw new HttpError(404, 'Sale not found');
    return prisma.payment.findMany({
      where: { saleId: id },
      orderBy: { createdAt: 'asc' },
      include: { createdBy: { select: { fullName: true } } },
    });
  },

  deleteSale: async (id: string, userId: string) => {
    const sale = await (prisma as any).sale.findFirst({ where: { id, isPos: false, deletedAt: null } });
    if (!sale) throw new HttpError(404, 'Invoice not found');
    if (sale.status !== 'DRAFT') throw new HttpError(400, 'Only DRAFT invoices can be deleted');
    await (prisma as any).sale.update({
      where: { id },
      data: { deletedAt: new Date(), deletedById: userId },
    });
    return { success: true };
  },
};
