import { z } from 'zod';

export const updateSettingsSchema = z.object({
  // Company
  businessName:          z.string().min(1).max(200).optional(),
  businessRegNo:         z.string().max(100).nullable().optional(),
  businessAddress:       z.string().max(500).nullable().optional(),
  businessPhone:         z.string().max(50).nullable().optional(),
  businessEmail:         z.string().email().nullable().optional(),
  logoUrl:               z.string().url().nullable().optional(),

  // Localisation
  currencySymbol:        z.string().min(1).max(10).optional(),
  currencyCode:          z.string().min(1).max(10).optional(),
  currencyPosition:      z.enum(['before', 'after']).optional(),
  dateFormat:            z.string().max(20).optional(),
  timezone:              z.string().max(60).optional(),

  // Tax
  defaultTaxPercent:     z.number().min(0).max(100).optional(),
  taxLabel:              z.string().min(1).max(30).optional(),
  taxNumber:             z.string().max(100).nullable().optional(),
  taxEnabled:            z.boolean().optional(),
  taxInclusive:          z.boolean().optional(),

  // POS
  posRequireShift:       z.boolean().optional(),
  posAllowDiscount:      z.boolean().optional(),
  posMaxDiscountPct:     z.number().min(0).max(100).optional(),
  posPrintReceipt:       z.boolean().optional(),
  posReceiptFooter:      z.string().max(300).nullable().optional(),
  posDefaultWarehouseId: z.string().nullable().optional(),

  // Invoice
  invoicePrefix:         z.string().min(1).max(10).optional(),
  invoiceStartNo:        z.number().int().min(1).optional(),
  invoiceDueDays:        z.number().int().min(0).max(365).optional(),
  purchasePrefix:        z.string().min(1).max(10).optional(),
  invoiceFooter:         z.string().max(500).nullable().optional(),
  invoiceShowLogo:       z.boolean().optional(),

  // Security
  sessionTimeoutMin:     z.number().int().min(0).optional(),

  // Alert thresholds
  alertLowStockEnabled:  z.boolean().optional(),
  alertExpiryEnabled:    z.boolean().optional(),
  alertExpiryDays:       z.number().int().min(1).max(365).optional(),
  alertLowStockEmail:    z.string().email().nullable().optional(),
  alertShowInDashboard:  z.boolean().optional(),
  alertBellEnabled:      z.boolean().optional(),

  // POS behaviour
  blockExpiredSales:     z.boolean().optional(),                          // deprecated — kept for compat
  expiredStockPolicy:    z.enum(['BLOCK', 'WARN', 'ALLOW']).optional(),
  staffSalesEnabled:     z.boolean().optional(),

  // Receipt / Print
  receiptLanguage:       z.enum(['en', 'si']).optional(),
  receiptTagline:        z.string().max(200).nullable().optional(),
  receiptShowLogo:       z.boolean().optional(),
  receiptShowTax:        z.boolean().optional(),
  receiptShowSku:        z.boolean().optional(),
  receiptPaperWidth:     z.enum(['58mm', '80mm']).optional(),
  receiptShowBarcode:    z.boolean().optional(),
  receiptShowCashier:    z.boolean().optional(),
  receiptQrEnabled:      z.boolean().optional(),
  receiptHeaderLine1:    z.string().max(200).nullable().optional(),
  receiptHeaderLine2:    z.string().max(200).nullable().optional(),
});

export type UpdateSettingsInput = z.infer<typeof updateSettingsSchema>;
