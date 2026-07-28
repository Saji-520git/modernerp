import { prisma } from '../../config/prisma.js';
import { productsService } from '../products/products.service.js';
import { suppliersService } from '../suppliers/suppliers.service.js';
import { customersService } from '../customers/customers.service.js';

export type ClearableEntity = 'product' | 'supplier' | 'customer';

async function entityExists(type: ClearableEntity, id: string): Promise<boolean> {
  if (type === 'product')  return !!(await prisma.product.findUnique({ where: { id }, select: { id: true } }));
  if (type === 'supplier') return !!(await prisma.supplier.findUnique({ where: { id }, select: { id: true } }));
  return !!(await prisma.customer.findUnique({ where: { id }, select: { id: true } }));
}

export const dataManagementService = {
  // ── Read-only footprint — counts per entity (nothing is modified) ────────────
  async summary() {
    const [
      products, activeProducts, suppliers, customers, sales, purchases,
      stockMovements, saleReturns, purchaseReturns, supplierPayments,
      customerPayments, expenses, quotations,
    ] = await prisma.$transaction([
      prisma.product.count(),
      prisma.product.count({ where: { isActive: true } }),
      prisma.supplier.count(),
      prisma.customer.count(),
      prisma.sale.count(),
      prisma.purchase.count(),
      prisma.stockMovement.count(),
      prisma.saleReturn.count(),
      prisma.purchaseReturn.count(),
      prisma.supplierPayment.count(),
      prisma.customerPayment.count(),
      prisma.expense.count(),
      prisma.quotation.count(),
    ]);
    return {
      products, activeProducts, suppliers, customers, sales, purchases,
      stockMovements, saleReturns, purchaseReturns, supplierPayments,
      customerPayments, expenses, quotations,
    };
  },

  // ── Bulk selective clear ─────────────────────────────────────────────────────
  // Reuses each entity's proven smart-delete: it blocks when stock is on hand,
  // soft-deletes (hides, keeps history) when transactions exist, and hard-deletes
  // only when the record is clean. We never write our own destructive path here.
  async clearEntities(type: ClearableEntity, ids: string[]) {
    const report = {
      requested:   ids.length,
      removed:     0,
      softDeleted: 0,
      blocked:     [] as { id: string; reason: string }[],
    };
    for (const id of ids) {
      try {
        if (type === 'product')       await productsService.smartDelete(id);
        else if (type === 'supplier') await suppliersService.smartDelete(id);
        else                          await customersService.smartDelete(id);
        // Still present ⇒ soft-deleted (had history); gone ⇒ hard-removed.
        if (await entityExists(type, id)) report.softDeleted++;
        else                              report.removed++;
      } catch (e) {
        report.blocked.push({ id, reason: (e as { message?: string })?.message ?? 'Failed to delete' });
      }
    }
    return report;
  },

  // ── Audited bulk zero-stock ───────────────────────────────────────────────────
  // Sets on-hand stock to 0 for the given products (or ALL when productIds is null)
  // by recording a signed ADJUSTMENT movement per product×warehouse — history is
  // preserved (it's a correction, not a silent wipe and not a financial write-off).
  // Batches for the affected products are cleared so FEFO stays consistent.
  async zeroStock(productIds: string[] | null) {
    const where: { qty: { gt: number }; productId?: { in: string[] } } = { qty: { gt: 0 } };
    if (productIds && productIds.length) where.productId = { in: productIds };

    const rows = await prisma.stock.findMany({
      where,
      select: { id: true, productId: true, warehouseId: true, qty: true },
    });
    if (rows.length === 0) return { productsZeroed: 0, movements: 0 };

    const affected = new Set<string>();
    await prisma.$transaction(async (tx) => {
      for (const s of rows) {
        const q = Number(s.qty);
        await tx.stockMovement.create({
          data: {
            productId:   s.productId,
            warehouseId: s.warehouseId,
            type:        'ADJUSTMENT',
            qty:         -q,                 // signed: removing on-hand stock
            refType:     'DataManagement',
            note:        'Bulk zero stock',
          },
        });
        await tx.stock.update({ where: { id: s.id }, data: { qty: 0 } });
        affected.add(s.productId);
      }
      await tx.stockBatch.deleteMany({ where: { productId: { in: [...affected] } } });
    }, { timeout: 120_000 });

    return { productsZeroed: affected.size, movements: rows.length };
  },
};
