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
};
