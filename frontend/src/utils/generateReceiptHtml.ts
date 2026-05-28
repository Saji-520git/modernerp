import { receiptLabels, type ReceiptLang } from './receiptI18n';
import type { Receipt } from '../services/pos';
import type { AppSettings } from '../services/settings';

function money(cents: number, sym: string, pos: string): string {
  const n = (cents / 100).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return pos === 'before' ? `${sym} ${n}` : `${n} ${sym}`;
}

function barsFromString(s: string): string {
  let html = '';
  const start = [2, 2, 2];
  [...start, ...start].forEach((w, i) => {
    html += `<div style="width:${w}px;height:32px;background:${i % 2 === 0 ? '#000' : 'transparent'};display:inline-block;"></div>`;
  });
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    const w1 = (code % 3) + 1;
    const w2 = ((code >> 2) % 3) + 1;
    const w3 = ((code >> 4) % 2) + 1;
    html += `<div style="width:${w1}px;height:32px;background:#000;display:inline-block;"></div>`;
    html += `<div style="width:${w2}px;height:32px;background:transparent;display:inline-block;"></div>`;
    html += `<div style="width:${w3}px;height:32px;background:#000;display:inline-block;"></div>`;
    html += `<div style="width:1px;height:32px;background:transparent;display:inline-block;"></div>`;
  }
  return `<div style="text-align:center;margin:6px 0 2px">${html}</div>`;
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
    ? "'Noto Sans Sinhala', 'Courier New', monospace"
    : "'Courier New', monospace";

  const sinhalaFont = lang === 'si'
    ? `<link rel="preconnect" href="https://fonts.googleapis.com">
       <link href="https://fonts.googleapis.com/css2?family=Noto+Sans+Sinhala:wght@400;500;700&display=swap" rel="stylesheet">`
    : '';

  const dateStr = new Date(receipt.date).toLocaleString('en-US', {
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  });

  const divider  = (dashed = true) =>
    `<div style="border-top:${dashed ? '1px dashed #aaa' : '2px solid #000'};margin:5px 0;"></div>`;

  const row = (label: string, value: string, bold = false) =>
    `<div style="display:flex;justify-content:space-between;font-size:13px;${bold ? 'font-weight:700;' : ''}margin-bottom:1px;">
       <span>${esc(label)}</span><span>${esc(value)}</span>
     </div>`;

  // Header
  let header = '';
  // Only render logo when base64 was successfully fetched — avoids auth-401 broken images
  if (logoBase64 && settings.receiptShowLogo) {
    header += `<div style="text-align:center;margin-bottom:6px;margin-top:0;">
      <img src="${logoBase64}" style="max-height:80px;max-width:200px;display:block;margin:0 auto;" alt="logo">
    </div>`;
  }
  header += `<p style="text-align:center;font-weight:700;font-size:16px;margin:0 0 1px;">${esc(settings.businessName || 'My Business')}</p>`;
  if (settings.businessAddress) header += `<p style="text-align:center;font-size:9px;margin:0 0 1px;">${esc(settings.businessAddress)}</p>`;
  const contact = [settings.businessPhone, settings.businessEmail].filter(Boolean).join(' | ');
  if (contact) header += `<p style="text-align:center;font-size:9px;margin:0 0 1px;">${esc(contact)}</p>`;
  if (settings.receiptTagline)    header += `<p style="text-align:center;font-size:9px;margin:0 0 1px;">${esc(settings.receiptTagline)}</p>`;
  if (settings.receiptHeaderLine1) header += `<p style="text-align:center;font-size:9px;margin:0 0 1px;">${esc(settings.receiptHeaderLine1)}</p>`;
  if (settings.receiptHeaderLine2) header += `<p style="text-align:center;font-size:9px;margin:0 0 1px;">${esc(settings.receiptHeaderLine2)}</p>`;

  // Meta
  let meta = row(L.invoiceNo, receipt.number);
  if (settings.receiptShowCashier) meta += row(L.cashier, receipt.cashier);
  meta += row(L.customer, receipt.customer?.name ?? L.walkIn);
  meta += row(L.date, dateStr);
  if (receipt.warehouseName) meta += `<p style="font-size:9px;color:#555;margin:1px 0;">${esc(receipt.warehouseName)}</p>`;

  // Items header
  const itemHeader = `<div style="display:flex;justify-content:space-between;font-size:9px;font-weight:700;margin-bottom:2px;">
    <span style="flex:1;">${esc(L.product)}</span>
    <span style="width:28px;text-align:center;">${esc(L.qty)}</span>
    <span style="width:60px;text-align:right;">${esc(L.amount)}</span>
  </div>`;

  const itemRows = receipt.lines.map(line => {
    const displayName = line.product.receiptName || line.product.name;
    let html = `<div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:2px;align-items:flex-start;">
      <span style="flex:1;overflow-wrap:break-word;word-break:break-word;padding-right:4px;">${esc(displayName)}</span>
      <span style="width:28px;text-align:center;flex-shrink:0;">${line.qty}</span>
      <span style="width:60px;text-align:right;flex-shrink:0;white-space:nowrap;">${fmt(line.lineTotalCents)}</span>
    </div>`;
    if (settings.receiptShowSku) {
      html += `<p style="font-size:8px;color:#666;margin:0 0 1px 2px;">${esc(line.product.sku)}</p>`;
    }
    // Per-line discount
    if (line.discountCents > 0) {
      html += `<p style="font-size:9px;color:#dc2626;margin:0 0 2px 2px;">Disc: -${esc(money(line.discountCents, sym, symPos))}</p>`;
    }
    return html;
  }).join('');

  // Totals
  let totals = '';
  // Subtotal (sum of lines after per-item discounts)
  totals += row(L.subtotal, money(receipt.subtotalCents, sym, symPos));
  // Cart-level discount
  if (receipt.discountCents > 0) totals += row(L.discount, `-${money(receipt.discountCents, sym, symPos)}`);
  if (settings.receiptShowTax && receipt.taxCents > 0) totals += row(settings.taxLabel || L.tax, money(receipt.taxCents, sym, symPos));
  totals += divider(false);
  totals += `<div style="display:flex;justify-content:space-between;font-weight:700;font-size:14px;margin:3px 0;">
    <span>${esc(L.total)}</span><span>${fmt(receipt.totalCents)}</span>
  </div>`;
  totals += divider();

  if (receipt.paymentMethod === 'CASH') {
    // tenderedCents = total + change (change is recorded in frontend at checkout time)
    const tenderedCents = receipt.totalCents + changeCents;
    if (tenderedCents > 0) {
      totals += row(L.tendered, money(tenderedCents, sym, symPos));
      if (changeCents > 0) totals += row(L.change, money(changeCents, sym, symPos), true);
    }
  }
  if (receipt.isCreditSale) {
    totals += row(L.balance, money(receipt.totalCents, sym, symPos), true);
    totals += `<div style="text-align:center;margin:4px 0;">
      <span style="display:inline-block;padding:2px 10px;border:1.5px solid #000;border-radius:3px;font-size:11px;font-weight:700;letter-spacing:1px;">${esc(L.creditSale)}</span>
    </div>`;
  }
  if (receipt.isStaffSale) {
    totals += `<div style="text-align:center;border:1px solid #4c1d95;border-radius:3px;padding:3px 6px;margin:4px 0;font-size:11px;font-weight:700;color:#4c1d95;">
      &#9733; STAFF PURCHASE &#8212; COST PRICE &#9733;
    </div>`;
  }

  // Footer
  let footer = divider();
  footer += `<p style="font-size:9px;margin:1px 0;">${esc(L.itemCount)}: ${receipt.lines.reduce((s, l) => s + l.qty, 0)}</p>`;

  if (settings.receiptShowBarcode) {
    footer += barsFromString(receipt.number);
    footer += `<p style="font-size:8px;text-align:center;margin:2px 0 0;letter-spacing:1px;">${esc(receipt.number)}</p>`;
  }

  if (settings.posReceiptFooter) {
    footer += divider();
    footer += `<p style="text-align:center;font-size:10px;margin:2px 0;">${esc(settings.posReceiptFooter)}</p>`;
  }
  if (settings.returnPolicy) {
    footer += divider();
    footer += `<p style="text-align:center;font-size:9px;color:#555;margin:2px 0;">${esc(settings.returnPolicy)}</p>`;
  }

  footer += divider();
  footer += `<p style="text-align:center;font-size:10px;font-weight:500;margin:2px 0;">${esc(L.thankYou)}</p>`;
  footer += `<p style="text-align:center;font-size:8px;color:#888;margin:1px 0 4px;">${esc(L.poweredBy)}</p>`;

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
      padding: 4mm;
      font-family: ${fontFam};
      font-size: 13px;
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
${itemHeader}
${itemRows}
${totals}
${footer}
</body>
</html>`;
}
