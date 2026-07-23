import bcrypt from 'bcryptjs';
import { prisma } from '../../config/prisma.js';
import { HttpError } from '../../middleware/error-handler.js';

export type ResetPreset = 'transactions' | 'keepProducts' | 'full';

// ─── Transactional wipe (shared by all presets) ────────────────────────────────
// Ordered children → parents so plain deleteMany never hits an FK constraint,
// independent of whether a relation has onDelete: Cascade. Run inside a $transaction.
async function clearTransactions(tx: any): Promise<void> {
  // Sales side
  await tx.saleReturnLine.deleteMany({});
  await tx.saleReturn.deleteMany({});
  await tx.salePromotion.deleteMany({});
  await tx.saleLine.deleteMany({});
  await tx.loyaltyTransaction.deleteMany({});
  await tx.customerPayment.deleteMany({});
  await tx.customerCreditLedger.deleteMany({});
  await tx.posDraftItem.deleteMany({});
  await tx.posDraft.deleteMany({});
  await tx.posShift.deleteMany({});
  await tx.payment.deleteMany({});
  await tx.sale.deleteMany({});
  // Purchases side
  await tx.purchaseReturnLine.deleteMany({});
  await tx.purchaseReturn.deleteMany({});
  await tx.purchaseReceiptLine.deleteMany({});
  await tx.purchaseReceipt.deleteMany({});
  await tx.supplierPayment.deleteMany({});
  await tx.supplierCreditLedger.deleteMany({});
  await tx.purchaseLine.deleteMany({});
  await tx.purchase.deleteMany({});
  // Inventory
  await tx.stockTakeLine.deleteMany({});
  await tx.stockTake.deleteMany({});
  await tx.stockMovement.deleteMany({});
  await tx.stockBatch.deleteMany({});
  await tx.stockAlert.deleteMany({});
  await tx.stock.deleteMany({});
  // Misc transactional
  await tx.expense.deleteMany({});
  await tx.quotationLine.deleteMany({});
  await tx.quotation.deleteMany({});
  await tx.attachment.deleteMany({});
}

// Contacts (after transactions are gone). Product may point at a supplier via
// defaultSupplierId — unlink first so supplier delete can't hit that FK.
async function clearContacts(tx: any): Promise<void> {
  await tx.product.updateMany({ data: { defaultSupplierId: null } });
  await tx.customer.deleteMany({});
  await tx.supplier.deleteMany({});
}

// Products + master data (after transactions + contacts are gone).
async function clearProductsAndMaster(tx: any): Promise<void> {
  await tx.productUnitConversion.deleteMany({});
  await tx.product.deleteMany({});
  await tx.salePromotion.deleteMany({}); // safety (already cleared)
  await tx.promotion.deleteMany({});
  await tx.category.updateMany({ data: { parentId: null } }); // self-relation → break links first
  await tx.category.deleteMany({});
  await tx.brand.deleteMany({});
  await tx.unit.deleteMany({});
  await tx.expenseCategory.deleteMany({});
  await tx.loyaltyConfig.deleteMany({});
}

// Full ordered wipe for a preset (exported so it can be validated in a
// rollback transaction without persisting). Caller supplies the tx client.
export async function applyReset(tx: any, preset: ResetPreset): Promise<void> {
  const s = scopeOf(preset);
  await clearTransactions(tx);
  if (s.contacts)          await clearContacts(tx);
  if (s.productsAndMaster) await clearProductsAndMaster(tx);
  if (s.nonSuperUsers)     await tx.user.deleteMany({ where: { NOT: { role: 'SUPER_ADMIN' as const } } });
}

// Which entity groups a preset clears (drives the preview counts + the wipe).
function scopeOf(preset: ResetPreset) {
  return {
    transactions: true,
    contacts: preset === 'keepProducts' || preset === 'full',
    productsAndMaster: preset === 'full',
    nonSuperUsers: preset === 'full',
  };
}

export const resetService = {
  // ── Dry-run preview — counts of what WILL be deleted (nothing is modified) ────
  async preview(preset: ResetPreset) {
    const s = scopeOf(preset);
    const [
      sales, purchases, payments, stockMovements, expenses, quotations,
      customers, suppliers, products, nonSuperUsers,
    ] = await prisma.$transaction([
      prisma.sale.count(),
      prisma.purchase.count(),
      prisma.payment.count(),
      prisma.stockMovement.count(),
      prisma.expense.count(),
      prisma.quotation.count(),
      prisma.customer.count(),
      prisma.supplier.count(),
      prisma.product.count(),
      prisma.user.count({ where: { NOT: { role: 'SUPER_ADMIN' as const } } }),
    ]);
    return {
      preset,
      willClear: {
        transactions: { sales, purchases, payments, stockMovements, expenses, quotations },
        contacts:     s.contacts          ? { customers, suppliers } : null,
        products:     s.productsAndMaster ? { products } : null,
        users:        s.nonSuperUsers     ? { nonSuperUsers } : null,
      },
      keeps: {
        superAdmin: true,
        settings:   true,
        warehouses: true,
        products:   preset !== 'full',
        contacts:   preset === 'transactions',
      },
    };
  },

  // ── Execute the reset (destructive) — requires the caller's password ──────────
  async execute(preset: ResetPreset, userId: string, password: string) {
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { passwordHash: true, role: true } });
    if (!user) throw new HttpError(401, 'Not authenticated');
    const okPw = await bcrypt.compare(password, user.passwordHash);
    if (!okPw) throw new HttpError(403, 'Incorrect password');

    await prisma.$transaction((tx) => applyReset(tx, preset), { timeout: 120_000 });

    return { success: true, preset };
  },
};
