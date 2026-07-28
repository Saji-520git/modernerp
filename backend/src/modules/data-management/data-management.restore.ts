import bcrypt from 'bcryptjs';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../middleware/error-handler.js';

// ─── Restore from a Phase-3 backup JSON ─────────────────────────────────────────
// FULL replace: wipe every table, then re-insert the snapshot. Wipe + insert run
// in ONE transaction, so a failed/incompatible import rolls the wipe back too —
// a failed restore never leaves the system empty.

// Insert order: parents → children (reverse of the delete order). Each entry maps
// a backup key to its Prisma model. Category is self-referential (parentId) and is
// handled specially (insert with parentId nulled, then re-link).
const INSERT_ORDER: Array<[string, string]> = [
  ['appSettings', 'appSettings'],
  ['users', 'user'],
  ['warehouses', 'warehouse'],
  ['brands', 'brand'],
  ['units', 'unit'],
  // categories handled separately (self-relation)
  ['expenseCategories', 'expenseCategory'],
  ['loyaltyConfig', 'loyaltyConfig'],
  ['promotions', 'promotion'],
  ['suppliers', 'supplier'],
  ['customers', 'customer'],
  ['products', 'product'],
  ['productUnitConversions', 'productUnitConversion'],
  ['purchases', 'purchase'],
  ['purchaseLines', 'purchaseLine'],
  ['purchaseReceipts', 'purchaseReceipt'],
  ['purchaseReceiptLines', 'purchaseReceiptLine'],
  ['purchaseReturns', 'purchaseReturn'],
  ['purchaseReturnLines', 'purchaseReturnLine'],
  ['supplierPayments', 'supplierPayment'],
  ['supplierCreditLedger', 'supplierCreditLedger'],
  ['sales', 'sale'],
  ['saleLines', 'saleLine'],
  ['saleReturns', 'saleReturn'],
  ['saleReturnLines', 'saleReturnLine'],
  ['salePromotions', 'salePromotion'],
  ['payments', 'payment'],
  ['customerPayments', 'customerPayment'],
  ['loyaltyTransactions', 'loyaltyTransaction'],
  ['customerCreditLedger', 'customerCreditLedger'],
  ['posShifts', 'posShift'],
  ['posDrafts', 'posDraft'],
  ['posDraftItems', 'posDraftItem'],
  ['stock', 'stock'],
  ['stockMovements', 'stockMovement'],
  ['stockBatches', 'stockBatch'],
  ['stockAlerts', 'stockAlert'],
  ['stockTakes', 'stockTake'],
  ['stockTakeLines', 'stockTakeLine'],
  ['expenses', 'expense'],
  ['attachments', 'attachment'],
  ['quotations', 'quotation'],
  ['quotationLines', 'quotationLine'],
];

// Delete order: children → parents (a superset of the reset wipe — also removes the
// tables the reset keeps: users, warehouses, settings, master data).
async function wipeAll(tx: any): Promise<void> {
  // Transactions
  await tx.saleReturnLine.deleteMany({});
  await tx.saleReturn.deleteMany({});
  await tx.salePromotion.deleteMany({});
  await tx.saleLine.deleteMany({});
  await tx.loyaltyTransaction.deleteMany({});
  await tx.customerPayment.deleteMany({});
  await tx.customerCreditLedger.deleteMany({});
  await tx.payment.deleteMany({});
  await tx.sale.deleteMany({});
  await tx.purchaseReturnLine.deleteMany({});
  await tx.purchaseReturn.deleteMany({});
  await tx.purchaseReceiptLine.deleteMany({});
  await tx.purchaseReceipt.deleteMany({});
  await tx.supplierPayment.deleteMany({});
  await tx.supplierCreditLedger.deleteMany({});
  await tx.stockBatch.deleteMany({});      // FK → purchaseLine
  await tx.purchaseLine.deleteMany({});
  await tx.purchase.deleteMany({});
  await tx.posDraftItem.deleteMany({});
  await tx.posDraft.deleteMany({});
  await tx.posShift.deleteMany({});
  await tx.stockTakeLine.deleteMany({});
  await tx.stockTake.deleteMany({});
  await tx.stockMovement.deleteMany({});
  await tx.stockAlert.deleteMany({});
  await tx.stock.deleteMany({});
  await tx.expense.deleteMany({});
  await tx.quotationLine.deleteMany({});
  await tx.quotation.deleteMany({});
  await tx.attachment.deleteMany({});
  // Master + contacts
  await tx.productUnitConversion.deleteMany({});
  await tx.product.updateMany({ data: { defaultSupplierId: null } });
  await tx.customer.deleteMany({});
  await tx.supplier.deleteMany({});
  await tx.product.deleteMany({});
  await tx.promotion.deleteMany({});
  await tx.category.updateMany({ data: { parentId: null } });
  await tx.category.deleteMany({});
  await tx.brand.deleteMany({});
  await tx.unit.deleteMany({});
  await tx.expenseCategory.deleteMany({});
  await tx.loyaltyConfig.deleteMany({});
  // Config
  await tx.user.deleteMany({});
  await tx.warehouse.deleteMany({});
  await tx.appSettings.deleteMany({});
}

// Insert every table from the backup in parent→child order. Returns counts inserted.
export async function applyRestore(tx: any, tables: Record<string, any[]>): Promise<Record<string, number>> {
  const counts: Record<string, number> = {};

  // 1. Categories with parentId nulled (self-relation), remember the links.
  const cats: any[] = tables.categories ?? [];
  if (cats.length) {
    await tx.category.createMany({ data: cats.map((c) => ({ ...c, parentId: null })) });
    counts.categories = cats.length;
  }

  // 2. Everything else in order.
  for (const [key, model] of INSERT_ORDER) {
    const rows: any[] = tables[key] ?? [];
    if (rows.length) {
      await tx[model].createMany({ data: rows });
      counts[key] = rows.length;
    }
  }

  // 3. Re-link category parents now that all category rows exist.
  for (const c of cats) {
    if (c.parentId) await tx.category.update({ where: { id: c.id }, data: { parentId: c.parentId } });
  }

  return counts;
}

function validate(backup: any): Record<string, any[]> {
  if (!backup || typeof backup !== 'object' || backup.version !== 1 || !backup.tables || typeof backup.tables !== 'object') {
    throw new HttpError(400, 'Not a valid BROcode backup file (expected version 1 with a tables object).');
  }
  return backup.tables as Record<string, any[]>;
}

export const restoreService = {
  // Counts found in the uploaded file (read-only preview).
  preview(backup: any) {
    const tables = validate(backup);
    const summary: Record<string, number> = {};
    for (const [k, v] of Object.entries(tables)) summary[k] = Array.isArray(v) ? v.length : 0;
    return { exportedAt: backup.exportedAt ?? null, counts: summary };
  },

  // Destructive: wipe + restore in one transaction. Requires the caller's password.
  async execute(backup: any, userId: string, password: string) {
    const tables = validate(backup);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true } });
    if (!user) throw new HttpError(401, 'Not authenticated');
    const okPw = await bcrypt.compare(password, user.passwordHash);
    if (!okPw) throw new HttpError(403, 'Incorrect password');

    const counts = await prisma.$transaction(async (tx) => {
      await wipeAll(tx);
      return applyRestore(tx, tables);
    }, { timeout: 300_000 });

    return { success: true, counts };
  },
};
