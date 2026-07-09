import { api } from './api';
import type { SupplierPayment } from './purchases';

// ─── Types ────────────────────────────────────────────────────────────────────

export type SupplierPaymentMethod = 'CASH' | 'CHEQUE' | 'BANK_TRANSFER';

export interface CreateSupplierPaymentPayload {
  purchaseId:    string;
  amountCents:   number;
  paymentMethod: SupplierPaymentMethod;
  referenceNo?:  string;
  bankName?:     string;
  paymentDate:   string;   // ISO date string YYYY-MM-DD
  notes?:        string;
}

export interface SupplierPaymentVoucher extends SupplierPayment {
  purchase: { id: string; number: string; totalCents: number };
}

export interface ReceiveCreditPayload {
  purchaseId:  string;
  supplierId:  string;
  amountCents: number;
  method:      SupplierPaymentMethod;
  reference?:  string;
  date:        string;   // ISO date string YYYY-MM-DD
  notes?:      string;
}

export interface LumpSumSupplierPaymentPayload {
  supplierId:    string;
  amountCents:   number;
  paymentMethod: SupplierPaymentMethod;
  referenceNo?:  string;
  bankName?:     string;
  paymentDate:   string;   // ISO date string YYYY-MM-DD
  notes?:        string;
}

export interface LumpSumSupplierAllocation {
  purchaseId:     string;
  purchaseNumber: string;
  paymentNumber:  string;
  appliedCents:   number;
}

export interface LumpSumSupplierPaymentResult {
  allocationGroupId: string;
  allocations:       LumpSumSupplierAllocation[];
  appliedCents:      number;
  creditAddedCents:  number;
}

export interface ApplyCreditSupplierPayload {
  supplierId:  string;
  amountCents: number;
  paymentDate: string;   // ISO date string YYYY-MM-DD
  notes?:      string;
}

export interface ApplyCreditSupplierResult {
  allocationGroupId:    string;
  allocations:          LumpSumSupplierAllocation[];
  appliedCents:         number;
  creditRemainingCents: number;
}

export interface SupplierCreditLedgerEntry {
  id:                string;
  supplierId:        string;
  amountCents:       number;   // signed
  reason:            string;
  allocationGroupId: string | null;
  refType:           string | null;
  refId:             string | null;
  notes:             string | null;
  createdBy:         string;
  createdByUser:     { id: string; fullName: string };
  createdAt:         string;
}

// ─── API ──────────────────────────────────────────────────────────────────────

export const supplierPaymentsApi = {
  create: (payload: CreateSupplierPaymentPayload): Promise<SupplierPayment> =>
    api.post('/supplier-payments', payload).then((r) => r.data),

  createLumpSum: (payload: LumpSumSupplierPaymentPayload): Promise<LumpSumSupplierPaymentResult> =>
    api.post('/supplier-payments/lump-sum', payload).then((r) => r.data),

  applyCredit: (payload: ApplyCreditSupplierPayload): Promise<ApplyCreditSupplierResult> =>
    api.post('/supplier-payments/apply-credit', payload).then((r) => r.data),

  creditLedger: (supplierId: string): Promise<SupplierCreditLedgerEntry[]> =>
    api.get(`/supplier-payments/credit-ledger/${supplierId}`).then((r) => r.data),

  receiveCredit: (payload: ReceiveCreditPayload): Promise<SupplierPayment> =>
    api.post('/supplier-payments/credit', payload).then((r) => r.data),

  listByPurchase: (purchaseId: string): Promise<SupplierPayment[]> =>
    api.get(`/supplier-payments/purchase/${purchaseId}`).then((r) => r.data),

  listBySupplier: (supplierId: string): Promise<SupplierPayment[]> =>
    api.get(`/supplier-payments/supplier/${supplierId}`).then((r) => r.data),

  getVoucherData: (paymentId: string): Promise<SupplierPaymentVoucher> =>
    api.get(`/supplier-payments/${paymentId}/voucher-data`).then((r) => r.data),

  void: (paymentId: string): Promise<{ success: boolean }> =>
    api.delete(`/supplier-payments/${paymentId}`).then((r) => r.data),
};

// Convenience named export — records cash received back from a supplier whose PO
// became overpaid after confirmed returns.
export const receiveSupplierCredit = (payload: ReceiveCreditPayload): Promise<SupplierPayment> =>
  supplierPaymentsApi.receiveCredit(payload);

// ─── Helpers ──────────────────────────────────────────────────────────────────

export const SPAY_METHOD_LABELS: Record<string, string> = {
  CASH:          'Cash',
  CHEQUE:        'Cheque',
  BANK_TRANSFER: 'Bank Transfer',
};

export function formatCentsLocal(cents: number, sym = 'Rs.'): string {
  return `${sym} ${(cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

// ─── Voucher HTML generator ───────────────────────────────────────────────────

export function generateVoucherHtml(
  voucher: SupplierPaymentVoucher,
  businessName: string,
): string {
  const fmt = (c: number) =>
    `Rs. ${(c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const dateStr = new Date(voucher.paymentDate).toLocaleDateString('en-US', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const showRef = voucher.paymentMethod === 'CHEQUE' || voucher.paymentMethod === 'BANK_TRANSFER';

  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <title>Payment Voucher ${voucher.paymentNumber}</title>
  <style>
    @page { size: A5 portrait; margin: 12mm; }
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body { font-family: 'Arial', sans-serif; font-size: 11px; color: #111; line-height: 1.6; }
    .header { text-align: center; margin-bottom: 12px; border-bottom: 2px solid #111; padding-bottom: 8px; }
    .header .biz  { font-size: 16px; font-weight: 700; }
    .header .title{ font-size: 14px; font-weight: 700; letter-spacing: 2px; margin-top: 4px; color: #444; }
    table { width: 100%; border-collapse: collapse; margin-top: 10px; }
    td    { padding: 5px 6px; vertical-align: top; }
    td:first-child { width: 38%; color: #555; font-weight: 600; }
    .amount-row td { font-size: 15px; font-weight: 700; border-top: 1px solid #111; border-bottom: 1px solid #111; }
    .signatures { display: flex; justify-content: space-between; margin-top: 32px; }
    .sig-box   { width: 45%; text-align: center; }
    .sig-line  { border-top: 1px solid #111; margin-bottom: 4px; }
    .footer    { margin-top: 16px; font-size: 9px; text-align: center; color: #aaa; border-top: 1px dashed #ccc; padding-top: 6px; }
    @media print { body { -webkit-print-color-adjust: exact; } }
  </style>
</head>
<body>
  <div class="header">
    <div class="biz">${businessName}</div>
    <div class="title">─── PAYMENT VOUCHER ───</div>
  </div>

  <table>
    <tr><td>Voucher No.</td><td><strong>${voucher.paymentNumber}</strong></td></tr>
    <tr><td>Date</td><td>${dateStr}</td></tr>
    <tr><td>Paid To</td><td><strong>${voucher.supplier.name}</strong></td></tr>
    <tr><td>PO Reference</td><td>${voucher.purchase.number}</td></tr>
    <tr class="amount-row">
      <td>Amount</td><td>${fmt(voucher.amountCents)}</td>
    </tr>
    <tr><td>Payment Method</td><td>${SPAY_METHOD_LABELS[voucher.paymentMethod] ?? voucher.paymentMethod}</td></tr>
    ${showRef && voucher.referenceNo ? `<tr><td>Reference No.</td><td>${voucher.referenceNo}</td></tr>` : ''}
    ${showRef && voucher.bankName    ? `<tr><td>Bank</td><td>${voucher.bankName}</td></tr>` : ''}
    ${voucher.notes ? `<tr><td>Notes</td><td>${voucher.notes}</td></tr>` : ''}
    <tr><td>Prepared By</td><td>${voucher.createdByUser.fullName}</td></tr>
  </table>

  <div class="signatures">
    <div class="sig-box">
      <div class="sig-line"></div>
      <div>Prepared By</div>
    </div>
    <div class="sig-box">
      <div class="sig-line"></div>
      <div>Authorised By</div>
    </div>
  </div>

  <div class="footer">Generated by BROcode ERP &mdash; ${new Date().toLocaleString()}</div>
</body>
</html>`;
}

export function printVoucher(html: string): void {
  const win = window.open('', '_blank', 'width=600,height=800');
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  setTimeout(() => win.print(), 500);
}
