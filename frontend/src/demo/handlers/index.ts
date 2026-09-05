// ─── The demo route table ────────────────────────────────────────────────────
//
// Keys are "METHOD /path", with `:name` capturing a segment. Scoped
// deliberately to the flows the demo actually shows — not all ~150 endpoints of
// the real API. Anything absent returns a 404 the adapter logs to the console,
// which is how the sweep in docs/DEMO.md found the gaps.

import type { DemoHandler } from '../http';
import * as core from './core';
import * as catalog from './catalog';
import * as selling from './selling';
import * as buying from './buying';
import * as analytics from './analytics';
import * as importing from './importing';
import * as attachments from './attachments';

export const ROUTES: Record<string, DemoHandler> = {
  // ── Auth ──
  'POST /auth/login': core.login,
  'GET /auth/me': core.me,

  // ── Settings & master data ──
  'GET /settings': core.getSettings,
  'PATCH /settings': core.patchSettings,
  'GET /master-data/categories': core.listMaster('categories'),
  'POST /master-data/categories': core.createMaster('categories'),
  'PATCH /master-data/categories/:id': core.updateMaster('categories'),
  'DELETE /master-data/categories/:id': core.deleteMaster('categories'),
  'GET /master-data/brands': core.listMaster('brands'),
  'POST /master-data/brands': core.createMaster('brands'),
  'PATCH /master-data/brands/:id': core.updateMaster('brands'),
  'DELETE /master-data/brands/:id': core.deleteMaster('brands'),
  'GET /master-data/units': core.listMaster('units'),
  'POST /master-data/units': core.createMaster('units'),
  'PATCH /master-data/units/:id': core.updateMaster('units'),
  'DELETE /master-data/units/:id': core.deleteMaster('units'),
  'GET /units': core.listUnits,
  'GET /units/:id': core.getUnit,
  'POST /units': core.createMaster('units'),
  'PATCH /units/:id': core.updateMaster('units'),
  'DELETE /units/:id': core.deleteMaster('units'),

  // ── Warehouses ──
  'GET /warehouses': core.listWarehouses,
  'GET /warehouses/:id/stats': core.warehouseStats,
  'GET /warehouses/:id': core.getWarehouse,
  'POST /warehouses': core.createWarehouse,
  'PATCH /warehouses/:id': core.updateWarehouse,
  'POST /warehouses/:id/set-default': core.setDefaultWarehouse,
  'POST /warehouses/:id/toggle': core.toggleWarehouse,
  // Bare array here; the paged envelope lives on GET /warehouses.
  'GET /inventory/warehouses': core.listWarehousesBare,

  // ── Users ──
  'GET /users': core.listUsers,
  'GET /users/stats': core.userStats,
  'GET /users/:id': core.getUser,
  'POST /users': core.createUser,
  'PUT /users/:id': core.updateUser,
  'PATCH /users/:id/toggle-active': core.toggleUser,
  'PATCH /users/:id/permissions': core.setUserPermissions,
  'PATCH /users/:id/password': core.changePassword,

  // ── Products ──
  'GET /products': catalog.listProducts,
  'GET /products/meta': catalog.productsMeta,
  'GET /products/by-barcode/:barcode': catalog.getByBarcode,
  'GET /products/:id': catalog.getProduct,
  'GET /products/:id/conversions': catalog.productConversions,
  'POST /products': catalog.createProduct,
  'PATCH /products/:id': catalog.updateProduct,
  'PATCH /products/:id/toggle-active': catalog.toggleProduct,
  'DELETE /products/:id': catalog.deleteProduct,
  'PUT /products/:id/conversions': catalog.setProductConversions,

  // ── Inventory ──
  'GET /inventory/stock': catalog.listStock,
  'GET /inventory/low-stock': catalog.lowStock,
  'GET /inventory/expiring': catalog.listExpiring,
  'GET /inventory/batches/:productId/:warehouseId': catalog.batchDetail,
  'GET /inventory/movements': catalog.listMovements,
  'POST /inventory/adjustments': catalog.createAdjustment,
  'POST /inventory/transfers': catalog.createTransfer,
  'POST /inventory/write-off': catalog.writeOff,

  // ── Alerts ──
  'GET /inventory/alerts': catalog.listAlerts,
  'GET /inventory/alerts/count': catalog.alertCount,
  'POST /inventory/alerts/read': catalog.markAlertsRead,
  'POST /inventory/alerts/:id/dismiss': catalog.dismissAlert,
  'POST /inventory/alerts/dismiss-all': catalog.dismissAllAlerts,

  // ── POS ──
  'GET /pos/warehouses': selling.posWarehouses,
  'GET /pos/products': selling.posProducts,
  'GET /pos/products/:productId/batches': catalog.posBatches,
  'PATCH /pos/products/:id/price': selling.setPosPrice,
  'POST /pos/checkout': selling.posCheckout,
  'GET /pos/receipt/:id': selling.posReceipt,
  'GET /pos/sales': selling.posSales,
  'GET /pos/drafts': selling.listDrafts,
  'POST /pos/drafts': selling.saveDraft,
  'DELETE /pos/drafts/:id': selling.deleteDraft,
  'GET /pos/customer-credit/:id': selling.customerCredit,

  // ── Shifts ──
  'GET /pos/shifts': buying.listShifts,
  'GET /pos/shifts/current': buying.currentShift,
  'POST /pos/shifts/open': buying.openShift,
  'POST /pos/shifts/close': buying.closeShift,
  'GET /pos/shifts/:id': buying.getShift,
  'GET /pos/shifts/:id/preview': buying.shiftPreview,
  'POST /pos/shifts/:id/force-close': buying.forceCloseShift,

  // ── Sales ──
  // Verbs matter, and these are the ones the app actually uses. confirm/cancel/
  // pay are PATCH in salesApi, not POST — registering them as POST 404'd the
  // entire billing flow while every page still loaded fine, because a page load
  // only issues GETs. scripts/check-demo-routes.mjs now compares the two.
  'GET /sales': selling.listSales,
  'GET /sales/products': selling.salesProducts,
  'GET /sales/customers': selling.salesCustomers,
  'GET /sales/returns/list': selling.listReturns,
  'GET /sales/returns/for-sale/:id': selling.saleForReturn,
  'POST /sales/returns': selling.createReturn,
  'GET /sales/returns/:id': selling.getReturn,
  'GET /sales/:id': selling.getSale,
  'POST /sales': selling.createSale,
  'PATCH /sales/:id': selling.updateSale,
  'DELETE /sales/:id': selling.deleteSale,
  'PATCH /sales/:id/confirm': selling.confirmSale,
  'PATCH /sales/:id/cancel': selling.cancelSale,
  'PATCH /sales/:id/pay': selling.paySale,
  'GET /sales/:id/payments': selling.salePayments,
  'POST /sales/:id/payments': selling.recordSalePayment,

  // ── Customers ──
  'GET /customers': selling.listCustomers,
  'GET /customers/:id': selling.getCustomer,
  'POST /customers': selling.createCustomer,
  'PUT /customers/:id': selling.updateCustomer,
  'DELETE /customers/:id': selling.deleteCustomer,
  'PATCH /customers/:id/toggle-active': selling.toggleCustomer,

  // ── Customer payments ──
  'GET /customer-payments': selling.listCustomerPayments,
  'POST /customer-payments': selling.createCustomerPayment,
  'DELETE /customer-payments/:id': selling.deleteCustomerPayment,
  'GET /customer-payments/customer/:id': selling.paymentsForCustomer,
  'GET /customer-payments/sale/:id': selling.salePayments,
  'GET /customer-payments/credit-ledger/:id': selling.creditLedger,
  'POST /customer-payments/lump-sum': selling.lumpSumPayment,
  'POST /customer-payments/apply-credit': selling.applyCustomerCredit,

  // ── Purchases ──
  'GET /purchases': buying.listPurchases,
  'GET /purchases/products': buying.purchaseProducts,
  'GET /purchases/suppliers': buying.purchaseSuppliers,
  'GET /purchases/:id': buying.getPurchase,
  'GET /purchases/:id/receipts': buying.purchaseReceipts,
  'POST /purchases': buying.createPurchase,
  'PATCH /purchases/:id': buying.updatePurchase,
  'DELETE /purchases/:id': buying.deletePurchase,
  'PATCH /purchases/:id/confirm': buying.confirmPurchase,
  'PATCH /purchases/:id/cancel': buying.cancelPurchase,
  'PATCH /purchases/:id/close-short': buying.closePurchaseShort,
  'POST /purchases/:id/receipts': buying.receivePurchase,
  'GET /purchases/receipts/:id': buying.getPurchaseReceipt,
  'POST /purchases/from-alerts': buying.purchaseFromAlerts,

  // ── Purchase returns (debit notes) ──
  'GET /purchase-returns': buying.listPurchaseReturns,
  'POST /purchase-returns': buying.createPurchaseReturn,
  'GET /purchase-returns/:id': buying.getPurchaseReturn,
  'GET /purchase-returns/:id/debit-note': buying.purchaseReturnDebitNote,
  'PATCH /purchase-returns/:id/confirm': buying.confirmPurchaseReturn,
  'PATCH /purchase-returns/:id/cancel': buying.cancelPurchaseReturn,
  'DELETE /purchase-returns/:id': buying.deletePurchaseReturn,

  // ── Suppliers ──
  'GET /suppliers': buying.listSuppliers,
  'GET /suppliers/:id': buying.getSupplier,
  'POST /suppliers': buying.createSupplier,
  'PUT /suppliers/:id': buying.updateSupplier,
  'DELETE /suppliers/:id': buying.deleteSupplier,
  'PATCH /suppliers/:id/toggle-active': buying.toggleSupplier,

  // ── Supplier payments ──
  'GET /supplier-payments': buying.listSupplierPayments,
  'POST /supplier-payments': buying.createSupplierPaymentDirect,
  'DELETE /supplier-payments/:id': buying.deleteSupplierPayment,
  'GET /supplier-payments/purchase/:id': buying.supplierPaymentsForPurchase,
  'GET /supplier-payments/supplier/:id': buying.paymentsForSupplier,
  'GET /supplier-payments/:id/voucher-data': buying.supplierPaymentVoucher,
  'GET /supplier-payments/credit-ledger/:id': buying.supplierCreditLedger,
  'POST /supplier-payments/lump-sum': buying.supplierLumpSum,
  'POST /supplier-payments/apply-credit': buying.supplierApplyCredit,
  'POST /supplier-payments/credit': buying.supplierCredit,
  'POST /purchases/:id/payments': buying.createSupplierPayment,

  // ── Expenses ──
  'GET /expenses': buying.listExpenses,
  'GET /expenses/summary': buying.expenseSummary,
  'GET /expenses/categories': buying.listExpenseCategories,
  'POST /expenses/categories': buying.createExpenseCategory,
  'PATCH /expenses/categories/:id': buying.updateExpenseCategory,
  'DELETE /expenses/categories/:id': buying.deleteExpenseCategory,
  'GET /expenses/recurring': buying.listRecurring,
  'DELETE /expenses/recurring/:id': buying.deleteRecurring,
  'POST /expenses': buying.createExpense,
  'PATCH /expenses/:id': buying.updateExpense,
  'DELETE /expenses/:id': buying.deleteExpense,

  // ── Dashboard & reports ──
  'GET /dashboard/summary': analytics.dashboardSummary,
  'GET /dashboard/revenue-chart': analytics.revenueChart,
  'GET /reports/sales': analytics.salesReport,
  'GET /reports/purchases': analytics.purchasesReport,
  'GET /reports/products': analytics.productsReport,
  'GET /reports/customers': analytics.customersReport,
  'GET /reports/inventory': analytics.inventoryReport,
  'GET /reports/profit-loss': analytics.profitLoss,
  'GET /reports/pnl': analytics.pnlComparison,
  'GET /reports/aging': analytics.agingReport,
  'GET /reports/dashboard': analytics.dashboardStats,
  'GET /reports/today-summary': analytics.todaySummary,

  // ── Product import ──
  // Reachable from the ADMIN nav with no module flag, so it must answer.
  'POST /import/preview': importing.importPreview,
  'POST /import/confirm': importing.importConfirm,

  // ── Attachments ──
  // AttachmentPanel is mounted on Purchase detail, Supplier Payments and
  // Purchase Returns. `list` is GET /attachments/:refType/:refId — a two-segment
  // path, so a bare 'GET /attachments' never matched it and every purchase order
  // rendered "Could not load attachments." in red.
  'GET /attachments/:refType/:refId': attachments.listAttachments,
  'POST /attachments': attachments.uploadAttachment,
  'DELETE /attachments/:id': attachments.deleteAttachment,
};
