// ─── A4 sales invoice, as a printable HTML document ───────────────────────────
//
// Why HTML and not the jsPDF invoice that "Download PDF" already builds:
//
// Printing a jsPDF document from the app means handing the browser a PDF blob
// (`doc.autoPrint()` + `window.open(doc.output('bloburl'))`). That relies on
// Chromium's built-in PDF viewer, which Electron ships DISABLED unless the
// window is created with `webPreferences.plugins: true` — and this app's window
// is not (electron/main.js). The blob would download instead of printing, which
// is exactly the class of silent print failure that printWindow.ts exists to
// prevent.
//
// So the printed invoice is rendered as HTML and goes through the popup path
// already hardened for Electron. The layout below deliberately mirrors
// `exportSaleInvoice` in services/pdfExport.ts field for field and row for row,
// so the printed sheet and the downloaded PDF are the same document. Change one,
// change the other.

import { autoPrintScript } from './printWindow';
import type { Sale, SaleLine } from '../services/sales';
import type { AppSettings } from '../services/settings';

const PAYMENT_LABELS: Record<string, string> = {
  CASH: 'Cash', CARD: 'Card', BANK_TRANSFER: 'Bank Transfer',
  WALLET: 'Wallet', QR_PAY: 'QR Pay', CREDIT: 'Credit', OTHER: 'Other',
};

function esc(s: unknown): string {
  return String(s)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// Same shape as money() in pdfExport.ts — symbol, position, 2dp.
function money(cents: number, s: AppSettings): string {
  const sym = s.currencySymbol ?? 'Rs.';
  const pos = s.currencyPosition ?? 'before';
  const n = (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return pos === 'before' ? `${sym} ${n}` : `${n} ${sym}`;
}

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString('en-US', { year: 'numeric', month: 'long', day: 'numeric' });
}

function addDays(iso: string, days: number): string {
  const d = new Date(iso);
  d.setDate(d.getDate() + days);
  return formatDate(d.toISOString());
}

const STATUS_FILL: Record<string, string> = {
  CONFIRMED: '#16a34a',
  DRAFT:     '#64748b',
  CANCELLED: '#dc2626',
};

/**
 * Builds a complete, standalone A4 invoice document.
 *
 * The returned HTML carries `autoPrintScript()`, so it prints and closes itself
 * once written into a popup. The caller must not call print()/close().
 */
export function generateInvoiceHtml(
  sale: Sale,
  settings: AppSettings,
  logoBase64: string | null = null,
): string {
  const fmt   = (c: number) => esc(money(c, settings));
  const dark  = settings.documentTheme === 'dark';
  const lines: SaleLine[] = sale.lines ?? [];

  // Tax column is dropped entirely when nothing carries tax — same rule as the
  // PDF, and the reason taxPercent is 0 on new products (CLAUDE.md §4.3).
  const showTax  = lines.some(l => l.taxPercent > 0);
  const dueDate  = settings.invoiceDueDays ? addDays(sale.date, settings.invoiceDueDays) : null;
  const balance  = sale.totalCents - sale.paidCents;
  const payLabel = PAYMENT_LABELS[sale.paymentMethod] ?? sale.paymentMethod;

  // ── Letterhead ──────────────────────────────────────────────────────────────
  const idLines: string[] = [];
  if (settings.businessAddress) idLines.push(settings.businessAddress.replace(/\n/g, ', '));
  const contact = [settings.businessPhone, settings.businessEmail].filter(Boolean).join('  ·  ');
  if (contact) idLines.push(contact);
  if (settings.businessRegNo) idLines.push(`Reg: ${settings.businessRegNo}`);

  const logoImg = (logoBase64 && settings.invoiceShowLogo)
    ? `<img class="logo" src="${logoBase64}" alt="">`
    : '';

  const band = `
  <header class="band">
    <div class="band-left">
      ${logoImg}
      <div>
        <div class="biz">${esc(settings.businessName || 'My Business')}</div>
        ${idLines.slice(0, 2).map(l => `<div class="biz-sub">${esc(l)}</div>`).join('')}
      </div>
    </div>
    <div class="band-right">
      <div class="doctype">SALES INVOICE</div>
      <div class="docno">${esc(sale.number)}</div>
      <div class="pill" style="background:${STATUS_FILL[sale.status] ?? '#64748b'}">${esc(sale.status)}</div>
    </div>
  </header>`;

  // ── Bill-to + meta ──────────────────────────────────────────────────────────
  const meta: { label: string; value: string }[] = [
    { label: 'Invoice No',  value: sale.number },
    { label: 'Date',        value: formatDate(sale.date) },
    ...(dueDate ? [{ label: 'Due Date', value: dueDate }] : []),
    { label: 'Payment',     value: payLabel },
    { label: 'Warehouse',   value: `${sale.warehouse.name} (${sale.warehouse.code})` },
    { label: 'Prepared by', value: sale.createdBy.fullName },
  ];

  const billTo = [
    sale.customer?.name ?? 'Walk-in Customer',
    ...(sale.customer?.phone ? [`Tel: ${sale.customer.phone}`] : []),
  ];

  const metaBlock = `
  <section class="meta">
    <div class="billto">
      <div class="meta-head">BILL TO</div>
      ${billTo.map((l, i) => `<div class="${i === 0 ? 'billto-name' : 'billto-sub'}">${esc(l)}</div>`).join('')}
    </div>
    <table class="meta-table">
      ${meta.map(m => `<tr><td class="meta-label">${esc(m.label)}</td><td class="meta-value">${esc(m.value)}</td></tr>`).join('')}
    </table>
  </section>`;

  // ── Items ───────────────────────────────────────────────────────────────────
  const rows = lines.map(l => {
    const unit = l.product.unit?.shortCode ? ' ' + l.product.unit.shortCode : '';
    const disc = l.discountCents > 0
      ? `<td class="c disc">${fmt(l.discountCents)}</td>`
      : '<td class="c">—</td>';
    return `<tr>
      <td>${esc(l.product.name)}</td>
      <td class="c sku">${esc(l.product.sku)}</td>
      <td class="c">${esc(Number(l.qty))}${esc(unit)}</td>
      <td class="c">${fmt(l.unitPriceCents)}</td>
      ${showTax ? `<td class="c">${esc(l.taxPercent)}%</td>` : ''}
      ${disc}
      <td class="r b">${fmt(l.lineTotalCents)}</td>
    </tr>`;
  }).join('');

  const colCount = showTax ? 7 : 6;

  const itemsTable = `
  <table class="items">
    <thead>
      <tr>
        <th>Product</th><th class="c">SKU</th><th class="c">Qty</th><th class="c">Unit Price</th>
        ${showTax ? '<th class="c">Tax %</th>' : ''}
        <th class="c">Discount</th><th class="r">Total</th>
      </tr>
    </thead>
    <tbody>${rows || `<tr><td colspan="${colCount}" class="c empty">No items on this invoice</td></tr>`}</tbody>
  </table>`;

  // ── Totals ──────────────────────────────────────────────────────────────────
  const totRows: string[] = [
    `<tr><td>Subtotal</td><td class="r">${fmt(sale.subtotalCents)}</td></tr>`,
  ];
  if (sale.taxCents > 0) {
    totRows.push(`<tr><td>${esc(settings.taxLabel || 'Tax')}</td><td class="r">${fmt(sale.taxCents)}</td></tr>`);
  }
  if (sale.discountCents > 0) {
    totRows.push(`<tr class="neg"><td>Discount</td><td class="r">− ${fmt(sale.discountCents)}</td></tr>`);
  }
  totRows.push(`<tr class="grand"><td>TOTAL</td><td class="r">${fmt(sale.totalCents)}</td></tr>`);

  if (sale.status === 'CONFIRMED') {
    totRows.push(`<tr class="pos"><td>Paid (${esc(payLabel)})</td><td class="r">${fmt(sale.paidCents)}</td></tr>`);
    totRows.push(balance > 0
      ? `<tr class="due"><td>Balance Due</td><td class="r">${fmt(balance)}</td></tr>`
      : '<tr class="settled"><td>Fully Paid ✓</td><td class="r"></td></tr>');
  }

  const totals = `<section class="totals"><table>${totRows.join('')}</table></section>`;

  const policy = settings.returnPolicy
    ? `<section class="policy"><span class="policy-label">Return Policy:</span> ${esc(settings.returnPolicy)}</section>`
    : '';

  const note = sale.note
    ? `<section class="note"><span class="policy-label">Note:</span> ${esc(sale.note)}</section>`
    : '';

  const footer = `
  <footer class="foot">
    <span>${esc(settings.businessName || 'My Business')} · Thank you for your business</span>
    <span>ModernERP</span>
  </footer>`;

  // Colours below are literal, never the app's theme tokens: this document is
  // printed on paper. The screen theme must not follow it onto the page — the
  // same reason the dark-mode block in index.css is scoped to @media screen.
  const bandBg  = dark ? '#0f172a' : '#f1f5f9';
  const bandFg  = dark ? '#ffffff' : '#0f172a';
  const bandSub = dark ? '#cbd5e1' : '#64748b';
  const headBg  = dark ? '#0f172a' : '#e2e8f0';
  const headFg  = dark ? '#ffffff' : '#0f172a';

  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<title>${esc(sale.number)}</title>
<style>
  @page { size: A4; margin: 12mm; }
  * { box-sizing: border-box; }
  html, body {
    margin: 0; padding: 0;
    background: #fff; color: #0f172a;
    font-family: Helvetica, Arial, sans-serif; font-size: 11px;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .sheet { width: 186mm; margin: 0 auto; padding: 4mm 0; }

  .band { display: flex; justify-content: space-between; align-items: flex-start;
          background: ${bandBg}; color: ${bandFg}; padding: 10px 12px; margin-bottom: 14px; }
  .band-left { display: flex; gap: 10px; align-items: flex-start; }
  .logo { width: 22mm; height: 18mm; object-fit: contain; }
  .biz { font-size: 17px; font-weight: bold; line-height: 1.2; }
  .biz-sub { font-size: 8.5px; color: ${bandSub}; margin-top: 3px; }
  .band-right { text-align: right; }
  .doctype { font-size: 12px; font-weight: bold; letter-spacing: 1px; color: ${bandSub}; }
  .docno { font-size: 16px; font-weight: bold; margin-top: 3px; }
  .pill { display: inline-block; margin-top: 5px; padding: 2px 9px; border-radius: 9px;
          color: #fff; font-size: 8px; font-weight: bold; letter-spacing: .5px; }

  .meta { display: flex; justify-content: space-between; gap: 20px; margin-bottom: 12px; }
  .meta-head { font-size: 8px; font-weight: bold; letter-spacing: 1px; color: #64748b; margin-bottom: 4px; }
  .billto-name { font-size: 13px; font-weight: bold; }
  .billto-sub { font-size: 10px; color: #475569; margin-top: 2px; }
  .meta-table { border-collapse: collapse; }
  .meta-label { color: #64748b; font-size: 9px; padding: 1.5px 10px 1.5px 0; text-align: right; }
  .meta-value { font-size: 9.5px; font-weight: bold; padding: 1.5px 0; text-align: right; }

  .items { width: 100%; border-collapse: collapse; margin-bottom: 10px; }
  .items th { background: ${headBg}; color: ${headFg}; font-size: 10px; font-weight: bold;
              text-align: left; padding: 6px 5px; border: .5px solid #cbd5e1; }
  .items td { font-size: 9px; padding: 5px; border: .5px solid #cbd5e1; }
  .items tbody tr:nth-child(even) td { background: #f9fafb; }
  .items .c { text-align: center; }
  .items .r { text-align: right; }
  .items .b { font-weight: bold; }
  .items .sku { font-size: 8px; color: #64748b; }
  .items .disc { color: #dc2626; }
  .items .empty { color: #94a3b8; padding: 14px; }

  .totals { display: flex; justify-content: flex-end; }
  .totals table { border-collapse: collapse; min-width: 74mm; }
  .totals td { font-size: 10px; padding: 4px 9px; }
  .totals td.r { text-align: right; }
  .totals .neg td { color: #dc2626; }
  .totals .grand td { background: ${headBg}; color: ${headFg}; font-size: 12px; font-weight: bold;
                      border-top: 1px solid #94a3b8; }
  .totals .pos td { color: #16a34a; }
  .totals .due td { background: #fee2e2; color: #dc2626; font-weight: bold; }
  .totals .settled td { background: #dcfce7; color: #16a34a; font-weight: bold; }

  .policy, .note { margin-top: 14px; padding: 7px 9px; border: .5px solid #cbd5e1;
                   font-size: 8.5px; color: #475569; }
  .policy-label { font-weight: bold; color: #0f172a; }

  .foot { display: flex; justify-content: space-between; margin-top: 18px; padding-top: 7px;
          border-top: .5px solid #cbd5e1; font-size: 8px; color: #94a3b8; }
</style>
</head>
<body>
  <div class="sheet">
    ${band}
    ${metaBlock}
    ${itemsTable}
    ${totals}
    ${policy}
    ${note}
    ${footer}
  </div>
${autoPrintScript()}
</body>
</html>`;
}
