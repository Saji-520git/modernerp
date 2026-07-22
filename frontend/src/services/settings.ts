import { api } from './api';

// ─── Types ────────────────────────────────────────────────────────────────────

export interface AppSettings {
  id: string;
  // Company
  businessName: string;
  businessRegNo: string | null;
  businessAddress: string | null;
  businessPhone: string | null;
  businessEmail: string | null;
  logoUrl: string | null;
  // Localisation
  currencySymbol: string;
  currencyCode: string;
  currencyPosition: 'before' | 'after';
  dateFormat: string;
  timezone: string;
  // Tax
  defaultTaxPercent: number;
  taxLabel: string;
  taxNumber: string | null;
  taxEnabled: boolean;
  taxInclusive: boolean;
  // POS
  posRequireShift: boolean;
  posAllowDiscount: boolean;
  posMaxDiscountPct: number;
  posPrintReceipt: boolean;
  posReceiptFooter: string | null;
  posDefaultWarehouseId: string | null;
  // Invoice
  invoicePrefix: string;
  invoiceStartNo: number;
  invoiceDueDays: number;
  purchasePrefix: string;
  invoiceFooter: string | null;
  invoiceShowLogo: boolean;
  documentTheme: 'dark' | 'light';
  // Security
  sessionTimeoutMin: number;
  // Alert thresholds
  alertLowStockEnabled: boolean;
  alertExpiryEnabled: boolean;
  alertExpiryDays: number;
  alertLowStockEmail: string | null;
  alertShowInDashboard: boolean;
  alertBellEnabled: boolean;
  // POS behaviour
  blockExpiredSales: boolean;                         // deprecated — kept for compat
  expiredStockPolicy: 'BLOCK' | 'WARN' | 'ALLOW';
  staffSalesEnabled: boolean;
  // Receipt / Print
  receiptLanguage: 'en' | 'si';
  receiptTagline: string | null;
  receiptShowLogo: boolean;
  receiptShowTax: boolean;
  receiptShowSku: boolean;
  receiptPaperWidth: '58mm' | '80mm';
  receiptShowBarcode: boolean;
  receiptShowCashier: boolean;
  receiptQrEnabled: boolean;
  receiptHeaderLine1: string | null;
  receiptHeaderLine2: string | null;
  // Returns
  returnPolicy: string;
  // WhatsApp messaging
  whatsappEnabled: boolean;
  whatsappPhone: string | null;
  waReceiptTemplate: string | null;
  waOutstandingTemplate: string | null;
  waPayableTemplate: string | null;
  waOfferTemplate: string | null;
  whatsappOpenMode: 'app' | 'browser';
  moduleFlags: Record<string, boolean>;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const settingsApi = {
  get: (): Promise<AppSettings> =>
    api.get<AppSettings>('/settings').then((r) => r.data),

  update: (data: Partial<AppSettings>): Promise<AppSettings> =>
    api.patch<AppSettings>('/settings', data).then((r) => r.data),

  // Super-admin only (manage_modules). The general update() no longer accepts moduleFlags.
  updateModules: (moduleFlags: Record<string, boolean>): Promise<AppSettings> =>
    api.patch<AppSettings>('/settings/modules', { moduleFlags }).then((r) => r.data),
};
