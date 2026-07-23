import { prisma } from '../../config/prisma.js';

// Full data snapshot — every table's rows, for a faithful backup/restore.
// Read-only. The result contains sensitive data (incl. hashed passwords), so the
// download is guarded by the same super-admin route protection as the rest of the
// Data Management module.
export const backupService = {
  async exportAll() {
    const [
      users, categories, brands, units, warehouses, products, productUnitConversions,
      stock, stockMovements, stockBatches, stockAlerts, stockTakes, stockTakeLines,
      customers, suppliers, customerCreditLedger, supplierCreditLedger,
      purchases, purchaseLines, purchaseReceipts, purchaseReceiptLines,
      purchaseReturns, purchaseReturnLines, supplierPayments,
      sales, saleLines, saleReturns, saleReturnLines, salePromotions,
      payments, customerPayments, posDrafts, posDraftItems, posShifts,
      expenseCategories, expenses, promotions, attachments,
      loyaltyConfig, loyaltyTransactions, quotations, quotationLines, appSettings,
    ] = await prisma.$transaction([
      prisma.user.findMany(), prisma.category.findMany(), prisma.brand.findMany(),
      prisma.unit.findMany(), prisma.warehouse.findMany(), prisma.product.findMany(),
      prisma.productUnitConversion.findMany(), prisma.stock.findMany(),
      prisma.stockMovement.findMany(), prisma.stockBatch.findMany(), prisma.stockAlert.findMany(),
      prisma.stockTake.findMany(), prisma.stockTakeLine.findMany(),
      prisma.customer.findMany(), prisma.supplier.findMany(),
      prisma.customerCreditLedger.findMany(), prisma.supplierCreditLedger.findMany(),
      prisma.purchase.findMany(), prisma.purchaseLine.findMany(),
      prisma.purchaseReceipt.findMany(), prisma.purchaseReceiptLine.findMany(),
      prisma.purchaseReturn.findMany(), prisma.purchaseReturnLine.findMany(),
      prisma.supplierPayment.findMany(),
      prisma.sale.findMany(), prisma.saleLine.findMany(), prisma.saleReturn.findMany(),
      prisma.saleReturnLine.findMany(), prisma.salePromotion.findMany(),
      prisma.payment.findMany(), prisma.customerPayment.findMany(),
      prisma.posDraft.findMany(), prisma.posDraftItem.findMany(), prisma.posShift.findMany(),
      prisma.expenseCategory.findMany(), prisma.expense.findMany(),
      prisma.promotion.findMany(), prisma.attachment.findMany(),
      prisma.loyaltyConfig.findMany(), prisma.loyaltyTransaction.findMany(),
      prisma.quotation.findMany(), prisma.quotationLine.findMany(), prisma.appSettings.findMany(),
    ]);

    return {
      version: 1,
      exportedAt: new Date().toISOString(),
      tables: {
        users, categories, brands, units, warehouses, products, productUnitConversions,
        stock, stockMovements, stockBatches, stockAlerts, stockTakes, stockTakeLines,
        customers, suppliers, customerCreditLedger, supplierCreditLedger,
        purchases, purchaseLines, purchaseReceipts, purchaseReceiptLines,
        purchaseReturns, purchaseReturnLines, supplierPayments,
        sales, saleLines, saleReturns, saleReturnLines, salePromotions,
        payments, customerPayments, posDrafts, posDraftItems, posShifts,
        expenseCategories, expenses, promotions, attachments,
        loyaltyConfig, loyaltyTransactions, quotations, quotationLines, appSettings,
      },
    };
  },
};
