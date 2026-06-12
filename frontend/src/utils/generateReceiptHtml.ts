import JsBarcode from 'jsbarcode';
import { receiptLabels, type ReceiptLang } from './receiptI18n';
import type { Receipt } from '../services/pos';
import type { AppSettings } from '../services/settings';

function money(cents: number, sym: string, pos: string): string {
  const n = (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return pos === 'before' ? `${sym}${n}` : `${n} ${sym}`;
}

function generateBarcodeHtml(text: string): string {
  try {
    const svgEl = document.createElementNS('http://www.w3.org/2000/svg', 'svg') as SVGSVGElement;
    JsBarcode(svgEl, text, {
      format:       'CODE128',
      width:        1.5,
      height:       42,
      displayValue: false,
      margin:       10,
      background:   '#ffffff',
      lineColor:    '#000000',
    });
    return `<div style="text-align:center;margin:6px auto 2px;background:#fff;padding:0 10px;max-width:220px;">${svgEl.outerHTML}</div>`;
  } catch {
    return '';
  }
}

function esc(s: string): string {
  return s
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

export function generateReceiptHtml(
  receipt: Receipt,
  settings: AppSettings,
  changeCents: number,
  logoBase64: string | null = null,
): string {
  const lang    = (settings.receiptLanguage ?? 'en') as ReceiptLang;
  const L       = receiptLabels[lang];
  const width   = settings.receiptPaperWidth === '58mm' ? '58mm' : '80mm';
  const sym     = settings.currencySymbol ?? 'Rs.';
  const symPos  = settings.currencyPosition ?? 'before';
  const fmt     = (c: number) => esc(money(c, sym, symPos));
  const fontFam = lang === 'si'
    ? "'Noto Sans Sinhala', Arial, sans-serif"
    : "Arial, sans-serif";

  const sinhalaFont = lang === 'si'
    ? `<link rel="preconnect" href="https://fonts.googleapis.com">
       <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Sinhala:wght@400;500;700&display=swap" rel="stylesheet">`
    : '';

  const dateStr = new Date(receipt.date).toLocaleString('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

  const divider = (dashed = true) =>
    `<div style="border-top:${dashed ? '1px dashed #999' : '2px solid #000'};margin:5px 0;"></div>`;

  const row = (label: string, value: string, bold = false) =>
    `<div style="display:flex;justify-content:space-between;font-size:15px;${bold ? 'font-weight:700;' : ''}margin-bottom:1px;">
       <span>${esc(label)}</span><span>${esc(value)}</span>
     </div>`;

  // ── Header ───────────────────────────────────────────────────────────────
  let header = '';

  // 1. Logo — only when base64 available and enabled
  if (logoBase64 && settings.receiptShowLogo) {
    header += `<div style="text-align:center;margin:0 0 3px 0;padding:0;">
      <img src="${logoBase64}" style="max-height:102px;max-width:222px;display:block;margin:0 auto;" alt="" />
    </div>`;
  }

  // 2. Business name
  header += `<p style="font-size:20px;font-weight:bold;text-align:center;margin:2px 0;">${esc(settings.businessName || 'My Business')}</p>`;

  // 3. Address
  if (settings.businessAddress) {
    header += `<p style="font-size:14px;text-align:center;margin:1px 0;">${esc(settings.businessAddress)}</p>`;
  }

  // 4. Phone / Email
  const contact = [settings.businessPhone, settings.businessEmail].filter(Boolean).join(' | ');
  if (contact) {
    header += `<p style="font-size:14px;text-align:center;margin:1px 0;">${esc(contact)}</p>`;
  }

  // 5. Tagline — after phone
  if (settings.receiptTagline) {
    header += `<p style="font-size:14px;text-align:center;margin:1px 0;color:#000000;">${esc(settings.receiptTagline)}</p>`;
  }

  // 6. Extra header lines
  if (settings.receiptHeaderLine1) {
    header += `<p style="font-size:14px;text-align:center;margin:1px 0;">${esc(settings.receiptHeaderLine1)}</p>`;
  }
  if (settings.receiptHeaderLine2) {
    header += `<p style="font-size:14px;text-align:center;margin:1px 0;">${esc(settings.receiptHeaderLine2)}</p>`;
  }

  // ── Meta (invoice, cashier, customer, date) ───────────────────────────────
  let meta = row(L.invoiceNo, receipt.number);
  if (settings.receiptShowCashier) meta += row(L.cashier, receipt.cashier);
  meta += row(L.customer, receipt.customer?.name ?? L.walkIn);
  meta += row(L.date, dateStr);
  if (receipt.warehouseName) meta += `<p style="font-size:14px;color:#000000;margin:1px 0;">${esc(receipt.warehouseName)}</p>`;

  // ── Items table — 2-line layout: PRODUCT / PRICE / DISC / AMOUNT ───────────
  // Bare-number formatter (no currency symbol) for the price/disc/amount columns.
  const num = (c: number) =>
    esc((c / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 }));

  const itemRowsHtml = receipt.lines.map(line => {
    const displayName = line.product.receiptName || line.product.name;
    const qtyNum      = Number(line.qty);
    const unitLabel   = line.unitShortCode ? ` ${esc(line.unitShortCode)}` : '';
    // discountCents is the TOTAL line discount → per-unit = total / qty
    const perUnitDiscCents = qtyNum > 0 ? line.discountCents / qtyNum : 0;
    // AMOUNT = net line total (gross lineTotalCents minus the line discount)
    const netLineCents     = line.lineTotalCents - line.discountCents;
    const skuLine = settings.receiptShowSku
      ? `<br><span style="font-size:14px;color:#000000;">${esc(line.product.sku)}</span>`
      : '';
    // ROW 1 — product name (full width). ROW 2 — qty | price | disc | amount.
    // ROW 3 — dashed separator after each item.
    return `<tr>
      <td colspan="4" style="text-align:left;font-weight:bold;word-wrap:break-word;overflow-wrap:break-word;white-space:normal;font-size:16px;padding:4px 0 0;">${esc(displayName)}${skuLine}</td>
    </tr>
    <tr>
      <td style="width:35%;text-align:left;font-size:14px;padding:0 0 2px;">${qtyNum}${unitLabel}</td>
      <td style="width:22%;text-align:right;font-size:14px;padding:0 4px 2px 6px;">${num(line.unitPriceCents)}</td>
      <td style="width:18%;text-align:right;font-size:14px;padding:0 4px 2px 8px;">${perUnitDiscCents > 0 ? num(perUnitDiscCents) : ''}</td>
      <td style="width:25%;text-align:right;font-size:14px;padding:0 0 2px 8px;">${num(netLineCents)}</td>
    </tr>
    <tr>
      <td colspan="4" style="border-top:1px dashed #000000;padding:2px 0;"></td>
    </tr>`;
  }).join('');

  const itemsTable = `<table style="width:100%;table-layout:fixed;border-collapse:collapse;">
  <tr>
    <td style="width:35%;font-size:14px;font-weight:bold;text-align:left;text-transform:uppercase;padding:2px 0;border-bottom:1px solid #000;">${esc(L.product)}</td>
    <td style="width:22%;font-size:14px;font-weight:bold;text-align:right;text-transform:uppercase;padding:2px 4px 2px 6px;border-bottom:1px solid #000;">${esc(L.price)}</td>
    <td style="width:18%;font-size:14px;font-weight:bold;text-align:right;text-transform:uppercase;padding:2px 4px 2px 8px;border-bottom:1px solid #000;">${esc(L.discount)}</td>
    <td style="width:25%;font-size:14px;font-weight:bold;text-align:right;text-transform:uppercase;padding:2px 0 2px 8px;border-bottom:1px solid #000;">${esc(L.amount)}</td>
  </tr>
  ${itemRowsHtml}
</table>`;

  // ── Totals table ──────────────────────────────────────────────────────────
  const tenderedCents = receipt.paymentMethod === 'CASH' ? receipt.totalCents + changeCents : 0;

  let totalsRows = '';

  // Subtotal
  totalsRows += `<tr>
    <td style="font-size:14px;padding:1px 0;">${esc(L.subtotal)}</td>
    <td style="font-size:14px;text-align:right;padding:1px 0;">${fmt(receipt.subtotalCents)}</td>
  </tr>`;

  // You Saved — all discounts combined (item-level + cart-level)
  const totalSavingsCents = receipt.lines.reduce((s, l) => s + l.discountCents, 0) + receipt.discountCents;
  if (totalSavingsCents > 0) {
    totalsRows += `<tr>
    <td colspan="2" style="padding:4px 0 3px">
      <div style="border:1.5px solid #000000;border-radius:3px;box-shadow:none;padding:4px 8px;margin:4px 0;background:#ffffff;">
        <div style="background:#f0fdf4;border:1px solid #86efac;border-radius:4px;padding:4px 8px;display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:14px;color:#000000;font-weight:700">🎉 You Saved</span>
          <span style="font-size:17px;color:#000000;font-weight:700">${fmt(totalSavingsCents)}</span>
        </div>
      </div>
    </td>
  </tr>
  <tr><td colspan="2" style="border-top:1px dashed #ccc;padding:1px 0"></td></tr>`;
  }

  // Tax
  if (settings.receiptShowTax && receipt.taxCents > 0) {
    totalsRows += `<tr>
    <td style="font-size:14px;padding:1px 0;color:#000000;">${esc(settings.taxLabel || L.tax)}</td>
    <td style="font-size:14px;text-align:right;padding:1px 0;color:#000000;">${fmt(receipt.taxCents)}</td>
  </tr>`;
  }

  // Thick separator + TOTAL row
  totalsRows += `<tr><td colspan="2" style="border-top:2px solid #000;padding:2px 0;"></td></tr>
  <tr>
    <td style="font-size:18px;font-weight:900;padding:2px 0;letter-spacing:0.5px;">${esc(L.total)}</td>
    <td style="font-size:18px;font-weight:900;text-align:right;padding:2px 0;">${fmt(receipt.totalCents)}</td>
  </tr>
  <tr><td colspan="2" style="border-top:1px dashed #999;padding:1px 0;"></td></tr>`;

  // Tendered + Change — CASH only, always show when tendered > 0
  if (receipt.paymentMethod === 'CASH' && tenderedCents > 0) {
    totalsRows += `<tr>
    <td style="font-size:14px;padding:1px 0;">${esc(L.tendered)}</td>
    <td style="font-size:14px;text-align:right;padding:1px 0;">${fmt(tenderedCents)}</td>
  </tr>
  <tr>
    <td style="font-size:15px;font-weight:bold;padding:1px 0;">${esc(L.change)}</td>
    <td style="font-size:15px;font-weight:bold;text-align:right;padding:1px 0;">${fmt(Math.max(0, tenderedCents - receipt.totalCents))}</td>
  </tr>
  <tr><td colspan="2" style="border-top:1px dashed #999;padding:2px 0"></td></tr>`;
  }

  // Credit sale badge — split (cash + credit) shows cash paid + remaining balance
  if (receipt.isCreditSale) {
    const isSplit = receipt.paidCents > 0 && receipt.paidCents < receipt.totalCents;
    if (isSplit) {
      totalsRows += `<tr>
    <td style="font-size:14px;padding:1px 0;">${esc(L.tendered)}</td>
    <td style="font-size:14px;text-align:right;padding:1px 0;">${fmt(receipt.paidCents)}</td>
  </tr>`;
    }
    totalsRows += `<tr>
    <td style="font-size:14px;padding:1px 0;">${esc(L.balance)}</td>
    <td style="font-size:14px;font-weight:bold;text-align:right;padding:1px 0;">${fmt(receipt.totalCents - receipt.paidCents)}</td>
  </tr>
  <tr>
    <td colspan="2" style="text-align:center;padding:4px 0;">
      <span style="display:inline-block;padding:2px 10px;border:1.5px solid #000;border-radius:3px;font-size:14px;font-weight:700;letter-spacing:1px;">${isSplit ? 'CASH + CREDIT' : esc(L.creditSale)}</span>
    </td>
  </tr>`;
  }

  // Staff sale badge
  if (receipt.isStaffSale) {
    totalsRows += `<tr>
    <td colspan="2" style="text-align:center;border:1px solid #4c1d95;border-radius:3px;padding:3px 6px;font-size:14px;font-weight:700;color:#4c1d95;">
      &#9733; STAFF PURCHASE &#8212; COST PRICE &#9733;
    </td>
  </tr>`;
  }

  // Items count — weight/volume units count as 1 per line; countable units
  // count their quantity; unknown units default to 1.
  const weightVolumeUnits = [
    'kg', 'g', 'gram', 'grams', 'kilogram', 'kilograms',
    'l', 'ml', 'liter', 'litre', 'liters', 'litres',
    'milliliter', 'millilitre',
  ];
  const totalItemsQty = receipt.lines.reduce((total, l) => {
    const unit = (l.unitShortCode ?? '').toLowerCase().trim();
    if (weightVolumeUnits.includes(unit)) return total + 1;
    return total + Math.round(Number(l.qty) || 1);
  }, 0);
  totalsRows += `<tr>
    <td colspan="2" style="border-top:1px dashed #999;padding:3px 0 0;font-size:14px;color:#000000;font-weight:600;">
      ${esc(L.itemCount)}: ${totalItemsQty}
    </td>
  </tr>
  <tr><td colspan="2" style="border-top:1px dashed #999;padding:3px 0"></td></tr>`;

  const totalsTable = `<table style="width:100%;border-collapse:collapse;margin-top:2px;">
  ${totalsRows}
</table>`;

  // ── Footer ────────────────────────────────────────────────────────────────
  let footer = divider();

  if (settings.receiptShowBarcode) {
    footer += generateBarcodeHtml(receipt.number);
    footer += `<p style="font-size:14px;text-align:center;margin:2px 0 0;letter-spacing:2px;">${esc(receipt.number)}</p>`;
  }

  if (settings.posReceiptFooter) {
    footer += divider();
    footer += `<p style="text-align:center;font-size:14px;margin:2px 0;">${esc(settings.posReceiptFooter)}</p>`;
  }
  if (settings.returnPolicy) {
    footer += divider();
    footer += `<p style="text-align:center;font-size:14px;color:#000000;margin:2px 0;">${esc(settings.returnPolicy)}</p>`;
  }

  footer += divider();

 
  footer += `<p style="font-size:11px;color:#000000;font-weight:600;text-align:center;margin-top:6px;border-top:1px dashed #000000;padding-top:4px;">Powered by BROcode Solutions [0757187506]</p>`;

  return `<!DOCTYPE html>
<html lang="${lang}">
<head>
  <meta charset="UTF-8">
  <title>Receipt ${esc(receipt.number)}</title>
  ${sinhalaFont}
  <style>
    @page { size: ${width} auto; margin: 0; }
    * { box-sizing: border-box; }
    body {
      width: ${width};
      margin: 0;
      padding: 2mm 3mm;
      font-family: ${fontFam};
      font-size: 15px;
      font-weight: bold;
      color: #000;
      background: #fff;
      line-height: 1.5;
    }
    @media print {
      body { print-color-adjust: exact; -webkit-print-color-adjust: exact; }
    }
  </style>
</head>
<body>
${header}
${divider()}
${meta}
${divider()}
${itemsTable}
${totalsTable}
${footer}
</body>
</html>`;
}
