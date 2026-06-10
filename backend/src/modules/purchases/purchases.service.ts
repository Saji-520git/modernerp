import { Decimal } from '@prisma/client/runtime/library';
import { prisma } from '../../config/prisma.js';
import { logger } from '../../config/logger.js';
import { HttpError } from '../../middleware/error-handler.js';
import { convertToBaseUnit } from '../../utils/unit-converter.js';
import { createFullReceiptRecord } from './purchase-receipt.service.js';
import type { CreatePurchaseInput, UpdatePurchaseInput, ListPurchasesInput, FromAlertsInput } from './purchases.schema.js';

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function generatePONumber(): Promise<string> {
  const year = new Date().getFullYear();
  const prefix = `PO-${year}-`;
  const count = await prisma.purchase.count({
    where: { number: { startsWith: prefix } },
  });
  return `${prefix}${String(count + 1).padStart(4, '0')}`;
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
    const { search, status, supplierId, page, pageSize } = input;

    const where = {
      deletedAt: null,
      ...(status && { status }),
      ...(supplierId && { supplierId }),
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

    const number = await generatePONumber();

    // Compute line and order totals — no tax per business decision
    const computedLines = input.lines.map((line) => {
      const subtotal = Math.round(Number(line.qty) * line.unitCostCents);
      return { ...line, subtotalCents: subtotal, taxLineCents: 0, lineTotalCents: subtotal };
    });

    const subtotalCents = computedLines.reduce((s, l) => s + l.subtotalCents, 0);
    const taxCents = 0;
    const totalCents = subtotalCents;

    const purchase = await prisma.purchase.create({
      data: {
        number,
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
    });

    return purchase;
  },

  // ── Confirm PO → adds stock ────────────────────────────────────────────────

  confirmPurchase: async (id: string, userId?: string) => {
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

      // Pre-fetch every line's product once (avoids a findUnique per line inside the loop)
      const lineProductIds = purchase.lines.map((l: any) => l.productId);
      const lineProducts = await tx.product.findMany({
        where: { id: { in: lineProductIds } },
        select: { id: true, baseUnitId: true, unitId: true },
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

        // Upsert stock (always in base units)
        await tx.stock.upsert({
          where: {
            productId_warehouseId: {
              productId: line.productId,
              warehouseId: purchase.warehouseId,
            },
          },
          create: {
            productId: line.productId,
            warehouseId: purchase.warehouseId,
            qty: baseQty,
          },
          update: { qty: { increment: baseQty } },
        });

        // Create PURCHASE_IN movement
        await tx.stockMovement.create({
          data: {
            productId: line.productId,
            warehouseId: purchase.warehouseId,
            type: 'PURCHASE_IN',
            qty: baseQty,
            refType: 'Purchase',
            refId: id,
            note: `PO ${purchase.number}`,
          },
        });

        // Update product's last cost + auto-reactivate if inactive
        // (physical stock means it should be sellable regardless of prior inactive status)
        await tx.product.update({
          where: { id: line.productId },
          data: { costCents: costPerBaseCents, isActive: true },
        });

        // Create stock batch row (tracks expiry per batch)
        await (tx as any).stockBatch.create({
          data: {
            productId:      line.productId,
            warehouseId:    purchase.warehouseId,
            purchaseLineId: line.id,
            qty:            baseQty,
            expiryDate:     (line as any).expiryDate ?? null,
          },
        });

        // Set receivedQty INSIDE the confirm transaction so a purchase return is
        // always possible even if the post-transaction GRN record (createFullReceiptRecord)
        // fails. createFullReceiptRecord later sets the same absolute value — idempotent.
        await tx.purchaseLine.update({
          where: { id: line.id },
          data:  { receivedQty: line.qty },
        });
      }
    });

    // ── NEW: create GRN document for backward-compat full delivery ────────────
    if (userId) {
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

    const number = await generatePONumber();

    const computedLines = input.items.map((item) => {
      const unitCostCents = item.unitCostCents ?? costMap.get(item.productId) ?? 0;
      const lineTotalCents = Math.round(item.qty * unitCostCents);
      return { productId: item.productId, qty: item.qty, unitCostCents, lineTotalCents };
    });

    const totalCents = computedLines.reduce((s, l) => s + l.lineTotalCents, 0);

    return prisma.purchase.create({
      data: {
        number,
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
    });
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
